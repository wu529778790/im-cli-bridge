/**
 * WeChat Client - AGP WebSocket implementation for WeChat integration
 */

import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLogger } from '../logger.js';
import type { Config } from '../config.js';
import type {
  AGPEnvelope,
  WeChatChannelState,
  WeChatToken,
  WeChatWebSocketConfig,
  WeChatOAuthConfig,
} from './types.js';

const log = createLogger('WeChat');
const TOKEN_FILE = 'wechat-token.json';
const DEFAULT_WECHAT_WS_URL = 'wss://openclau-wechat.henryxiaoyang.workers.dev';

// Global state
let ws: WebSocket | null = null;
let channelState: WeChatChannelState = 'disconnected';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
let currentToken: WeChatToken | null = null;
let tokenStoragePath: string | null = null;

// Event handlers
let messageHandler: ((data: unknown) => Promise<void>) | null = null;
let stateChangeHandler: ((state: WeChatChannelState) => void) | null = null;

export async function dispatchIncomingAGPEnvelope(
  envelope: AGPEnvelope,
  handler: ((data: unknown) => Promise<void>) | null,
): Promise<void> {
  switch (envelope.method) {
    case 'ping':
      // Respond to ping with pong
      sendAGPMessage('ping', { timestamp: Date.now() }, envelope.msg_id);
      break;

    case 'session.prompt':
    case 'session.update':
    case 'session.cancel':
      if (handler) {
        await handler(envelope);
      }
      break;

    case 'session.promptResponse':
      // Handle response to our prompt
      log.debug('Received prompt response:', envelope.payload);
      break;

    default:
      log.warn('Unknown AGP method:', envelope.method);
  }
}

/**
 * Get current channel state
 */
export function getChannelState(): WeChatChannelState {
  return channelState;
}

/**
 * Get current WeChat token
 */
export function getCurrentToken(): WeChatToken | null {
  return currentToken;
}

/**
 * Initialize WeChat client with AGP WebSocket connection
 */
export async function initWeChat(
  config: Config,
  eventHandler: (data: unknown) => Promise<void>,
  onStateChange?: (state: WeChatChannelState) => void,
): Promise<void> {
  // AGP 协议使用 token + guid，标准协议使用 appId + appSecret
  const hasAGPCreds = config.wechatToken && config.wechatGuid;
  const hasStandardCreds = config.wechatAppId && config.wechatAppSecret;

  if (!hasAGPCreds && !hasStandardCreds) {
    throw new Error('WeChat credentials required: AGP (token + guid) or standard (appId + appSecret)');
  }

  if (hasAGPCreds) {
    log.info('Using AGP protocol for WeChat');
  } else {
    log.info('Using standard OAuth protocol for WeChat');
  }

  messageHandler = eventHandler;
  stateChangeHandler = onStateChange ?? null;

  // Set up token storage path
  const baseDir = config.logDir ?? join(process.env.HOME ?? '', '.open-im');
  tokenStoragePath = join(baseDir, 'data');
  if (!existsSync(tokenStoragePath)) {
    mkdirSync(tokenStoragePath, { recursive: true });
  }

  // Load existing token if available
  await loadToken();

  // Configure WebSocket
  const wsConfig: WeChatWebSocketConfig = {
    url: config.wechatWsUrl ?? DEFAULT_WECHAT_WS_URL,
    reconnectInterval: 5000,
    maxReconnectAttempts: 10,
    heartbeatInterval: 30000,
  };

  await connectWebSocket(wsConfig);
  log.info('WeChat client initialized');
}

/**
 * Connect to AGP WebSocket server
 */
