/**
 * 简化版消息路由器
 * 直接将 IM 消息路由到 AI CLI，流式回传输出到 IM
 */

import { Message } from '../interfaces/types';
import { IMClient } from '../interfaces/im-client.interface';
import { extractDisplayText } from '../utils/output-extractor';
import { EventEmitter } from './event-emitter';
import { CommandParser } from './command-parser';
import { Logger } from '../utils/logger';
import { ShellExecutor } from '../executors/shell-executor';

export class SimpleRouter {
  private logger: Logger;
  private eventEmitter: EventEmitter;
  private commandParser: CommandParser;
  private shellExecutor: ShellExecutor;
  private imClients: Map<string, IMClient> = new Map();
  private aiCommand: string;

  // 简单的串行化锁：确保同一用户的消息按顺序处理
  private userLocks: Map<string, Promise<any>> = new Map();

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
        if (this.commandParser.isCommand(message.content)) {
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

      const result = await this.executeWithStream(
        message,
        this.aiCommand,
        ['--dangerously-skip-permissions', '-p', message.content]
      );

      if (!result.streamed) {
        const text = extractDisplayText(result.stdout, result.stderr);
        if (text) {
          await this.sendMessage(message.platform, message.userId, text);
        } else {
          this.logger.warn('No output extracted from AI CLI');
        }
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

      const result = await this.executeWithStream(
        message,
        this.aiCommand,
        ['--dangerously-skip-permissions', parsed.type, ...(parsed.args || [])]
      );

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
   * 清理资源
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up router...');
    this.userLocks.clear();
    this.imClients.clear();
  }
}

export default SimpleRouter;
