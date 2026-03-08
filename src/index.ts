/**
 * IM CLI Bridge - 简化版主入口
 *
 * 功能：通过 IM（Telegram/Feishu）控制 claudecode 命令行工具
 */

import dotenv from 'dotenv';
import { EventEmitter } from './core/event-emitter';
import { SimpleRouter } from './core/router';
import { TelegramClient } from './im-clients/telegram';
import { Logger } from './utils/logger';
import { immessageToMessage } from './utils/message-adapter';
import { IConfig } from './interfaces/config';
import { defaultConfig } from './config/default.config';

// 加载环境变量
dotenv.config();

/**
 * 主 Bridge 类
 */
class IMCLIBridge {
  private eventEmitter: EventEmitter;
  private router: SimpleRouter;
  private telegramClient?: TelegramClient;
  private config: IConfig;
  private logger: Logger;

  constructor(config: Partial<IConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.logger = new Logger('IMCLIBridge');
    this.eventEmitter = new EventEmitter();

    // 创建路由器
    const aiCommand = this.config.executor?.aiCommand || process.env.AI_COMMAND || 'claude';
    this.router = new SimpleRouter(this.eventEmitter, aiCommand);
  }

  /**
   * 初始化所有组件
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing IM CLI Bridge...');

    // 初始化路由器
    await this.router.initialize();

    // 初始化 Telegram 客户端
    const telegramToken = this.config.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN;
    if (telegramToken) {
      this.telegramClient = new TelegramClient();
      await this.telegramClient.initialize({
        appId: telegramToken,
        polling: { params: { timeout: 30 } }
      } as any);

      // 连接到路由器
      this.telegramClient.on('message:received', (imMessage) => {
        const message = immessageToMessage(imMessage, 'telegram');
        this.eventEmitter.emit('message:received', message);
      });

      this.router.registerClient('telegram', this.telegramClient);
      this.logger.info('Telegram client connected to router');
    }

    this.logger.info('All components initialized');
  }

  /**
   * 启动服务
   */
  async start(): Promise<void> {
    this.logger.info('Starting IM CLI Bridge...');

    // 启动 Telegram 客户端
    if (this.telegramClient) {
      await this.telegramClient.start();
      this.logger.info('Telegram client started');
    }

    this.logger.info('IM CLI Bridge started successfully');
    this.logger.info('Ready to receive messages...');
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping IM CLI Bridge...');

    if (this.telegramClient) {
      await this.telegramClient.stop();
    }

    await this.router.cleanup();

    this.logger.info('IM CLI Bridge stopped');
  }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  const bridge = new IMCLIBridge();

  try {
    await bridge.initialize();
    await bridge.start();

    // 处理优雅退出
    process.on('SIGINT', async () => {
      console.log('\nReceived SIGINT, shutting down gracefully...');
      await bridge.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\nReceived SIGTERM, shutting down gracefully...');
      await bridge.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start bridge:', error);
    process.exit(1);
  }
}

// 仅在直接运行 index 时执行（避免被 cli 导入时重复启动）
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { IMCLIBridge, main };
