/**
 * WeWork (企业微信/WeCom) Client
 * 基于企业微信官方 AI_BOT WebSocket 协议
 * WebSocket URL: wss://openws.work.weixin.qq.com
 *
 * 消息接收：通过 WebSocket (aibot_msg_callback)
 * 消息发送：通过 WebSocket (aibot_respond_msg)，必须透传 req_id
 * 注意：长连接模式下不能用 HTTP response_url，会报 40008 invalid message type
 */

import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { createLogger } from '../logger.js';
import type { Config } from '../config.js';
import {
  WeWorkConnectionState,
  WeWorkCallbackMessage,
  WeWorkCommand,
  WeWorkResponseMessage,
  WeWorkResponse,
  WeWorkHttpResponseBody,
} from './types.js';

const log = createLogger('WeWork');
const DEFAULT_WS_URL = 'wss://openws.work.weixin.qq.com';
const HEARTBEAT_INTERVAL = 30000; // 30秒
const MAX_RECONNECT_ATTEMPTS = 100;

// Global state
let ws: WebSocket | null = null;
let connectionState: WeWorkConnectionState = 'disconnected';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;

// Event handlers
let messageHandler: ((data: WeWorkCallbackMessage) => Promise<void>) | null = null;
let stateChangeHandler: ((state: WeWorkConnectionState) => void) | null = null;

// Configuration
let config: {
  botId: string;
  secret: string;
  websocketUrl: string;
} | null = null;

/**
 * Generate unique request ID
 */
function generateReqId(): string {
  return `${Date.now()}-${randomBytes(8).toString('hex')}`;
}

/**
 * Get current connection state
 */
export function getConnectionState(): WeWorkConnectionState {
  return connectionState;
}

/**
 * 主动推送消息 (aibot_send_msg)
 * 用于启动/关闭通知等场景，无需用户消息触发
 * 注意：需用户曾与机器人对话后，才能向该会话主动推送
 */
export function sendProactiveMessage(chatId: string, content: string): void {
  if (!ws || connectionState !== 'connected') {
    log.error('Cannot send proactive message: WebSocket not connected');
    return;
  }
  if (!chatId) {
    log.error('Cannot send proactive message: chatId is required');
    return;
  }

  const message = {
    cmd: WeWorkCommand.AIBOT_SEND_MSG,
    headers: { req_id: generateReqId() },
    body: {
      chatid: chatId,
      chat_type: 1, // 单聊
      msgtype: 'markdown',
      markdown: { content },
    },
  };
  try {
    ws.send(JSON.stringify(message));
    log.info(`[WeWork] Sent aibot_send_msg to ${chatId}`);
  } catch (err) {
    log.error('Error sending proactive message:', err);
  }
}

/**
 * Send reply via WebSocket (aibot_respond_msg)
 * 长连接模式下必须用此方式回复，透传 req_id
 */
export function sendWebSocketReply(reqId: string, body: WeWorkHttpResponseBody): void {
  if (!ws || connectionState !== 'connected') {
    log.error('Cannot send reply: WebSocket not connected');
    return;
  }
  if (!reqId) {
    log.error('Cannot send reply: req_id is required');
    return;
  }

  const message = {
    cmd: WeWorkCommand.AIBOT_RESPOND_MSG,
    headers: { req_id: reqId },
    body,
  };
  try {
    ws.send(JSON.stringify(message));
    log.debug(`[WeWork] Sent aibot_respond_msg: msgtype=${body.msgtype}`);
  } catch (err) {
    log.error('Error sending WebSocket reply:', err);
  }
}

/**
 * Initialize WeWork client with WebSocket connection
 */
