import express from 'express';
import { defaultConfig } from './config/default.config';
import { validateConfig } from './config/schema';
import { IConfig } from './interfaces/config';
import { logger } from './utils/logger';
import { AsyncQueue } from './utils/async-queue';
import { Watchdog } from './utils/watchdog';
import { ShellExecutor } from './executors/shell-executor';
import { FileStorage } from './storage/file-storage';
import { FeishuClient } from './im-clients/feishu';
import { TelegramClient } from './im-clients/telegram';
import { Router } from './core/router';
import { SessionManager } from './core/session-manager';
import { EventEmitter } from './core/event-emitter';
import { immessageToMessage } from './utils/message-adapter';
import type { Platform } from './interfaces/types';
import type { IMMessage } from './interfaces/im-client.interface';
import * as fs from 'fs';
import * as path from 'path';

export class IMCLIBridge {
  private config: IConfig;
  private app: express.Application;
  private server: any;
  private commandExecutor!: ShellExecutor;
  private storage!: FileStorage;
  private feishuClient?: FeishuClient;
  private telegramClient?: TelegramClient;
  private router?: Router;
  private sessionManager?: SessionManager;
  private eventEmitter?: EventEmitter;
  private queue!: AsyncQueue;
  private watchdog?: Watchdog;

  constructor(config: Partial<IConfig> = {}) {
    // Merge with default config
    this.config = { ...defaultConfig, ...config };

    // Validate config
    const validation = validateConfig(this.config);
    if (!validation.valid) {
      throw new Error(`Invalid configuration: ${validation.errors?.join(', ')}`);
    }

    this.app = express();
    this.initializeComponents();
  }

  private initializeComponents(): void {
    logger.info('Initializing components...');

    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create data directory if it doesn't exist
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Initialize storage
    this.storage = new FileStorage(this.config.storage.path || './data/storage.json');

    // Initialize queue
    this.queue = new AsyncQueue(this.config.queue.concurrency);

    // Initialize event emitter
    this.eventEmitter = new EventEmitter();

    // Initialize command executor
    this.commandExecutor = new ShellExecutor();

    // Initialize session manager
    this.sessionManager = new SessionManager(this.storage);

    // Initialize watchdog if enabled (create but don't start yet)
    if (this.config.watchdog.enabled) {
      this.watchdog = new Watchdog({
        name: 'IMCLIBridge-Watchdog',
        timeout: this.config.watchdog.timeout,
        onTimeout: async () => {
          logger.warn('Watchdog timeout triggered, restarting...');
          await this.restart();
        }
      });
    }

    // Initialize IM clients
    if (this.config.feishu && this.config.feishu.appId) {
      this.feishuClient = new FeishuClient();
      logger.info('Feishu client created');
    }

    if (this.config.telegram && this.config.telegram.botToken) {
      this.telegramClient = new TelegramClient();
      logger.info('Telegram client created');
    }

    // Initialize router with watchdog and config
    if (this.eventEmitter && this.sessionManager) {
      this.router = new Router(
        this.eventEmitter,
        this.sessionManager,
        this.commandExecutor,
        this.watchdog,
        this.config.executor.aiCommand
      );
    }

    logger.info('All components initialized');
  }

  /**
   * 连接 IM 客户端到中央 EventEmitter，将消息转发到 Router
   * 并注册 IM 客户端到 Router 以便发送回复
   */
  private connectIMClients(): void {
    if (!this.eventEmitter || !this.router) return;

    if (this.feishuClient) {
      this.feishuClient.on('message:received', (imMessage: IMMessage) => {
        const message = immessageToMessage(imMessage, 'feishu');
        this.eventEmitter!.emit('message:received', message);
      });
      this.router.registerClient('feishu', this.feishuClient);
      logger.info('Feishu client connected to router');
    }

    if (this.telegramClient) {
      this.telegramClient.on('message:received', (imMessage: IMMessage) => {
        const message = immessageToMessage(imMessage, 'telegram');
        this.eventEmitter!.emit('message:received', message);
      });
      this.router.registerClient('telegram', this.telegramClient);
      logger.info('Telegram client connected to router');
    }
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting IM CLI Bridge...');

      // Initialize storage
      await this.storage.initialize();
      logger.info('Storage initialized');

      // Initialize session manager
      await this.sessionManager?.initialize();
      logger.info('Session manager initialized');

      // Initialize router
      if (this.router) {
        await this.router.initialize();
        logger.info('Router initialized');
      }

      // 连接 IM 客户端到中央 EventEmitter，并注册到 Router
      this.connectIMClients();

      // Start IM clients
      if (this.feishuClient) {
        await this.feishuClient.initialize(this.config.feishu!);
        await this.feishuClient.start();
        logger.info('Feishu client started');
      }

      if (this.telegramClient && this.config.telegram) {
        await this.telegramClient.initialize({
          appId: this.config.telegram.botToken,
          appSecret: '', // Telegram doesn't use appSecret
          polling: {
            autoStart: true,
            params: {
              timeout: this.config.telegram.pollTimeout || 10
            }
          }
        } as any);
        await this.telegramClient.start();
        logger.info('Telegram client started');
      }

      // Start watchdog
      if (this.watchdog) {
        this.watchdog.start();
      }

      logger.info('IM CLI Bridge started successfully');
    } catch (error) {
      logger.error('Failed to start IM CLI Bridge', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      logger.info('Stopping IM CLI Bridge...');

      // Stop watchdog
      if (this.watchdog) {
        this.watchdog.stop();
      }

      // Stop IM clients
      if (this.feishuClient) {
        await this.feishuClient.stop();
        logger.info('Feishu client stopped');
      }

      if (this.telegramClient) {
        await this.telegramClient.stop();
        logger.info('Telegram client stopped');
      }

      logger.info('IM CLI Bridge stopped successfully');
    } catch (error) {
      logger.error('Error during shutdown', error);
      throw error;
    }
  }

  async restart(): Promise<void> {
    logger.info('Restarting IM CLI Bridge...');
    await this.stop();
    await this.start();
  }

  getConfig(): IConfig {
    return this.config;
  }
}

export default IMCLIBridge;
