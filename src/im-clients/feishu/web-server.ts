/**
 * 飞书 Webhook 服务器
 * 接收并处理飞书事件推送
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { Server } from 'http';
import crypto from 'crypto';
import { EventEmitter } from '../../core/event-emitter';
import { Logger } from '../../utils/logger';

/**
 * Webhook 事件类型
 */
export enum WebhookEventType {
  MESSAGE_RECEIVED = 'im.message.receive_v1',
  MESSAGE_READ = 'im.message.message_read_v1',
  MESSAGE_RECALLED = 'im.message.message_recalled_v1',
  BOT_ADDED = 'im.chat.member.bot_added_v1',
  BOT_REMOVED = 'im.chat.member.bot_deleted_v1',
}

/**
 * 飞书事件请求体
 */
interface FeishuEventRequest {
  token?: string;
  challenge?: string;
  type?: string;
  event?: {
    header: {
      event_id: string;
      event_type: string;
      tenant_key: string;
      timestamp: string;
    };
    event: any;
  };
  schema?: string;
}

/**
 * Web 服务器配置
 */
export interface WebServerConfig {
  port: number;
  path?: string;
  verifyToken?: string;
  encryptKey?: string;
}

/**
 * 验证结果
 */
interface VerifyResult {
  success: boolean;
  error?: string;
}

/**
 * 飞书 Webhook 服务器类
 */
export class FeishuWebServer extends EventEmitter {
  private app: Express;
  private server?: Server;
  private config: WebServerConfig;
  private webLogger: Logger;
  private isRunning: boolean = false;

  constructor(config: WebServerConfig) {
    super();
    this.config = config;
    this.webLogger = new Logger('FeishuWebServer');

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * 设置中间件
   */
  private setupMiddleware(): void {
    // 解析 JSON
    this.app.use(express.json());

    // 请求日志
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      this.webLogger.debug(`${req.method} ${req.path}`);
      next();
    });

