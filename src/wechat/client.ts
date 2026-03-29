/**
 * WeChat Client — 通过 WorkBuddy（CodeBuddy OAuth + Centrifuge）连接微信
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger.js';
import type { Config } from '../config.js';
import type {
  AGPEnvelope,
  WeChatChannelState,
  WeChatToken,
} from './types.js';
import type { WeChatTransport } from './transport.js';
import { WorkBuddyTransport, type WorkBuddyTransportConfig } from './workbuddy-transport.js';

const log = createLogger('WeChat');
const TOKEN_FILE = 'wechat-token.json';

// Global state
let transport: WeChatTransport | null = null;
let channelState: WeChatChannelState = 'disconnected';
let currentToken: WeChatToken | null = null;
let tokenStoragePath: string | null = null;
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
  const baseDir = config.logDir ?? join(process.env.HOME ?? '', '.open-im');
  tokenStoragePath = join(baseDir, 'data');
  if (!existsSync(tokenStoragePath)) {
    mkdirSync(tokenStoragePath, { recursive: true });
  }

  await loadToken();

  log.info('Initializing WeChat (WorkBuddy)');
  transport = createWorkBuddyTransport(config);

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
  log.info('WeChat client initialized (WorkBuddy)');
}

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
