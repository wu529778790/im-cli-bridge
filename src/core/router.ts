/**
 * 消息路由器 - 路由消息到相应的处理器
 */

import { Message } from '../interfaces/types';
import { IMClient } from '../interfaces/im-client.interface';
import { extractDisplayText } from '../utils/output-extractor';
import { EventEmitter } from './event-emitter';
import { CommandParser } from './command-parser';
import { SessionManager } from './session-manager';
import { Logger } from '../utils/logger';
import { ICommandExecutor } from '../interfaces/command-executor';
import { IWatchdog } from '../utils/watchdog.interface';
import { UserLockManager } from './concurrency';
import { AICliPoolManager } from '../executors/pool';
import { ErrorHandler } from './errors';

export class Router {
  private logger: Logger;
  private eventEmitter: EventEmitter;
  private commandParser: CommandParser;
  private sessionManager: SessionManager;
  private commandExecutor: ICommandExecutor;
  private imClients: Map<string, IMClient> = new Map();
  private watchdog?: IWatchdog;
  private aiCommand: string;
  private userLockManager: UserLockManager;
  private aiCliPoolManager: AICliPoolManager;
  private errorHandler: ErrorHandler;

  constructor(
    eventEmitter: EventEmitter,
    sessionManager: SessionManager,
    commandExecutor: ICommandExecutor,
    watchdog?: IWatchdog,
    aiCommand: string = 'claude'
  ) {
    this.logger = new Logger('Router');
    this.eventEmitter = eventEmitter;
    this.sessionManager = sessionManager;
    this.commandExecutor = commandExecutor;
    this.commandParser = new CommandParser();
    this.watchdog = watchdog;
    this.aiCommand = aiCommand;
    this.userLockManager = new UserLockManager();
    this.aiCliPoolManager = new AICliPoolManager({
      maxWorkerIdleTime: 5 * 60 * 1000, // 5分钟
      maxWorkerExecutions: 100, // 最多执行100次
      maxWorkersPerPool: 3, // 每个池最多3个worker
      minWorkersPerPool: 0, // 不预创建
      reapInterval: 60 * 1000 // 每分钟回收
    });
    this.errorHandler = new ErrorHandler(eventEmitter);
  }

  /**
   * 初始化路由器
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing router...');

    // 注册事件监听器
    this.eventEmitter.on('message:received', async (message: Message) => {
      await this.handleMessage(message);
    });

    this.eventEmitter.on('command:executed', async (data) => {
      this.logger.debug('Command executed:', data);
    });

    this.logger.info('Router initialized');
  }

  /**
   * 注册IM客户端
   * @param platform 平台名称
   * @param client IM客户端实例
   */
  registerClient(platform: string, client: IMClient): void {
    this.imClients.set(platform, client);
    this.logger.info(`Registered IM client for platform: ${platform}`);
  }

  /**
   * 注销IM客户端
   * @param platform 平台名称
   */
  unregisterClient(platform: string): void {
    this.imClients.delete(platform);
    this.logger.info(`Unregistered IM client for platform: ${platform}`);
  }

  /**
   * 获取IM客户端
   * @param platform 平台名称
   */
  getClient(platform: string): IMClient | undefined {
    return this.imClients.get(platform);
  }

