/**
 * WeChat Client - 薄封装层，根据 loginMode 委托给对应 transport
 *
 * 支持两种通道：
 * - qclaw: 直连腾讯 JPRX 网关（默认）
 * - workbuddy: 通过 Centrifuge WebSocket 连接
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger.js';
import type { Config } from '../config.js';
import type {
  AGPEnvelope,
  WeChatChannelState,
  WeChatToken,
} from './types.js';
import type { WeChatTransport } from './transport.js';
import { QClawTransport, type QClawTransportConfig } from './qclaw-transport.js';
import { WorkBuddyTransport, type WorkBuddyTransportConfig } from './workbuddy-transport.js';

const log = createLogger('WeChat');
const TOKEN_FILE = 'wechat-token.json';

// Global state
let transport: WeChatTransport | null = null;
let channelState: WeChatChannelState = 'disconnected';
let currentToken: WeChatToken | null = null;
let tokenStoragePath: string | null = null;
let isStopping = false;

// Event handlers
let messageHandler: ((data: unknown) => Promise<void>) | null = null;
let stateChangeHandler: ((state: WeChatChannelState) => void) | null = null;

/**
 * Dispatch incoming AGP envelope to the event handler
 */
export async function dispatchIncomingAGPEnvelope(
  envelope: AGPEnvelope,
  handler: ((data: unknown) => Promise<void>) | null,
): Promise<void> {
  switch (envelope.method) {
    case 'ping':
      // Respond to ping with pong via transport
      if (transport) {
        transport.send('ping', { timestamp: Date.now() }, envelope.msg_id);
      }
      break;

    case 'session.prompt':
    case 'session.update':
    case 'session.cancel':
      if (handler) {
        await handler(envelope);
      }
      break;

    case 'session.promptResponse':
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
 * Initialize WeChat client
 */
export async function initWeChat(
  config: Config,
  eventHandler: (data: unknown) => Promise<void>,
  onStateChange?: (state: WeChatChannelState) => void,
): Promise<void> {
  messageHandler = eventHandler;
  stateChangeHandler = onStateChange ?? null;
  isStopping = false;

  // Set up token storage path
  const baseDir = config.logDir ?? join(process.env.HOME ?? '', '.open-im');
  tokenStoragePath = join(baseDir, 'data');
  if (!existsSync(tokenStoragePath)) {
    mkdirSync(tokenStoragePath, { recursive: true });
  }

  // Load existing token if available
  await loadToken();

  // Determine login mode from config
  const loginMode = config.platforms.wechat?.loginMode ?? 'qclaw';
  log.info(`Initializing WeChat with loginMode: ${loginMode}`);

  if (loginMode === 'workbuddy') {
    transport = createWorkBuddyTransport(config);
  } else {
    transport = createQClawTransport(config);
  }

  // Wire up transport callbacks
  transport.onMessage(async (envelope) => {
    await dispatchIncomingAGPEnvelope(envelope, messageHandler);
  });

  transport.onStateChange((state) => {
    channelState = state;
    if (stateChangeHandler) {
      stateChangeHandler(state);
    }
  });

  await transport.start();
  log.info(`WeChat client initialized (${loginMode} mode)`);
}

/**
 * Create QClaw transport from config
 */
function createQClawTransport(config: Config): QClawTransport {
  const qclawConfig: QClawTransportConfig = {
    channelToken: config.wechatToken,
    jwtToken: config.wechatJwtToken ?? config.platforms.wechat?.jwtToken,
    loginKey: config.wechatLoginKey ?? config.platforms.wechat?.loginKey,
    guid: config.wechatGuid,
    userId: config.wechatUserId,
    wsUrl: config.wechatWsUrl,
  };

  return new QClawTransport(qclawConfig);
}

/**
 * Create WorkBuddy transport from config
 */
function createWorkBuddyTransport(config: Config): WorkBuddyTransport {
  const wp = config.platforms.wechat;
  const workbuddyConfig: WorkBuddyTransportConfig = {
    accessToken: wp?.workbuddyAccessToken ?? '',
    refreshToken: wp?.workbuddyRefreshToken ?? '',
    userId: config.wechatUserId ?? wp?.userId ?? '',
    hostId: wp?.workbuddyHostId,
    baseUrl: wp?.workbuddyBaseUrl,
  };

  return new WorkBuddyTransport(workbuddyConfig);
}

/**
 * Send AGP message through the transport
 */
export function sendAGPMessage<T>(
  method: string,
  payload: T,
  replyTo?: string,
): void {
  if (!transport) {
    log.warn('Cannot send message: transport not initialized');
    return;
  }

  transport.send(method, payload, replyTo);
}

/**
 * Stop WeChat client
 */
export function stopWeChat(): void {
  isStopping = true;
  if (transport) {
    transport.stop();
    transport = null;
  }
  channelState = 'disconnected';
  log.info('WeChat client stopped');
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
