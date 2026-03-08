/**
 * 简化版消息路由器
 * MODE=oneshot: claude -p 逐条调用
 * MODE=tmux: tmux + JSONL 常驻会话
 */

import { Message } from '../interfaces/types';
import { IMClient } from '../interfaces/im-client.interface';
import { filterStreamOutput, extractDisplayText } from '../utils/output-extractor';
import { EventEmitter } from './event-emitter';
import { Logger } from '../utils/logger';
import { ShellExecutor } from '../executors/shell-executor';
import { buildOneShotArgs } from '../config/ai-adapters';
import { ClaudeAdapter } from '../adapters/claude-adapter';
import { getTmuxState, setTmuxState, removeTmuxState, getUserIdByWindowId } from '../utils/tmux-state';

/** Telegram 单条消息上限 4096 字符，留余量避免 MESSAGE_TOO_LONG */
const MAX_MESSAGE_LENGTH = 3500;

const isTmuxMode = (): boolean =>
  (process.env.MODE || '').toLowerCase() === 'tmux';

export class SimpleRouter {
  private logger: Logger;
  private eventEmitter: EventEmitter;
  private shellExecutor: ShellExecutor;
  private claudeAdapter: ClaudeAdapter | null = null;
  private imClients: Map<string, IMClient> = new Map();
  private aiCommand: string;

  private userLocks: Map<string, Promise<any>> = new Map();

  constructor(
    eventEmitter: EventEmitter,
    aiCommand: string = 'claude'
  ) {
    this.logger = new Logger('Router');
    this.eventEmitter = eventEmitter;
    this.aiCommand = aiCommand;
    this.shellExecutor = new ShellExecutor();
  }

  /**
   * 初始化路由器
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing router...');

    if (isTmuxMode()) {
      this.claudeAdapter = new ClaudeAdapter({
        pollIntervalSec: parseFloat(process.env.MONITOR_POLL_INTERVAL || '2') || 2
      });
      this.claudeAdapter.setOnNewMessage((msg) => this.onMonitorMessage(msg));
      this.claudeAdapter.startMonitor();
      this.logger.info('Tmux mode enabled');
    }

    this.eventEmitter.on('message:received', async (message: Message) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        this.logger.error('Error in message:received handler:', error);
      }
    });

    this.logger.info('Router initialized');
  }

  private async onMonitorMessage(msg: { windowId: string; text: string }): Promise<void> {
    const userId = getUserIdByWindowId(msg.windowId);
    if (!userId) return;
    const client = this.imClients.get('telegram');
    if (!client) return;
    if (msg.text) {
      await this.sendMessage('telegram', userId, msg.text);
    }
  }

  /**
   * 注册 IM 客户端
   */
  registerClient(platform: string, client: IMClient): void {
    this.imClients.set(platform, client);
    this.logger.info(`Registered ${platform} client`);
  }

  /**
   * 处理消息（带用户级串行化）
   */
  private async handleMessage(message: Message): Promise<void> {
    // 获取或创建用户锁
    const userId = message.userId;
    let userLock = this.userLocks.get(userId);

    if (!userLock) {
      userLock = Promise.resolve();
      this.userLocks.set(userId, userLock);
    }

    // 串行化处理：等待前一个消息处理完成
    const nextLock = userLock.then(async () => {
      try {
        await this.processMessage(message);
      } finally {
        // 处理完成后，清理锁（如果没有新的等待）
        if (this.userLocks.get(userId) === nextLock) {
          this.userLocks.delete(userId);
        }
      }
    });

    this.userLocks.set(userId, nextLock);
    await nextLock;
  }

  /**
   * 处理消息
   */
  private async processMessage(message: Message): Promise<void> {
    const client = this.imClients.get(message.platform);
    if (!client) return;

    if (isTmuxMode() && this.claudeAdapter) {
      await this.processMessageTmux(message);
      return;
    }

    try {
      this.logger.info(`Processing message from ${message.userId}: ${message.content}`);
      const args = buildOneShotArgs(this.aiCommand, message.content);
      const result = await this.executeWithStream(message, this.aiCommand, args);

      if (!result.streamed) {
        const text = extractDisplayText(result.stdout, result.stderr);
        if (text) {
          await this.sendMessage(message.platform, message.userId, text);
        } else {
          this.logger.warn('No output extracted from AI CLI');
        }
      }
    } catch (error) {
      await this.sendErrorMessage(message, error);
    }
  }

  private async processMessageTmux(message: Message): Promise<void> {
    const sessionKey = this.getSessionKey(message);
    const defaultWorkDir = process.env.CLAUDE_WORK_DIR || process.cwd();

    let state = getTmuxState(sessionKey);
    if (!state) {
      const handle = await this.claudeAdapter!.createSession(defaultWorkDir);
      if (!handle) {
        await this.sendMessage(
          message.platform,
          message.userId,
          '❌ 无法创建 tmux 窗口，请确保 tmux 已安装并在 tmux 中运行'
        );
        return;
      }
      setTmuxState(sessionKey, { windowId: handle.windowId, workDir: handle.workDir });
      state = { windowId: handle.windowId, workDir: handle.workDir };
    }

    const stopTyping = this.startTypingLoop(message.platform, message.userId);
    try {
      await this.claudeAdapter!.sendInput(
        { windowId: state.windowId, sessionId: '', workDir: state.workDir },
        message.content
      );
    } catch (error) {
      await this.sendErrorMessage(message, error);
    } finally {
      stopTyping();
    }
  }