    // 错误处理
    this.app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      this.webLogger.error('Request error:', err);
      res.status(500).json({
        code: 500,
        msg: 'Internal server error',
      });
    });
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    const path = this.config.path || '/webhook/feishu';

    // 健康检查
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        timestamp: Date.now(),
      });
    });

    // Webhook 主路由
    this.app.post(path, this.handleWebhook.bind(this));
  }

  /**
   * 处理 Webhook 请求
   */
  private async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body as FeishuEventRequest;

      this.webLogger.debug('Received webhook request:', body);

      // URL 验证
      if (body.type === 'url_verification') {
        await this.handleUrlVerification(req, res, body);
        return;
      }

      // 事件推送
      if (body.schema === '2.0' && body.event) {
        await this.handleEventPush(req, res, body);
        return;
      }

      // 不支持的请求类型
      this.webLogger.warn('Unsupported request type:', body.type);
      res.status(400).json({
        code: 400,
        msg: 'Bad request',
      });
    } catch (error) {
      this.webLogger.error('Error handling webhook:', error);
      res.status(500).json({
        code: 500,
        msg: 'Internal server error',
      });
    }
  }

  /**
   * 处理 URL 验证
   */
  private async handleUrlVerification(
    req: Request,
    res: Response,
    body: FeishuEventRequest
  ): Promise<void> {
    this.webLogger.info('Handling URL verification');

    // 验证 token
    if (this.config.verifyToken && body.token !== this.config.verifyToken) {
      this.webLogger.warn('Invalid verify token');
      res.status(403).json({
        code: 403,
        msg: 'Forbidden',
      });
      return;
    }

    // 返回 challenge
    res.json({
      challenge: body.challenge,
    });

    this.webLogger.info('URL verification successful');
  }

  /**
   * 处理事件推送
   */
  private async handleEventPush(
    req: Request,
    res: Response,
    body: FeishuEventRequest
  ): Promise<void> {
    this.webLogger.debug('Handling event push');

    // 验证签名 (如果配置了加密密钥)
    if (this.config.encryptKey) {
      const verifyResult = this.verifySignature(req);
      if (!verifyResult.success) {
        this.webLogger.warn('Signature verification failed:', verifyResult.error);
        res.status(403).json({
          code: 403,
          msg: 'Forbidden',
        });
        return;
      }
    }

    const { header, event } = body.event!;

    this.webLogger.info(`Received event: ${header.event_type}`, {
      eventId: header.event_id,
      timestamp: header.timestamp,
    });

    // 触发事件
    await this.emit('webhook:event', {
      eventType: header.event_type,
      eventId: header.event_id,
      tenantKey: header.tenant_key,
      timestamp: header.timestamp,
      data: event,
    });

    // 特定事件的处理
    await this.handleSpecificEvent(header.event_type, event, header);

    // 返回成功
    res.json({
      code: 0,
      msg: 'success',
    });
  }

  /**
   * 处理特定事件
   */
  private async handleSpecificEvent(eventType: string, event: any, header: any): Promise<void> {
    switch (eventType) {
      case WebhookEventType.MESSAGE_RECEIVED:
        await this.handleMessageReceived(event);
        break;

      case WebhookEventType.MESSAGE_READ:
        await this.emit('message:read', { event, header });
        break;

      case WebhookEventType.MESSAGE_RECALLED:
        await this.emit('message:recalled', { event, header });
        break;

      case WebhookEventType.BOT_ADDED:
        await this.emit('bot:added', { event, header });
        break;

      case WebhookEventType.BOT_REMOVED:
        await this.emit('bot:removed', { event, header });
        break;

      default:
        this.webLogger.debug(`Unhandled event type: ${eventType}`);
    }
  }

  /**
   * 处理接收到的消息
   */
  private async handleMessageReceived(event: any): Promise<void> {
    try {
      const {
        sender,
        message,
        chat_id,
        msg_type,
        parent_id,
      } = event;

      const messageData = {
        messageId: message.message_id,
        senderId: sender.sender_id.open_id,
        senderType: sender.sender_type,
        chatType: message.chat_type,
        chatId: chat_id,
        messageType: msg_type,
        parentMessageId: parent_id,
        createTime: message.create_time,
        content: message.content,
      };

      await this.emit('message:received', messageData);

      this.webLogger.debug('Message received event emitted:', messageData);
    } catch (error) {
      this.webLogger.error('Error handling message received:', error);
    }
  }

  /**
   * 验证请求签名
   */
  private verifySignature(req: Request): VerifyResult {
    try {
      const signature = req.headers['x-lark-request-signature'] as string;
      const timestamp = req.headers['x-lark-request-timestamp'] as string;
      const nonce = req.headers['x-lark-request-nonce'] as string;

      if (!signature || !timestamp || !nonce) {
        return {
          success: false,
          error: 'Missing signature headers',
        };
      }

      if (!this.config.encryptKey) {
        return {
          success: false,
          error: 'No encrypt key configured',
        };
      }

      // 构造签名串
      const body = JSON.stringify(req.body);
      const signString = `${timestamp}\n${nonce}\n${body}`;

      // 计算签名
      const computedSignature = crypto
        .createHmac('sha256', this.config.encryptKey)
        .update(signString)
        .digest('base64');

      if (signature !== computedSignature) {
        return {
          success: false,
          error: 'Signature mismatch',
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.webLogger.warn('Server is already running');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, () => {
          this.isRunning = true;
          this.webLogger.info(`Feishu webhook server started on port ${this.config.port}`);
          this.webLogger.info(`Webhook endpoint: http://localhost:${this.config.port}${this.config.path || '/webhook/feishu'}`);
          resolve();
        });

        this.server.on('error', (error) => {
          this.webLogger.error('Server error:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.webLogger.warn('Server is not running');
      return;
    }

    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error) => {
        if (error) {
          this.webLogger.error('Error stopping server:', error);
          reject(error);
        } else {
          this.isRunning = false;
          this.webLogger.info('Feishu webhook server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * 检查服务器是否正在运行
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * 获取服务器端口
   */
  getPort(): number {
    return this.config.port;
  }
}
