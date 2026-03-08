/**
 * Telegram IM客户端实现
 * 使用node-telegram-bot-api库实现Telegram Bot API集成
 * 支持长轮询模式接收消息和发送Markdown格式消息
 */

import TelegramBot from 'node-telegram-bot-api';
import {
  IMClient,
  IMClientConfig,
  IMMessage,
  MessageType,
  ChatType,
  CardContent,
  UpdateMessageOptions,
  MediaInfo,
  EventListener
} from '../../interfaces/im-client.interface';
import { EventEmitter } from '../../core/event-emitter';
import { logger } from '../../utils/logger';
import { MessageFormatter } from './message-formatter';
import { InlineKeyboardBuilder } from './inline-keyboard';
import { RateLimiter } from '../../utils/rate-limit';

/**
 * Telegram客户端配置接口
 */
export interface TelegramClientConfig extends IMClientConfig {
  /** Bot Token (从appId字段获取) */
  botToken?: string;
  /** 轮询模式配置 */
  polling?: {
    /** 轮询间隔(毫秒) */
    interval?: number;
    /** 是否启用自动启动 */
    autoStart?: boolean;
    /** 请求参数 */
    params?: {
      timeout?: number;
      limit?: number;
    };
  };
  /** Webhook模式配置 */
  webhook?: {
    /** Webhook URL */
    url: string;
    /** 端口 */
    port?: number;
    /** 路径 */
    path?: string;
  };
}

/**
 * Telegram客户端类
 */
