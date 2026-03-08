/**
 * 飞书 IM 客户端
 * 实现飞书机器人的消息接收和发送功能
 */

import {
  IMClient,
  IMClientConfig,
  IMMessage,
  MessageType,
  ChatType,
  CardContent,
  MediaInfo,
  UpdateMessageOptions,
  EventListener,
} from '../../interfaces/im-client.interface';
import { FeishuApi } from './api';
import { FeishuWebServer } from './web-server';
import { CardBuilder } from './card-builder';
import { EventEmitter } from '../../core/event-emitter';
import { Logger } from '../../utils/logger';
import { WebSocket, WebSocketServer } from 'ws';
import { RateLimiter } from '../../utils/rate-limit';

/**
 * 飞书客户端配置
 */
export interface FeishuClientConfig extends IMClientConfig {
  /** Webhook 服务器端口 */
  webhookPort?: number;
  /** Webhook 路径 */
  webhookPath?: string;
  /** 是否启动 Webhook 服务器 */
  enableWebhook?: boolean;
}

/**
 * 连接状态
 */
enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
}

/**
 * 飞书 IM 客户端类
 */
export class FeishuClient implements IMClient {
  private api: FeishuApi;
  private webServer?: FeishuWebServer;
  private eventEmitter: EventEmitter;
  private logger: Logger;
  private config: FeishuClientConfig;
  private initialized: boolean = false;
  private running: boolean = false;
  private ws?: WebSocket;
  private wsServer?: WebSocketServer;
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private rateLimiter: RateLimiter;