  private getSessionKey(message: Message): string {
    const threadId = message.metadata?.threadId;
    if (threadId != null) return `thread:${threadId}`;
    return message.userId;
  }

  private async sendErrorMessage(message: Message, error: unknown): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    this.logger.error(`Failed: ${errorMsg}`);
    let userMessage = '❌ 处理失败\n\n';
    if (errorMsg.includes('not found') || errorMsg.includes('ENOENT')) {
      userMessage += `找不到命令: ${this.aiCommand}`;
    } else if (errorMsg.includes('timed out')) {
      userMessage += '命令执行超时\n可能原因：API密钥未配置或网络问题';
    } else {
      userMessage += `错误: ${errorMsg}`;
    }
    await this.sendMessage(message.platform, message.userId, userMessage);
  }

  /**
   * 流式执行命令并持续回传到 IM
   */
  private async executeWithStream(
    message: Message,
    command: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string; streamed: boolean }> {
    let accumulated = '';
    let lastSentLength = 0;
    let streamed = false;
    const client = this.imClients.get(message.platform);
    const replyTarget = message.userId;

    const stopTyping = this.startTypingLoop(message.platform, replyTarget);
    let sendPromise: Promise<void> = Promise.resolve();

    try {
      const result = await this.shellExecutor.executeStream(command, args, {
        timeout: 60000,
        onText: (text: string) => {
          accumulated += text;
          const current = filterStreamOutput(accumulated);
          if (!client || !current || current.length <= lastSentLength) return;

          sendPromise = sendPromise.then(async () => {
            try {
              const cur = filterStreamOutput(accumulated);
              if (cur.length <= lastSentLength) return;
              stopTyping();
              lastSentLength = await this.sendOrAppendChunked(
                client,
                replyTarget,
                cur,
                lastSentLength
              );
              streamed = true;
            } catch (err) {
              this.logger.debug('Stream append failed:', err);
            }
          });
        }
      });

      await sendPromise;
      return { stdout: result.stdout, stderr: result.stderr, streamed };
    } finally {
      stopTyping();
    }
  }

  /** typing 最大持续时间（秒），超时自动停止，避免一直显示「正在输入」 */
  private static TYPING_MAX_SEC = 55;

  /**
   * 启动 typing 循环，在 AI 思考期间持续显示「正在输入」
   * 返回 stop 函数，在首条内容发出、执行结束或超时时调用
   */
  private startTypingLoop(platform: string, userId: string): () => void {
    const client = this.imClients.get(platform);
    const sendTyping = typeof client?.sendTyping === 'function' ? client.sendTyping.bind(client) : null;
    if (!sendTyping) return () => {};

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      clearTimeout(timeoutId);
    };

    sendTyping(userId).catch(() => {});
    const timer = setInterval(() => {
      if (stopped) return;
      sendTyping(userId).catch(() => {});
    }, 4000);

    const timeoutId = setTimeout(stop, SimpleRouter.TYPING_MAX_SEC * 1000);
    return stop;
  }

  /**
   * 追加模式：只发送新增内容作为新消息，不更新前一条
   * 避免用户还没看完就被更新覆盖
   */
  private async sendOrAppendChunked(
    client: IMClient,
    replyTarget: string,
    content: string,
    lastSentLength: number
  ): Promise<number> {
    const delta = content.slice(lastSentLength);
    if (!delta) return lastSentLength;

    for (let i = 0; i < delta.length; i += MAX_MESSAGE_LENGTH) {
      const chunk = delta.slice(i, i + MAX_MESSAGE_LENGTH);
      await client.sendText(replyTarget, chunk);
    }
    return content.length;
  }

  /**
   * 发送消息到 IM 平台（超长时自动分块）
   */
  private async sendMessage(platform: string, userId: string, text: string): Promise<void> {
    const client = this.imClients.get(platform);
    if (!client) {
      this.logger.error(`No client found for platform: ${platform}`);
      return;
    }

    try {
      if (text.length <= MAX_MESSAGE_LENGTH) {
        await client.sendText(userId, text);
      } else {
        for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
          await client.sendText(userId, text.slice(i, i + MAX_MESSAGE_LENGTH));
        }
      }
      this.logger.debug(`Message sent to ${userId} on ${platform}`);
    } catch (error) {
      this.logger.error(`Failed to send message:`, error);
    }
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up router...');
    if (this.claudeAdapter) {
      this.claudeAdapter.stopMonitor();
      this.claudeAdapter = null;
    }
    this.shellExecutor.killAll();
    this.userLocks.clear();
    this.imClients.clear();
  }
}

export default SimpleRouter;
