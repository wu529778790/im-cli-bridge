/**
 * WeWork (企业微信) Client - API client and WebSocket connection management
 *
 * 企业微信 API 参考：
 * - 获取 access_token: https://developer.work.weixin.qq.com/document/path/91039
 * - 发送消息: https://developer.work.weixin.qq.com/document/path/90236
 * - 接收消息: 使用回调模式或长连接模式
 */

import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLogger } from '../logger.js';
import type { Config } from '../config.js';
import type {
  WeWorkTokenResponse,
  WeWorkToken,
  WeWorkConnectionState,
  WeWorkSendMessageRequest,
  WeWorkSendMessageResponse,
  WeWorkCallbackEvent,
} from './types.js';

const log = createLogger('WeWork');
const TOKEN_FILE = 'wework-token.json';

// WeWork API endpoints
const API_BASE_URL = 'https://qyapi.weixin.qq.com/cgi-bin';
const GET_TOKEN_URL = `${API_BASE_URL}/gettoken`;
const SEND_MESSAGE_URL = `${API_BASE_URL}/message/send`;

// WebSocket endpoint (WeWork uses a callback URL for receiving messages)
// Note: The actual WebSocket endpoint needs to be configured in WeWork admin console
const DEFAULT_WEWORK_WS_URL = 'wss://qyapi.weixin.qq.com/cgi-bin/wxpush';

// Global state
let ws: WebSocket | null = null;
let connectionState: WeWorkConnectionState = 'disconnected';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
let currentToken: WeWorkToken | null = null;
let tokenStoragePath: string | null = null;

// Configuration
let corpId: string;
let agentId: string;
let secret: string;

// Event handlers
let messageHandler: ((data: WeWorkCallbackEvent) => Promise<void>) | null = null;
let stateChangeHandler: ((state: WeWorkConnectionState) => void) | null = null;

/**
 * Get current connection state
 */
export function getConnectionState(): WeWorkConnectionState {
  return connectionState;
}

/**
 * Get current WeWork token
 */
export function getCurrentToken(): WeWorkToken | null {
  return currentToken;
}

/**
 * Get API access token, with auto-refresh if needed
 */
export async function getAccessToken(): Promise<string> {
  // Check if we have a valid token
  if (currentToken && currentToken.expiresAt > Date.now() + 60000) {
    return currentToken.accessToken;
  }

  // Fetch new token
  await refreshAccessToken();
  if (!currentToken) {
    throw new Error('Failed to obtain access token');
  }

  return currentToken.accessToken;
}

/**
 * Refresh access token from WeWork API
 */
async function refreshAccessToken(): Promise<void> {
  const url = `${GET_TOKEN_URL}?corpid=${corpId}&corpsecret=${secret}`;

  try {
    const response = await fetch(url);
    const data = (await response.json()) as WeWorkTokenResponse;

    if (data.errcode === 0 && data.access_token) {
      const expiresAt = Date.now() + (data.expires_in - 300) * 1000; // 5 min buffer
      currentToken = {
        accessToken: data.access_token,
        expiresAt,
      };
      saveToken();
      log.info('Access token refreshed successfully');
    } else {
      throw new Error(`Failed to get access token: ${data.errmsg} (${data.errcode})`);
    }
  } catch (err) {
    log.error('Failed to refresh access token:', err);
    throw err;
  }
}

/**
 * Send message via WeWork API
 */
export async function sendMessage(
  request: WeWorkSendMessageRequest
): Promise<WeWorkSendMessageResponse> {
  const accessToken = await getAccessToken();
  const url = `${SEND_MESSAGE_URL}?access_token=${accessToken}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    const data = (await response.json()) as WeWorkSendMessageResponse;

    if (data.errcode === 0) {
      log.debug(`Message sent successfully: ${data.msgid}`);
    } else {
      log.warn(`Send message failed: ${data.errmsg} (${data.errcode})`);
    }

    return data;
  } catch (err) {
    log.error('Failed to send message:', err);
    throw err;
  }
}

/**
 * Initialize WeWork client with WebSocket connection
 */
export async function initWeWork(
  config: Config,
  eventHandler: (data: WeWorkCallbackEvent) => Promise<void>,
  onStateChange?: (state: WeWorkConnectionState) => void,
): Promise<void> {
  if (!config.weworkCorpId || !config.weworkAgentId || !config.weworkSecret) {
    throw new Error('WeWork corp_id, agent_id, and secret are required');
  }

  corpId = config.weworkCorpId;
  agentId = config.weworkAgentId;
  secret = config.weworkSecret;

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

  // Get initial access token
  await getAccessToken();

  // Connect to WebSocket for receiving messages
  await connectWebSocket();

  log.info('WeWork client initialized');
}

/**
 * Connect to WeWork WebSocket server
 */
async function connectWebSocket(): Promise<void> {
  if (connectionState === 'connecting') {
    log.warn('WebSocket connection already in progress');
    return;
  }

  updateState('connecting');

  return new Promise((resolve, reject) => {
    try {
      // WeWork uses a specific WebSocket URL format
      // The URL needs to be configured in the WeWork admin console
      const wsUrl = `${DEFAULT_WEWORK_WS_URL}?corpid=${corpId}&agentid=${agentId}`;

      ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        log.info('WeWork WebSocket connected');
        reconnectAttempts = 0;
        updateState('connected');
        startHeartbeat();
        resolve();
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          log.debug('Received WebSocket message:', message);
          await handleWebSocketMessage(message);
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
        scheduleReconnect();
      });
    } catch (err) {
      log.error('Error creating WebSocket connection:', err);
      updateState('error');
      reject(err);
    }
  });
}

/**
 * Handle incoming WebSocket message
 */
async function handleWebSocketMessage(message: unknown): Promise<void> {
  if (!messageHandler) return;

  try {
    // WeWork callback events have a specific structure
    const event = message as WeWorkCallbackEvent;

    // Handle different message types
    if (event.MsgType === 'text' || event.MsgType === 'image' || event.MsgType === 'file') {
      await messageHandler(event);
    } else if (event.Event === 'subscribe') {
      log.info('User subscribed:', event.FromUserName);
    } else if (event.Event === 'unsubscribe') {
      log.info('User unsubscribed:', event.FromUserName);
    } else if (event.Event === 'enter_agent') {
      log.info('User entered agent scope:', event.FromUserName);
    } else if (event.Event === 'exit_agent') {
      log.info('User left agent scope:', event.FromUserName);
    } else {
      log.debug('Unhandled event type:', event.Event || event.MsgType);
    }
  } catch (err) {
    log.error('Error in message handler:', err);
  }
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
      try {
        ws.ping();
      } catch (err) {
        log.debug('Failed to send ping:', err);
      }
    }
  }, 30000); // 30 seconds
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
  const maxAttempts = 10;
  if (reconnectAttempts >= maxAttempts) {
    log.error('Max reconnect attempts reached');
    return;
  }

  const interval = 5000; // 5 seconds
  reconnectTimer = setTimeout(async () => {
    reconnectAttempts++;
    log.info(`Reconnecting... Attempt ${reconnectAttempts}/${maxAttempts}`);
    try {
      await connectWebSocket();
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
      currentToken = JSON.parse(data) as WeWorkToken;

      // Check if token is expired
      if (currentToken.expiresAt < Date.now()) {
        log.info('Token expired, need to refresh');
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

/**
 * Get Agent ID for message sending
 */
export function getAgentId(): string {
  return agentId;
}