export async function initWeWork(
  cfg: Config,
  eventHandler: (data: WeWorkCallbackMessage) => Promise<void>,
  onStateChange?: (state: WeWorkConnectionState) => void,
): Promise<void> {
  if (!cfg.weworkCorpId || !cfg.weworkSecret) {
    throw new Error('WeWork botId and secret are required');
  }

  config = {
    botId: cfg.weworkCorpId, // CorpId 实际上就是 botId
    secret: cfg.weworkSecret,
    websocketUrl: cfg.weworkWsUrl || DEFAULT_WS_URL,
  };

  messageHandler = eventHandler;
  stateChangeHandler = onStateChange ?? null;

  log.info(`Initializing WeWork client (botId: ${config.botId})`);
  // 首次连接支持重试：单独启用企微时偶发 TLS 连接失败，加飞书后因初始化顺序有“预热”效果则稳定
  const maxAttempts = 3;
  const retryDelayMs = 1500;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await connectWebSocket(true); // true = 初始连接，close 时不 scheduleReconnect
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        log.warn(`WeWork connection attempt ${attempt}/${maxAttempts} failed (${lastErr.message}), retrying in ${retryDelayMs}ms...`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }
  throw lastErr ?? new Error('WeWork connection failed');
}

/**
 * Connect to WeWork WebSocket server
 * @param isInitialConnect - 初始连接时为 true，close 时不 scheduleReconnect（由 initWeWork 重试）
 */
async function connectWebSocket(isInitialConnect = false): Promise<void> {
  if (connectionState === 'connecting') {
    log.warn('WebSocket connection already in progress');
    return;
  }

  if (!config) {
    throw new Error('WeWork config not initialized');
  }

  // 重试前清理旧连接
  if (ws) {
    try {
      ws.removeAllListeners();
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }

  updateState('connecting');

  const websocketUrl = config.websocketUrl || DEFAULT_WS_URL;

  return new Promise<void>((resolve, reject) => {
    try {
      ws = new WebSocket(websocketUrl);

      ws.on('open', async () => {
        log.info('WeWork WebSocket connected');
        reconnectAttempts = 0;
        updateState('connected');
        startHeartbeat();

        // 发送认证订阅消息，并等待服务端确认（否则 aibot_send_msg 会报 846609 not subscribed）
        try {
          await sendSubscribeAndWaitAck(resolve, reject);
          log.info('WeWork authentication successful');
        } catch (err) {
          log.error('WeWork authentication failed:', err);
          reject(err);
        }
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as WeWorkCallbackMessage | WeWorkResponse;
          await handleMessage(message);
        } catch (err) {
          log.error('Error parsing WebSocket message:', err);
        }
      });

      ws.on('error', (err) => {
        log.error('WeWork WebSocket error:', err);
        updateState('error');
        reject(err);
      });

      ws.on('close', () => {
        log.info('WeWork WebSocket closed');
        stopHeartbeat();
        updateState('disconnected');
        if (!isInitialConnect) {
          scheduleReconnect();
        }
      });
    } catch (err) {
      log.error('Error creating WebSocket connection:', err);
      updateState('error');
      reject(err);
    }
  });
}

/** 等待订阅确认的回调，收到服务端 errcode 响应后调用 */
let subscribeAckResolve: (() => void) | null = null;
let subscribeAckReject: ((err: Error) => void) | null = null;

/**
 * 发送认证订阅消息，并等待服务端 errcode: 0 确认
 * 必须在收到确认后才能发送 aibot_send_msg，否则报 846609 not subscribed
 */
function sendSubscribeAndWaitAck(
  onSuccess: () => void,
  onError: (err: Error) => void
): void {
  if (!config || !ws) {
    throw new Error('WebSocket not connected');
  }

  subscribeAckResolve = onSuccess;
  subscribeAckReject = onError;

  const subscribeMessage = {
    cmd: WeWorkCommand.SUBSCRIBE,
    headers: { req_id: generateReqId() },
    body: {
      secret: config.secret,
      bot_id: config.botId,
    },
  };

  ws.send(JSON.stringify(subscribeMessage));
  log.debug('Sent subscribe message, waiting for ack...');
}

/**
 * Handle incoming WebSocket message
 */