  constructor() {
    this.logger = new Logger('FeishuClient');
    this.eventEmitter = new EventEmitter();
    this.config = {} as FeishuClientConfig;
    this.api = {} as FeishuApi;
    this.rateLimiter = new RateLimiter({
      enabled: true,
      platforms: {
        feishu: { rate: 20, capacity: 50 } // Feishu: 20 msg/sec
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
    if (this.initialized) {
      this.logger.warn('Client already initialized');
      return;
    }

    this.config = config as FeishuClientConfig;

    this.logger.info('Initializing Feishu client', {
      appId: config.appId,
      debug: config.debug,
    });

    // 初始化 API
    this.api = new FeishuApi({
      appId: config.appId,
      appSecret: config.appSecret || '',
      apiEndpoint: config.apiEndpoint,
      timeout: config.timeout,
    });

    // 初始化 Webhook 服务器
    if (this.config.enableWebhook !== false) {
      const webhookPort = this.config.webhookPort || 3000;
      const webhookPath = this.config.webhookPath || '/webhook/feishu';

      this.webServer = new FeishuWebServer({
        port: webhookPort,
        path: webhookPath,
        verifyToken: this.config.verifyToken,
        encryptKey: this.config.encryptKey,
      });

      // 注册 Webhook 事件监听器
      this.webServer.on('webhook:event', this.handleWebhookEvent.bind(this));
      this.webServer.on('message:received', this.handleMessageReceived.bind(this));
      this.webServer.on('message:read', this.handleMessageRead.bind(this));
      this.webServer.on('message:recalled', this.handleMessageRecalled.bind(this));
    }

    this.initialized = true;
    this.logger.info('Feishu client initialized successfully');
  }

  /**
   * 启动客户端
   */
  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Client not initialized');
    }

    if (this.running) {
      this.logger.warn('Client already running');
      return;
    }

    this.logger.info('Starting Feishu client');

    try {
      // 启动 Webhook 服务器
      if (this.webServer) {
        await this.webServer.start();
        this.logger.info('Webhook server started');
      }

      // 启动 WebSocket (如果需要)
      // await this.startWebSocket();

      this.running = true;
      this.connectionStatus = ConnectionStatus.CONNECTED;
      this.logger.info('Feishu client started successfully');

      await this.eventEmitter.emit('client:started', {
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error('Failed to start Feishu client:', error);
      throw error;
    }
  }

  /**
   * 停止客户端
   */
  async stop(): Promise<void> {
    if (!this.running) {
      this.logger.warn('Client not running');
      return;
    }

    this.logger.info('Stopping Feishu client');

    try {
      // 停止 Webhook 服务器
      if (this.webServer) {
        await this.webServer.stop();
        this.logger.info('Webhook server stopped');
      }

      // 停止 WebSocket
      if (this.ws) {
        this.ws.close();
        this.ws = undefined;
      }

      if (this.wsServer) {
        this.wsServer.close();
        this.wsServer = undefined;
      }

      // 清除重连定时器
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }

      this.running = false;
      this.connectionStatus = ConnectionStatus.DISCONNECTED;
      this.reconnectAttempts = 0;

      this.logger.info('Feishu client stopped');

      await this.eventEmitter.emit('client:stopped', {
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error('Error stopping Feishu client:', error);
      throw error;
    }
  }

  /**
   * 发送文本消息
   */
  async sendText(userId: string, text: string, chatType: ChatType = ChatType.PRIVATE): Promise<IMMessage> {
    if (!this.running) {
      throw new Error('Client not running');
    }

    this.logger.debug(`Sending text message to ${userId}`);

    try {
      // 使用限流器控制发送速率
      const messageId = await this.rateLimiter.execute('feishu', async () => {
        return await this.api.sendText(userId, text);
      });

      const message: IMMessage = {
        id: messageId,
        type: MessageType.TEXT,
        content: text,
        userId: this.config.appId,
        receiverId: userId,
        chatType,
        timestamp: Date.now(),
        status: 'sent',
      };

      await this.eventEmitter.emit('message:sent', message);

      return message;
    } catch (error) {
      this.logger.error('Failed to send text message:', error);
      throw error;
    }
  }

  /**
   * 发送卡片消息
   */
  async sendCard(userId: string, card: CardContent, chatType: ChatType = ChatType.PRIVATE): Promise<IMMessage> {
    if (!this.running) {
      throw new Error('Client not running');
    }

    this.logger.debug(`Sending card message to ${userId}`);

    try {
      // 将卡片转换为 JSON 字符串
      const cardJson = JSON.stringify({
        schema: card.version || '2.0',
        body: {
          title: card.title ? {
            tag: 'plain_text',
            content: card.title,
          } : undefined,
          elements: card.elements,
        },
        config: card.config,
      }, (key, value) => value === undefined ? null : value);

      const messageId = await this.api.sendCard(userId, cardJson);

      const message: IMMessage = {
        id: messageId,
        type: MessageType.CARD,
        content: card,
        userId: this.config.appId,
        receiverId: userId,
        chatType,
        timestamp: Date.now(),
        status: 'sent',
      };

      await this.eventEmitter.emit('message:sent', message);

      return message;
    } catch (error) {
      this.logger.error('Failed to send card message:', error);
      throw error;
    }
  }

  /**
   * 更新消息
   */
  async updateMessage(options: UpdateMessageOptions): Promise<IMMessage> {
    if (!this.running) {
      throw new Error('Client not running');
    }

    this.logger.debug(`Updating message ${options.messageId}`);

    try {
      let content: string;

      if (typeof options.content === 'string') {
        content = options.content;
      } else {
        // 将卡片转换为 JSON 字符串
        content = JSON.stringify({
          schema: options.content.version || '2.0',
          body: {
            title: options.content.title ? {
              tag: 'plain_text',
              content: options.content.title,
            } : undefined,
            elements: options.content.elements,
          },
          config: options.content.config,
        }, (key, value) => value === undefined ? null : value);
      }

      await this.api.updateMessage(options.messageId, content);

      const message: IMMessage = {
        id: options.messageId,
        type: typeof options.content === 'string' ? MessageType.TEXT : MessageType.CARD,
        content: options.content,
        userId: this.config.appId,
        chatType: ChatType.PRIVATE,
        timestamp: Date.now(),
        metadata: {
          edited: true,
        },
        status: 'sent',
      };

      await this.eventEmitter.emit('message:updated', message);

      return message;
    } catch (error) {
      this.logger.error('Failed to update message:', error);
      throw error;
    }
  }

  /**
   * 下载媒体文件
   */
  async downloadMedia(fileKey: string): Promise<MediaInfo> {
    if (!this.running) {
      throw new Error('Client not running');
    }

    this.logger.debug(`Downloading media file ${fileKey}`);

    try {
      const { buffer, contentType } = await this.api.downloadMedia('', fileKey, 'file');

      // 从 fileKey 中提取文件信息
      const fileName = fileKey.split('/').pop() || fileKey;

      return {
        fileKey,
        fileName,
        fileSize: buffer.length,
        fileType: contentType,
      };
    } catch (error) {
      this.logger.error('Failed to download media:', error);
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
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 检查是否正在运行
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 获取 API 实例
   */
  getApi(): FeishuApi {
    return this.api;
  }

  /**
   * 获取 Web 服务器实例
   */
  getWebServer(): FeishuWebServer | undefined {
    return this.webServer;
  }

  /**
   * 处理 Webhook 事件
   */
  private async handleWebhookEvent(data: any): Promise<void> {
    this.logger.debug('Webhook event received:', data);

    await this.eventEmitter.emit('webhook:event', data);
  }

  /**
   * 处理接收到的消息
   */
  private async handleMessageReceived(data: any): Promise<void> {
    this.logger.debug('Message received:', data);

    // 解析消息内容
    let content = data.content;
    let type = MessageType.TEXT;

    try {
      if (typeof content === 'string') {
        content = JSON.parse(content);
      }

      // 根据消息类型设置类型
      if (data.messageType === 'image') {
        type = MessageType.IMAGE;
      } else if (data.messageType === 'audio') {
        type = MessageType.AUDIO;
      } else if (data.messageType === 'video') {
        type = MessageType.VIDEO;
      } else if (data.messageType === 'file') {
        type = MessageType.FILE;
      }
    } catch (error) {
      this.logger.warn('Failed to parse message content:', error);
    }

    const message: IMMessage = {
      id: data.messageId,
      type,
      content,
      userId: data.senderId,
      chatType: data.chatType === 'group' ? ChatType.GROUP : ChatType.PRIVATE,
      groupId: data.chatId,
      timestamp: data.createTime ? new Date(data.createTime).getTime() : Date.now(),
    };

    await this.eventEmitter.emit('message:received', message);
  }

  /**
   * 处理消息已读事件
   */
  private async handleMessageRead(data: any): Promise<void> {
    this.logger.debug('Message read:', data);
    await this.eventEmitter.emit('message:read', data);
  }

  /**
   * 处理消息撤回事件
   */
  private async handleMessageRecalled(data: any): Promise<void> {
    this.logger.debug('Message recalled:', data);
    await this.eventEmitter.emit('message:recalled', data);
  }

  /**
   * WebSocket 重连
   */
  private async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnect attempts reached');
      this.connectionStatus = ConnectionStatus.DISCONNECTED;
      return;
    }

    this.reconnectAttempts++;
    this.connectionStatus = ConnectionStatus.RECONNECTING;

    this.logger.info(`Reconnecting... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    // 指数退避
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.start();
        this.reconnectAttempts = 0;
      } catch (error) {
        this.logger.error('Reconnect failed:', error);
        await this.reconnect();
      }
    }, delay);
  }
}