async function connectWebSocket(config: WeChatWebSocketConfig): Promise<void> {
  if (channelState === 'connecting') {
    log.warn('WebSocket connection already in progress');
    return;
  }

  updateState('connecting');

  return new Promise((resolve, reject) => {
    try {
      ws = new WebSocket(config.url);

      ws.on('open', () => {
        log.info('WeChat WebSocket connected');
        reconnectAttempts = 0;
        updateState('connected');
        startHeartbeat(config.heartbeatInterval ?? 30000);
        resolve();
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const envelope = JSON.parse(data.toString()) as AGPEnvelope;
          log.debug('Received AGP message:', envelope.method);
          await handleAGPMessage(envelope);
        } catch (err) {
          log.error('Error parsing WebSocket message:', err);
        }
      });

      ws.on('error', (err) => {
        log.error('WeChat WebSocket error:', err);
        updateState('error');
        reject(err);
      });

      ws.on('close', () => {
        log.info('WeChat WebSocket closed');
        stopHeartbeat();
        updateState('disconnected');
        scheduleReconnect(config);
      });
    } catch (err) {
      log.error('Error creating WebSocket connection:', err);
      updateState('error');
      reject(err);
    }
  });
}

/**
 * Handle incoming AGP messages
 */
async function handleAGPMessage(envelope: AGPEnvelope): Promise<void> {
  try {
    await dispatchIncomingAGPEnvelope(envelope, messageHandler);
  } catch (err) {
    if (envelope.method === 'session.prompt' || envelope.method === 'session.update' || envelope.method === 'session.cancel') {
      log.error('Error in message handler:', err);
      return;
    }

    throw err;
  }
}

/**
 * Send AGP message through WebSocket
 */
export function sendAGPMessage<T>(
  method: string,
  payload: T,
  replyTo?: string,
): void {
  if (!ws || channelState !== 'connected') {
    log.warn('Cannot send message: WebSocket not connected');
    return;
  }

  const envelope: AGPEnvelope<T> = {
    msg_id: replyTo ?? generateMsgId(),
    method: method as AGPEnvelope['method'],
    payload,
  };

  try {
    ws.send(JSON.stringify(envelope));
    log.debug('Sent AGP message:', method);
  } catch (err) {
    log.error('Error sending AGP message:', err);
  }
}

/**
 * Generate unique message ID
 */
function generateMsgId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Update channel state and notify listeners
 */
function updateState(state: WeChatChannelState): void {
  channelState = state;
  if (stateChangeHandler) {
    stateChangeHandler(state);
  }
  log.debug('Channel state:', state);
}

/**
 * Start heartbeat to keep connection alive
 */
function startHeartbeat(interval: number): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (channelState === 'connected') {
      sendAGPMessage('ping', { timestamp: Date.now() });
    }
  }, interval);
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
function scheduleReconnect(config: WeChatWebSocketConfig): void {
  const maxAttempts = config.maxReconnectAttempts ?? 10;
  if (reconnectAttempts >= maxAttempts) {
    log.error('Max reconnect attempts reached');
    return;
  }

  const interval = config.reconnectInterval ?? 5000;
  reconnectTimer = setTimeout(async () => {
    reconnectAttempts++;
    log.info(`Reconnecting... Attempt ${reconnectAttempts}/${maxAttempts}`);
    try {
      await connectWebSocket(config);
    } catch (err) {
      log.error('Reconnection failed:', err);
    }
  }, interval);
}

/**
 * Load token from storage
 */
async function loadToken(): Promise<void> {
  if (!tokenStoragePath) return;

  const tokenPath = join(tokenStoragePath, TOKEN_FILE);
  if (existsSync(tokenPath)) {
    try {
      const data = readFileSync(tokenPath, 'utf-8');
      currentToken = JSON.parse(data) as WeChatToken;

      // Check if token is expired
      if (currentToken.expires_at < Date.now()) {
        log.info('Token expired, need to re-authenticate');
        currentToken = null;
      } else {
        log.info('Loaded existing token from storage');
      }
    } catch (err) {
      log.error('Error loading token:', err);
      currentToken = null;
    }
  }
}

/**
 * Save token to storage
 */
function saveToken(): void {
  if (!currentToken || !tokenStoragePath) return;

  try {
    const tokenPath = join(tokenStoragePath, TOKEN_FILE);
    writeFileSync(tokenPath, JSON.stringify(currentToken, null, 2), 'utf-8');
    log.info('Token saved to storage');
  } catch (err) {
    log.error('Error saving token:', err);
  }
}

/**
 * Stop WeChat client
 */
export function stopWeChat(): void {
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
  log.info('WeChat client stopped');
}
