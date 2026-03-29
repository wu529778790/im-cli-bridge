/**
 * QClaw Transport - 通过腾讯 JPRX 网关直连微信
 *
 * 连接 wss://mmgrcalltoken.3g.qq.com/agentwss，
 * 使用 QClaw API 获取 channelToken 进行认证。
 * 支持消息去重、WS ping/pong 心跳、指数退避重连。
 */

import { WebSocket } from 'ws';
import { createLogger } from '../logger.js';
import type { AGPEnvelope, WeChatChannelState, WeChatWebSocketConfig } from './types.js';
import type { WeChatTransport, MessageHandler, StateChangeHandler } from './transport.js';
import { QClawAPI } from './auth/qclaw-api.js';
import { getEnvironment } from './auth/environments.js';
import { getDeviceGuid } from './auth/device-guid.js';

const log = createLogger('WeChat:QClaw');
const PONG_TIMEOUT_FACTOR = 3;

export interface QClawTransportConfig {
  /** QClaw 环境：production 或 test */
  environment?: string;
  /** QClaw wxAppId */
  wxAppId?: string;
  /** AGP channel token（连接凭证） */
  channelToken?: string;
  /** JWT Token（用于刷新 channelToken） */
  jwtToken?: string;
  /** loginKey（用于 API 调用） */
  loginKey?: string;
  /** 设备 GUID */
  guid?: string;
  /** 用户 ID */
  userId?: string;
  /** 自定义 WebSocket URL（覆盖默认 QClaw 地址） */
  wsUrl?: string;
  /** 心跳间隔 ms */
  heartbeatInterval?: number;
  /** 重连间隔 ms */
  reconnectInterval?: number;
  /** 最大重连次数 */
  maxReconnectAttempts?: number;
}

export class QClawTransport implements WeChatTransport {
  private config: QClawTransportConfig;
  private state: WeChatChannelState = 'disconnected';
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private isStopping = false;
  private lastServerResponseTime = 0;
  private wsConfigRef: WeChatWebSocketConfig | null = null;
  private processedMsgIds = new Set<string>();
  private static readonly MAX_MSG_ID_CACHE = 1000;

  private messageHandler: MessageHandler | null = null;
  private stateChangeHandler: StateChangeHandler | null = null;

  // Token management
  private channelToken: string;
  private jwtToken: string;
  private guid: string;

  constructor(config: QClawTransportConfig) {
    this.config = config;
    this.channelToken = config.channelToken ?? '';
    this.jwtToken = config.jwtToken ?? '';
    this.guid = config.guid || getDeviceGuid();
  }

  async start(): Promise<void> {
    this.isStopping = false;

    // Refresh channel token before connecting
    if (this.jwtToken && this.config.loginKey) {
      try {
        const env = getEnvironment(
          this.config.environment ?? 'production',
          this.config.wxAppId ?? 'wx9d11056dd75b7240',
        );
        const api = new QClawAPI(env, this.guid, this.jwtToken);
        api.loginKey = this.config.loginKey;
        const freshToken = await api.refreshChannelToken();
        if (freshToken) {
          this.channelToken = freshToken;
          log.info('Channel token refreshed successfully');
        }
      } catch (err) {
        log.warn('Failed to refresh channel token, using existing:', err);
      }
    }

    const wsUrl = this.config.wsUrl
      ?? `wss://mmgrcalltoken.3g.qq.com/agentwss?token=${encodeURIComponent(this.channelToken)}&guid=${encodeURIComponent(this.guid)}&user_id=${encodeURIComponent(this.config.userId ?? '')}`;

    const wsConfig: WeChatWebSocketConfig = {
      url: wsUrl,
      reconnectInterval: this.config.reconnectInterval ?? 3000,
      maxReconnectAttempts: this.config.maxReconnectAttempts ?? 10,
      heartbeatInterval: this.config.heartbeatInterval ?? 20000,
    };

    await this.connectWebSocket(wsConfig);
  }

  stop(): void {
    this.isStopping = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.updateState('disconnected');
    log.info('QClaw transport stopped');
  }