export class TelegramClient implements IMClient {
  private bot: TelegramBot | null = null;
  private config: TelegramClientConfig | null = null;
  private eventEmitter: EventEmitter;
  private messageFormatter: MessageFormatter;
  private keyboardBuilder: InlineKeyboardBuilder;
  private isInitializedFlag: boolean = false;
  private isRunningFlag: boolean = false;
  private pollingTimeout: NodeJS.Timeout | null = null;
  private rateLimiter: RateLimiter;

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.messageFormatter = new MessageFormatter();
    this.keyboardBuilder = new InlineKeyboardBuilder();
    this.rateLimiter = new RateLimiter({
      enabled: true,
      platforms: {
        telegram: { rate: 30, capacity: 100 } // Telegram: 30 msg/sec
      },
      retryPolicy: {
        maxRetries: 3,
        initialDelay: 1000,
        backoffStrategy: 'exponential_with_jitter'
      }
    });
  }

  /**
   * 初始化客户端
   */
  async initialize(config: IMClientConfig): Promise<void> {
    try {
      this.config = {
        ...config,
        polling: (config as any).polling
      } as TelegramClientConfig;

      // 获取Bot Token
      const botToken = this.config.botToken || this.config.appId;
      if (!botToken) {
        throw new Error('Bot token is required. Set it in config.botToken or config.appId');
      }

      // 创建Telegram Bot实例
      this.bot = new TelegramBot(botToken, {
        polling: false, // 我们将手动控制轮询
      });

      // 设置轮询配置
      if (this.config.polling) {
        const pollingConfig = this.config.polling.params || {};
        if (!pollingConfig.timeout) {
          pollingConfig.timeout = 30; // 默认30秒超时
        }
        if (!pollingConfig.limit) {
          pollingConfig.limit = 100; // 默认每次获取100条消息
        }
      }

      this.isInitializedFlag = true;
      logger.info('Telegram client initialized successfully');

      // 注册消息处理器
      this.setupMessageHandlers();
    } catch (error) {
      logger.error('Failed to initialize Telegram client:', error);
      throw error;
    }
  }

  /**
   * 启动客户端
   */
  async start(): Promise<void> {
    if (!this.isInitializedFlag || !this.bot) {
      throw new Error('Client not initialized. Call initialize() first.');
    }

    if (this.isRunningFlag) {
      logger.warn('Telegram client is already running');
      return;
    }

    try {
      // 获取Bot信息以验证Token
      const botInfo = await this.bot.getMe();
      logger.info(`Connected to Telegram as @${botInfo.username} (ID: ${botInfo.id})`);

      // 启动轮询
      if (this.config?.polling) {
        await this.startPolling();
      }

      this.isRunningFlag = true;
      logger.info('Telegram client started successfully');
    } catch (error) {
      logger.error('Failed to start Telegram client:', error);
      throw error;
    }
  }

  /**
   * 停止客户端
   */
  async stop(): Promise<void> {
    if (!this.isRunningFlag) {
      logger.warn('Telegram client is not running');
      return;
    }

    try {
      // 停止轮询
      if (this.bot) {
        await this.bot.stopPolling();
      }

      // 清理定时器
      if (this.pollingTimeout) {
        clearTimeout(this.pollingTimeout);
        this.pollingTimeout = null;
      }

      this.isRunningFlag = false;
      logger.info('Telegram client stopped successfully');
    } catch (error) {
      logger.error('Error stopping Telegram client:', error);
      throw error;
    }
  }

  /**
   * 发送文本消息
   */
  async sendText(
    userId: string,
    text: string,
    chatType: ChatType = ChatType.PRIVATE
  ): Promise<IMMessage> {
    if (!this.bot) {
      throw new Error('Bot not initialized');
    }

    try {
      // 使用限流器控制发送速率
      return await this.rateLimiter.execute('telegram', async () => {
        // 代理模式：原样透传 claudecode 输出，不使用 Markdown 格式化，避免中文等字符被转义导致乱码
        const message = await this.bot!.sendMessage(userId, text, {});

        // 转换为IMMessage格式
        return this.convertToIMMessage(message, chatType);
      });
    } catch (error) {
      logger.error(`Failed to send text message to ${userId}:`, error);
      throw error;
    }
  }

  /**
   * 发送卡片消息
   */
  async sendCard(
    userId: string,
    card: CardContent,
    chatType: ChatType = ChatType.PRIVATE
  ): Promise<IMMessage> {
    if (!this.bot) {
      throw new Error('Bot not initialized');
    }

    try {
      // 将卡片转换为文本消息和内联键盘
      const text = this.formatCardToText(card);
      const keyboard = this.formatCardToKeyboard(card);

      const options: TelegramBot.SendMessageOptions = {
        parse_mode: 'Markdown',
      };

      if (keyboard) {
        options.reply_markup = {
          inline_keyboard: keyboard,
        };
      }

      // 发送消息
      const message = await this.bot.sendMessage(userId, text, options);

      // 转换为IMMessage格式
      return this.convertToIMMessage(message, chatType);
    } catch (error) {
      logger.error(`Failed to send card message to ${userId}:`, error);
      throw error;
    }
  }

  /**
   * 更新消息
   */
  async updateMessage(options: UpdateMessageOptions): Promise<IMMessage> {
    if (!this.bot) {
      throw new Error('Bot not initialized');
    }

    try {
      const { messageId, content } = options;

      // 确定聊天ID和消息ID
      // Telegram的messageId是全局的，但我们需要chat_id来编辑消息
      // 这里假设messageId格式为 "chatId:messageId"
      const [chatId, telegramMessageId] = messageId.split(':');

      let text: string;
      let keyboard: TelegramBot.InlineKeyboardButton[][] | undefined;

      if (typeof content === 'string') {
        text = this.messageFormatter.formatMarkdown(content);
      } else {
        text = this.formatCardToText(content);
        keyboard = this.formatCardToKeyboard(content);
      }

      const editOptions: TelegramBot.EditMessageTextOptions = {
        parse_mode: 'Markdown',
      };

      if (keyboard) {
        editOptions.reply_markup = {
          inline_keyboard: keyboard,
        };
      }

      // 编辑消息
      const message = await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: parseInt(telegramMessageId),
        ...editOptions,
      });

      if (!message) {
        throw new Error('Failed to edit message');
      }

      // 转换为IMMessage格式
      return this.convertToIMMessage(message as TelegramBot.Message, ChatType.PRIVATE);
    } catch (error) {
      logger.error(`Failed to update message ${options.messageId}:`, error);
      throw error;
    }
  }

  /**
   * 下载媒体文件
   */
  async downloadMedia(fileKey: string): Promise<MediaInfo> {
    if (!this.bot) {
      throw new Error('Bot not initialized');
    }

    try {
      // 获取文件信息
      const file = await this.bot.getFile(fileKey);

      if (!file.file_path) {
        throw new Error('File path not available');
      }

      // 构建下载URL
      const downloadUrl = `https://api.telegram.org/file/bot${this.config?.appId}/${file.file_path}`;

      return {
        fileKey,
        fileName: file.file_path.split('/').pop() || 'unknown',
        fileSize: file.file_size || 0,
        fileType: this.getFileTypeFromPath(file.file_path),
        url: downloadUrl,
      };
    } catch (error) {
      logger.error(`Failed to download media ${fileKey}:`, error);
      throw error;
    }
  }

  /**
   * 注册事件监听器
   */
  on(event: string, listener: EventListener): void {
    this.eventEmitter.on(event as any, listener);
  }

  /**
   * 移除事件监听器
   */
  off(event: string, listener: EventListener): void {
    this.eventEmitter.off(event as any, listener);
  }

  /**
   * 检查客户端是否已初始化
   */
  isInitialized(): boolean {
    return this.isInitializedFlag;
  }

  /**
   * 检查客户端是否正在运行
   */
  isRunning(): boolean {
    return this.isRunningFlag;
  }

  /**
   * 设置消息处理器
   */
  private setupMessageHandlers(): void {
    if (!this.bot) return;

    // 监听文本消息
    this.bot.on('message', async (msg) => {
      try {
        const imMessage = this.convertToIMMessage(msg, this.getChatType(msg));

        // 触发消息接收事件
        await this.eventEmitter.emit('message:received', imMessage);

        logger.info(`Received message from ${msg.chat.id}: ${msg.text}`);
      } catch (error) {
        logger.error('Error processing message:', error);
      }
    });

    // 监听回调查询
    this.bot.on('callback_query', async (query) => {
      try {
        // 触发回调查询事件
        await this.eventEmitter.emit('callback_query', {
          id: query.id,
          from: query.from,
          message: query.message,
          data: query.data,
        });

        // 回答回调查询
        if (query.id && this.bot) {
          await this.bot.answerCallbackQuery(query.id);
        }

        logger.debug(`Received callback query from ${query.from?.id}: ${query.data}`);
      } catch (error) {
        logger.error('Error processing callback query:', error);
      }
    });

    // 监听错误
    this.bot.on('polling_error', async (error) => {
      logger.error('Polling error:', error);
      await this.eventEmitter.emit('error', {
        type: 'polling_error',
        error: error.message,
      });
    });
  }

  /**
   * 启动轮询
   */
  private async startPolling(): Promise<void> {
    if (!this.bot) return;

    try {
      await this.bot.startPolling();

      logger.info('Telegram polling started');
    } catch (error) {
      logger.error('Failed to start polling:', error);
      throw error;
    }
  }

  /**
   * 转换Telegram消息为IMMessage
   */
  private convertToIMMessage(
    msg: TelegramBot.Message,
    chatType: ChatType
  ): IMMessage {
    return {
      id: `${msg.chat.id}:${msg.message_id}`,
      type: msg.text ? MessageType.TEXT : MessageType.CARD,
      content: msg.text || '',
      userId: msg.from?.id.toString() || 'unknown',
      receiverId: msg.chat.id.toString(),
      groupId: chatType === ChatType.GROUP ? msg.chat.id.toString() : undefined,
      chatType,
      timestamp: msg.date * 1000, // Telegram使用秒级时间戳
      metadata: {
        edited: msg.edit_date !== undefined,
        replyToMessageId: msg.reply_to_message?.message_id.toString(),
      },
    };
  }

  /**
   * 获取聊天类型
   */
  private getChatType(msg: TelegramBot.Message): ChatType {
    if (msg.chat.type === 'private') {
      return ChatType.PRIVATE;
    } else if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
      return ChatType.GROUP;
    }
    return ChatType.PRIVATE;
  }

  /**
   * 将卡片格式化为文本
   */
  private formatCardToText(card: CardContent): string {
    let text = '';

    if (card.title) {
      text += `*${this.messageFormatter.escapeMarkdown(card.title)}*\n\n`;
    }

    for (const element of card.elements) {
      switch (element.type) {
        case 'div':
        case 'text':
          if (element.content.text) {
            text += `${element.content.text}\n`;
          }
          break;
        case 'hr':
          text += '---\n';
          break;
        case 'markdown':
          if (element.content.text) {
            text += `${element.content.text}\n`;
          }
          break;
      }
    }

    return text.trim();
  }

  /**
   * 将卡片格式化为内联键盘
   */
  private formatCardToKeyboard(card: CardContent): TelegramBot.InlineKeyboardButton[][] | undefined {
    const buttons: TelegramBot.InlineKeyboardButton[][] = [];

    for (const element of card.elements) {
      if (element.type === 'action') {
        const row: TelegramBot.InlineKeyboardButton[] = [];

        if (element.content.buttons) {
          for (const btn of element.content.buttons) {
            row.push({
              text: btn.text,
              callback_data: btn.value || btn.text,
            });
          }
        }

        if (row.length > 0) {
          buttons.push(row);
        }
      }
    }

    return buttons.length > 0 ? buttons : undefined;
  }

  /**
   * 从文件路径获取文件类型
   */
  private getFileTypeFromPath(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const typeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      mp4: 'video/mp4',
      mp3: 'audio/mpeg',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    return typeMap[ext || ''] || 'application/octet-stream';
  }

  /**
   * 获取MessageFormatter实例(供外部使用)
   */
  getMessageFormatter(): MessageFormatter {
    return this.messageFormatter;
  }

  /**
   * 获取InlineKeyboardBuilder实例(供外部使用)
   */
  getKeyboardBuilder(): InlineKeyboardBuilder {
    return this.keyboardBuilder;
  }
}

export default TelegramClient;
