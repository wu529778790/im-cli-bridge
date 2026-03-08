/**
 * 简化版消息路由器
 * 直接将 IM 消息路由到 AI CLI，流式回传输出到 IM
 * 支持会话模式：每用户一个常驻进程，通过 stdin 持续输入
 */

import { Message } from '../interfaces/types';
import { IMClient } from '../interfaces/im-client.interface';
import { extractDisplayText } from '../utils/output-extractor';
import { EventEmitter } from './event-emitter';
import { CommandParser } from './command-parser';
import { Logger } from '../utils/logger';
import { ShellExecutor } from '../executors/shell-executor';
import { AISession } from './ai-session';
import { getAIAdapter, buildOneShotArgs } from '../config/ai-adapters';

/** 会话模式需 CLI 支持非 TTY 的 stdin，多数工具会报 stdin is not a terminal，默认关闭 */
const AI_SESSION_MODE = process.env.AI_SESSION_MODE === 'true';

export class SimpleRouter {
  private logger: Logger;
  private eventEmitter: EventEmitter;
  private commandParser: CommandParser;
  private shellExecutor: ShellExecutor;
  private imClients: Map<string, IMClient> = new Map();
  private aiCommand: string;

  private userLocks: Map<string, Promise<any>> = new Map();
  /** 每用户一个 AI 会话（仅会话模式） */
  private aiSessions: Map<string, AISession> = new Map();
  /** 会话不可用时退回逐条 -p */
  private sessionUnsupported: Set<string> = new Set();

  constructor(
    eventEmitter: EventEmitter,
    aiCommand: string = 'claude'
  ) {
    this.logger = new Logger('Router');
    this.eventEmitter = eventEmitter;
    this.commandParser = new CommandParser();
    this.aiCommand = aiCommand;
    this.shellExecutor = new ShellExecutor();
  }