  send(method: string, payload: unknown, replyTo?: string): void {
    if (!this.ws || this.state !== 'connected') {
      log.warn('Cannot send message: not connected');
      return;
    }

    const envelope: AGPEnvelope = {
      msg_id: replyTo ?? this.generateMsgId(),
      guid: this.guid,
      user_id: this.config.userId,
      method: method as AGPEnvelope['method'],
      payload,
    };

    try {
      this.ws.send(JSON.stringify(envelope));
      log.debug('Sent AGP message:', method);
    } catch (err) {
      log.error('Error sending AGP message:', err);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateChangeHandler = handler;
  }

  getState(): WeChatChannelState {
    return this.state;
  }

  private async connectWebSocket(config: WeChatWebSocketConfig): Promise<void> {
    this.wsConfigRef = config;
    if (this.state === 'connecting') {
      log.warn('WebSocket connection already in progress');
      return;
    }

    this.updateState('connecting');

    return new Promise((resolve, reject) => {
      let settled = false;
      const connectionTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        log.error('WebSocket connection timeout');
        this.updateState('error');
        try { this.ws?.close(); } catch { /* ignore */ }
        reject(new Error('WeChat QClaw WebSocket connection timeout'));
      }, 30000);

      try {
        this.ws = new WebSocket(config.url);

        this.ws.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(connectionTimeout);
          log.info('QClaw WebSocket connected');
          this.reconnectAttempts = 0;
          this.lastServerResponseTime = Date.now();
          this.updateState('connected');
          this.startHeartbeat(config.heartbeatInterval ?? 20000);
          resolve();
        });

        this.ws.on('message', async (data: Buffer) => {
          this.lastServerResponseTime = Date.now();
          try {
            const envelope = JSON.parse(data.toString()) as AGPEnvelope;
            // Dedup
            if (envelope.msg_id) {
              if (this.processedMsgIds.has(envelope.msg_id)) {
                log.debug('Duplicate message, skipping:', envelope.msg_id);
                return;
              }
              this.processedMsgIds.add(envelope.msg_id);
              this.cleanMsgIdCache();
            }
            await this.handleAGPMessage(envelope);
          } catch (err) {
            log.error('Error parsing WebSocket message:', err);
          }
        });

        this.ws.on('error', (err) => {
          if (settled) {
            log.error('QClaw WebSocket error (after open):', err);
            return;
          }
          settled = true;
          clearTimeout(connectionTimeout);
          log.error('QClaw WebSocket error:', err);
          this.updateState('error');
          reject(err);
        });

        this.ws.on('close', () => {
          clearTimeout(connectionTimeout);
          log.info('QClaw WebSocket closed');
          this.stopHeartbeat();
          this.updateState('disconnected');
          if (!settled) {
            settled = true;
            reject(new Error('QClaw WebSocket closed before open'));
            return;
          }
          this.scheduleReconnect(config);
        });

        // WS-level ping/pong for heartbeat
        this.ws.on('ping', () => {
          this.lastServerResponseTime = Date.now();
        });
      } catch (err) {
        settled = true;
        clearTimeout(connectionTimeout);
        log.error('Error creating WebSocket connection:', err);
        this.updateState('error');
        reject(err);
      }
    });
  }

  private async handleAGPMessage(envelope: AGPEnvelope): Promise<void> {
    switch (envelope.method) {
      case 'ping':
        this.send('ping', { timestamp: Date.now() }, envelope.msg_id);
        break;

      case 'session.prompt':
      case 'session.update':
      case 'session.cancel':
        if (this.messageHandler) {
          await this.messageHandler(envelope);
        }
        break;

      case 'session.promptResponse':
        log.debug('Received prompt response:', envelope.payload);
        break;

      default:
        log.warn('Unknown AGP method:', envelope.method);
    }
  }

  private startHeartbeat(interval: number): void {
    this.stopHeartbeat();
    this.lastServerResponseTime = Date.now();

    this.heartbeatTimer = setInterval(() => {
      if (this.state !== 'connected') return;

      const elapsed = Date.now() - this.lastServerResponseTime;
      const pongTimeout = interval * PONG_TIMEOUT_FACTOR;
      if (this.lastServerResponseTime > 0 && elapsed > pongTimeout) {
        log.warn(`No server response for ${Math.round(elapsed / 1000)}s, forcing reconnect`);
        this.stopHeartbeat();
        if (this.ws) {
          try {
            this.ws.removeAllListeners();
            this.ws.close();
          } catch { /* ignore */ }
          this.ws = null;
        }
        this.updateState('disconnected');
        if (this.wsConfigRef) {
          this.scheduleReconnect(this.wsConfigRef);
        }
        return;
      }

      // WS-level ping
      if (this.ws) {
        try {
          this.ws.ping();
        } catch { /* ignore */ }
      }
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(config: WeChatWebSocketConfig): void {
    if (this.isStopping) return;
    if (this.reconnectTimer) return;

    const maxAttempts = config.maxReconnectAttempts ?? 10;
    if (this.reconnectAttempts >= maxAttempts) {
      log.warn(`Max reconnect attempts (${maxAttempts}) reached, resetting counter`);
      this.reconnectAttempts = 0;
    }

    const baseInterval = config.reconnectInterval ?? 3000;
    const backoff = Math.min(baseInterval * Math.pow(1.5, Math.floor(this.reconnectAttempts / 3)), 25000);
    const interval = Math.round(backoff);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      log.info(`Reconnecting... Attempt ${this.reconnectAttempts}/${maxAttempts} (${interval}ms)`);
      try {
        await this.start();
      } catch (err) {
        log.error('Reconnection failed:', err);
      }
    }, interval);
  }

  private updateState(state: WeChatChannelState): void {
    this.state = state;
    this.stateChangeHandler?.(state);
    log.debug('Channel state:', state);
  }

  private generateMsgId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  private cleanMsgIdCache(): void {
    if (this.processedMsgIds.size > QClawTransport.MAX_MSG_ID_CACHE) {
      const entries = [...this.processedMsgIds];
      this.processedMsgIds.clear();
      entries.slice(-QClawTransport.MAX_MSG_ID_CACHE / 2).forEach((id) => {
        this.processedMsgIds.add(id);
      });
    }
  }
}