async function handleMessage(message: WeWorkCallbackMessage | WeWorkResponse): Promise<void> {
  // 检查是否是响应消息（我们发送的消息的响应）
  if ('errcode' in message) {
    const response = message as { errcode: number; errmsg: string };
    // 若在等待订阅确认，优先处理
    if (subscribeAckResolve || subscribeAckReject) {
      const resolve = subscribeAckResolve;
      const reject = subscribeAckReject;
      subscribeAckResolve = null;
      subscribeAckReject = null;
      if (response.errcode === 0) {
        log.debug('Subscribe ack received');
        resolve?.();
      } else {
        log.error(`WeWork subscribe failed: ${response.errcode} - ${response.errmsg}`);
        reject?.(new Error(`Subscribe failed: ${response.errcode} ${response.errmsg}`));
      }
      return;
    }
    if (response.errcode !== 0) {
      log.error(`WeWork error response: ${response.errcode} - ${response.errmsg}`);
    } else {
      log.debug('WeWork message sent successfully');
    }
    return;
  }

  // 处理回调消息
  if ('cmd' in message && message.cmd === WeWorkCommand.AIBOT_CALLBACK) {
    const callback = message as WeWorkCallbackMessage;
    log.info(`[WeWork] Received message: msgtype=${callback.body.msgtype}, from=${callback.body.from.userid}, chatid=${callback.body.chatid}`);

    if (messageHandler) {
      try {
        await messageHandler(callback);
      } catch (err) {
        log.error('Error in message handler:', err);
      }
    }
  }
}

/**
 * Send message to WeWork
 */
export function sendMessage(message: WeWorkResponseMessage): void {
  if (!ws || connectionState !== 'connected') {
    log.warn('Cannot send message: WebSocket not connected');
    return;
  }

  try {
    ws.send(JSON.stringify(message));
    log.info(`[WeWork] Sent message: ${message.cmd}, msgtype=${message.body.msgtype}`);
  } catch (err) {
    log.error('Error sending message:', err);
  }
}

/**
 * Send text message via WebSocket (requires req_id from callback)
 * 企业微信 aibot_respond_msg 仅支持 stream 和 template_card，不支持 text/markdown
 * 使用 stream 格式，finish=true 表示一次性回复
 */
export function sendText(reqId: string, content: string): void {
  const streamId = `${Date.now()}-${randomBytes(8).toString('hex')}`;
  sendWebSocketReply(reqId, {
    msgtype: 'stream',
    stream: { id: streamId, finish: true, content },
  });
}

/**
 * Send stream message via WebSocket (requires req_id from callback)
 */
export function sendStream(reqId: string, streamId: string, content: string, finish: boolean): void {
  sendWebSocketReply(reqId, {
    msgtype: 'stream',
    stream: { id: streamId, finish, content },
  });
}

/**
 * Update connection state and notify listeners
 */
function updateState(state: WeWorkConnectionState): void {
  connectionState = state;
  if (stateChangeHandler) {
    stateChangeHandler(state);
  }
  log.debug('Connection state:', state);
}

/**
 * Start heartbeat to keep connection alive
 */
function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (connectionState === 'connected' && ws) {
      const pingMessage = {
        cmd: WeWorkCommand.PING,
        headers: {
          req_id: generateReqId(),
        },
        body: {},
      };
      try {
        ws.send(JSON.stringify(pingMessage));
        log.debug('Sent ping');
      } catch (err) {
        log.error('Error sending ping:', err);
      }
    }
  }, HEARTBEAT_INTERVAL);
}

/**
 * Stop heartbeat
 */
function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Schedule reconnection attempt
 */
function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    log.error('Max reconnect attempts reached');
    return;
  }

  const interval = 5000; // 5秒后重连
  reconnectTimer = setTimeout(async () => {
    reconnectAttempts++;
    log.info(`Reconnecting... Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
    try {
      await connectWebSocket(false); // 非初始连接，close 时继续 scheduleReconnect
    } catch (err) {
      log.error('Reconnection failed:', err);
    }
  }, interval);
}

/**
 * Stop WeWork client
 */
export function stopWeWork(): void {
  stopHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  updateState('disconnected');
  log.info('WeWork client stopped');
}