  /**
   * 处理接收到的消息
   * 使用用户锁管理器确保同一用户的消息串行处理
   * @param message 消息对象
   */
  private async handleMessage(message: Message): Promise<void> {
    // 使用用户锁管理器确保同一用户的请求串行处理
    return this.userLockManager.execute(message.userId, async () => {
      try {
        // 重置 Watchdog 计时器，表明服务正常运行
        if (this.watchdog) {
          this.watchdog.reset();
        }

        this.logger.info(`Received message from ${message.userId}: ${message.content}`);

        // 检查是否是命令
        if (this.commandParser.isCommand(message.content)) {
          await this.handleCommand(message);
        } else {
          await this.handleNormalMessage(message);
        }

      } catch (error) {
        this.logger.error('Error handling message:', error);
        await this.eventEmitter.emit('error', {
          type: 'message_handling',
          message: message.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  /**
   * 处理命令消息
   * @param message 消息对象
   */
  private async handleCommand(message: Message): Promise<void> {
    try {
      const parsed = this.commandParser.parse(message.content);
      if (!parsed) {
        await this.sendMessage(message.platform, message.userId, '无效的命令');
        return;
      }

      this.logger.info(`Processing command: ${parsed.type} from user ${message.userId}`);

      // 确保用户有会话
      let session = this.sessionManager.getCurrentSession(message.userId);
      if (!session) {
        session = await this.sessionManager.createSession(message.userId);
      }

      // 使用进程池执行命令
      const result = await this.aiCliPoolManager.execute(
        message.userId,
        this.aiCommand,
        [this.aiCommand, ...parsed.args || []]
      );

      // 发送响应（从 stream-json 中提取可读文本）
      if (result) {
        const text = extractDisplayText(result.stdout, result.stderr);
        if (text) await this.sendMessage(message.platform, message.userId, text);
      }

      // 触发命令执行事件
      await this.eventEmitter.emit('command:executed', {
        command: parsed.type,
        userId: message.userId,
        result
      });

    } catch (error) {
      // 使用错误处理器处理错误
      await this.errorHandler.handleWithUserContext(
        error,
        'command_execution',
        message.userId,
        message.platform
      );
    }
  }

  /**
   * 处理普通消息
   * @param message 消息对象
   */
  private async handleNormalMessage(message: Message): Promise<void> {
    try {
      // 获取或创建会话
      let session = this.sessionManager.getCurrentSession(message.userId);
      if (!session) {
        session = await this.sessionManager.createSession(message.userId);
      }

      // 添加用户消息到会话
      await this.sessionManager.addMessage(
        session.sessionId,
        'user',
        message.content
      );

      // 使用进程池发送给 AI CLI 处理（使用 -p 传入 prompt）
      this.logger.info(`Sending to AI CLI (${this.aiCommand}): ${message.content}`);
      const result = await this.aiCliPoolManager.execute(
        message.userId,
        this.aiCommand,
        ['-p', message.content]
      );

      // 发送响应（从 stream-json 中提取可读文本，避免发送原始 JSON）
      if (result) {
        const text = extractDisplayText(result.stdout, result.stderr);
        if (text) await this.sendMessage(message.platform, message.userId, text);
      }

      // 触发普通消息处理事件
      await this.eventEmitter.emit('session:updated', {
        sessionId: session.sessionId,
        message
      });

      this.logger.debug(`Added user message to session ${session.sessionId}`);

    } catch (error) {
      // 使用错误处理器处理错误
      await this.errorHandler.handleWithUserContext(
        error,
        'message_handling',
        message.userId,
        message.platform
      );
    }
  }

  /**
   * 发送消息到IM平台
   * @param platform 平台名称
   * @param userId 用户ID
   * @param content 消息内容
   */
  async sendMessage(platform: string, userId: string, content: string): Promise<void> {
    const client = this.imClients.get(platform);
    if (!client) {
      throw new Error(`No client registered for platform: ${platform}`);
    }

    try {
      await client.sendText(userId, content, 'private' as any);

      // 触发消息发送事件
      await this.eventEmitter.emit('message:sent', {
        platform,
        userId,
        content,
        timestamp: Date.now()
      });

      this.logger.debug(`Sent message to ${userId} on ${platform}`);
    } catch (error) {
      this.logger.error(`Failed to send message to ${userId}:`, error);
      throw error;
    }
  }

  /**
   * 广播消息到所有平台
   * @param userId 用户ID
   * @param content 消息内容
   */
  async broadcastMessage(userId: string, content: string): Promise<void> {
    const promises = Array.from(this.imClients.entries()).map(
      async ([platform, client]) => {
        try {
          await client.sendText(userId, content, 'private' as any);
        } catch (error) {
          this.logger.error(`Failed to broadcast to ${platform}:`, error);
        }
      }
    );

    await Promise.allSettled(promises);
  }

  /**
   * 获取路由器状态
   */
  getStatus(): {
    registeredClients: string[];
    commandParserReady: boolean;
    sessionManagerStats: { totalSessions: number; totalMessages: number };
    concurrencyStats: {
      activeLocks: number;
      totalAcquisitions: number;
      totalQueued: number;
    };
    poolStats: {
      totalPools: number;
      totalWorkers: number;
      totalQueued: number;
      totalExecutions: number;
    };
  } {
    return {
      registeredClients: Array.from(this.imClients.keys()),
      commandParserReady: true,
      sessionManagerStats: this.sessionManager.getStats(),
      concurrencyStats: this.userLockManager.getStats(),
      poolStats: this.aiCliPoolManager.getStats()
    };
  }

  /**
   * 关闭路由器
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down router...');

    // 清理用户锁管理器
    this.userLockManager.clearAll();

    // 关闭进程池管理器
    this.aiCliPoolManager.shutdown();

    // 停止所有IM客户端
    const shutdownPromises = Array.from(this.imClients.values()).map(
      async (client) => {
        try {
          if (client.isRunning()) {
            await client.stop();
          }
        } catch (error) {
          this.logger.error('Error stopping client:', error);
        }
      }
    );

    await Promise.allSettled(shutdownPromises);
    this.imClients.clear();

    this.logger.info('Router shutdown complete');
  }
}