  /**
   * 初始化路由器
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing router...');

    // 注册事件监听器
    this.eventEmitter.on('message:received', async (message: Message) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        this.logger.error('Error in message:received handler:', error);
      }
    });

    this.logger.info('Router initialized');
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
        if (AI_SESSION_MODE) {
          await this.handleNormalMessage(message);
        } else if (this.commandParser.isCommand(message.content)) {
          await this.handleCommand(message);
        } else {
          await this.handleNormalMessage(message);
        }
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
   * 处理普通消息（流式转发给 AI CLI）
   */
  private async handleNormalMessage(message: Message): Promise<void> {
    try {
      this.logger.info(`Processing message from ${message.userId}: ${message.content}`);

      const sessionKey = `${message.platform}:${message.userId}`;

      if (AI_SESSION_MODE && !this.sessionUnsupported.has(sessionKey)) {
        await this.handleWithSession(message, sessionKey);
      } else {
        await this.handleWithOneShot(message);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to execute: ${errorMsg}`);

      let userMessage = '❌ 处理失败\n\n';
      if (errorMsg.includes('timed out')) {
        userMessage += '命令执行超时（30秒）\n可能原因：API密钥未配置或网络问题';
      } else if (errorMsg.includes('not found') || errorMsg.includes('ENOENT')) {
        userMessage += `找不到命令: ${this.aiCommand}`;
      } else {
        userMessage += `错误: ${errorMsg}`;
      }

      await this.sendMessage(message.platform, message.userId, userMessage);
    }
  }

  /**
   * 处理命令消息（如 /help, /new）
   */
  private async handleCommand(message: Message): Promise<void> {
    try {
      const parsed = this.commandParser.parse(message.content);
      if (!parsed) {
        await this.sendMessage(message.platform, message.userId, '无效的命令');
        return;
      }

      this.logger.info(`Processing command: ${parsed.type} from ${message.userId}`);

      const adapter = getAIAdapter(this.aiCommand);
      const args = [...adapter.baseArgs, parsed.type, ...(parsed.args || [])];
      const result = await this.executeWithStream(message, this.aiCommand, args);

      if (!result.streamed) {
        const text = extractDisplayText(result.stdout, result.stderr);
        if (text) {
          await this.sendMessage(message.platform, message.userId, text);
        }
      }
    } catch (error) {
      this.logger.error('Command execution failed:', error);
      await this.sendMessage(
        message.platform,
        message.userId,
        `命令执行失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 会话模式：一个常驻进程，消息通过 stdin 输入
   * 若 CLI 需 TTY，会话会失败，onError 时退回逐条模式并重试当前消息
   */
  private async handleWithSession(message: Message, sessionKey: string): Promise<void> {
    const client = this.imClients.get(message.platform);
    if (!client) return;

    let session = this.aiSessions.get(sessionKey);
    if (!session) {
      let accumulated = '';
      let streamedMessageId: string | null = null;
      let sendPromise: Promise<void> = Promise.resolve();
      const replyTarget = message.userId;

      const retryOneShot = () => {
        this.sessionUnsupported.add(sessionKey);
        this.aiSessions.delete(sessionKey);
        this.handleWithOneShot(message).catch((e) => this.logger.error('One-shot retry failed', e));
      };

      session = new AISession({
        command: this.aiCommand,
        baseArgs: getAIAdapter(this.aiCommand).baseArgs,
        onOutput: (text: string) => {
          accumulated += text;
          sendPromise = sendPromise.then(async () => {
            try {
              if (!streamedMessageId) {
                const sent = await client!.sendText(replyTarget, accumulated);
                streamedMessageId = sent.id;
              } else {
                await client!.updateMessage({ messageId: streamedMessageId!, content: accumulated });
              }
            } catch (err) {
              this.logger.debug('Session stream update failed:', err);
            }
          });
        },
        onEnd: () => {
          this.logger.debug('Session turn ended');
        },
        onError: (err) => {
          this.logger.warn('Session error, falling back to one-shot:', err?.message);
          retryOneShot();
        }
      });

      this.aiSessions.set(sessionKey, session);
      session.start();
    }

    session.send(message.content);
  }

  /**
   * 逐条模式：每条消息 spawn 一次，参数由 ai-adapters 决定
   */
  private async handleWithOneShot(message: Message): Promise<void> {
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
    let streamedMessageId: string | null = null;
    const client = this.imClients.get(message.platform);
    const replyTarget = message.userId;

    let sendPromise: Promise<void> = Promise.resolve();

    const result = await this.shellExecutor.executeStream(command, args, {
      timeout: 60000,
      onText: (text: string) => {
        accumulated += text;

        if (!client) return;

        sendPromise = sendPromise.then(async () => {
          try {
            if (!streamedMessageId) {
              const sent = await client.sendText(replyTarget, accumulated);
              streamedMessageId = sent.id;
            } else {
              await client.updateMessage({ messageId: streamedMessageId!, content: accumulated });
            }
          } catch (err) {
            this.logger.debug('Stream update failed, will send final result:', err);
          }
        });
      }
    });

    await sendPromise;

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      streamed: streamedMessageId != null
    };
  }

  /**
   * 发送消息到 IM 平台
   */
  private async sendMessage(platform: string, userId: string, text: string): Promise<void> {
    const client = this.imClients.get(platform);
    if (!client) {
      this.logger.error(`No client found for platform: ${platform}`);
      return;
    }

    try {
      await client.sendText(userId, text);
      this.logger.debug(`Message sent to ${userId} on ${platform}`);
    } catch (error) {
      this.logger.error(`Failed to send message:`, error);
    }
  }

  /**
   * 清理资源，包括杀掉后台 AI CLI 子进程
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up router...');
    for (const s of this.aiSessions.values()) s.stop();
    this.aiSessions.clear();
    this.sessionUnsupported.clear();
    this.shellExecutor.killAll();
    this.userLocks.clear();
    this.imClients.clear();
  }
}

export default SimpleRouter;
