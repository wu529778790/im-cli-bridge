/**
 * WorkBuddy Client - CodeBuddy OAuth + Centrifuge WebSocket for WeChat KF
 *
 * Manages the full lifecycle: connect → register WeChat KF channel → heartbeat →
 * auto-reconnect on drop.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hostname, homedir } from 'node:os';
import { createLogger } from '../logger.js';
import type { Config } from '../config.js';
import { WorkBuddyOAuth } from './oauth.js';
import { WorkBuddyCentrifugeClient } from './centrifuge-client.js';
import type { WorkBuddyState, CentrifugeTokens } from './types.js';

const log = createLogger('WorkBuddy');

const RECONNECT_DELAYS_MS = [3000, 5000, 10000, 20000, 30000];
const CHANNEL_HEARTBEAT_MS = 30_000;

// Global state
let oauthClient: WorkBuddyOAuth | null = null;
let centrifugeClient: WorkBuddyCentrifugeClient | null = null;
let channelState: WorkBuddyState = 'disconnected';
let messageHandler: ((chatId: string, msgId: string, content: string) => Promise<void>) | null = null;
let stateChangeHandler: ((state: WorkBuddyState) => void) | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let stopped = false;
let platformConfig: NonNullable<NonNullable<Config['platforms']>['workbuddy']> | null = null;

export function getChannelState(): WorkBuddyState {
  return channelState;
}

export async function initWorkBuddy(
  config: Config,
  eventHandler: (chatId: string, msgId: string, content: string) => Promise<void>,
  onStateChange?: (state: WorkBuddyState) => void,
): Promise<void> {
  const pc = config.platforms?.workbuddy;
  if (!pc?.enabled) {
    throw new Error('WorkBuddy platform not enabled');
  }
  if (!pc.accessToken || !pc.refreshToken || !pc.userId) {
    throw new Error('WorkBuddy credentials required: accessToken, refreshToken, userId');
  }

  platformConfig = pc;
  messageHandler = eventHandler;
  stateChangeHandler = onStateChange ?? null;
  stopped = false;
  reconnectAttempt = 0;

  const baseDir = config.logDir ?? join(process.env.HOME ?? '', '.open-im');
  const dataDir = join(baseDir, 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const baseUrl = pc.baseUrl ?? 'https://copilot.tencent.com';
  oauthClient = new WorkBuddyOAuth(baseUrl);
  oauthClient.loadCredentials({
    accessToken: pc.accessToken,
    refreshToken: pc.refreshToken,
    userId: pc.userId,
  });

  await connect();
  log.info('WorkBuddy client initialized');
}

async function connect(): Promise<void> {
  if (stopped || !oauthClient || !platformConfig) return;

  const oauth = oauthClient;
  const pc = platformConfig;
  const baseUrl = pc.baseUrl ?? 'https://copilot.tencent.com';
  const hostId = hostname();
  // Claw workspace path — matches the plugin's WorkBuddy Claw installation path.
  // The directory does NOT need to exist; the server uses it as a string identifier.
  const clawPath = join(homedir(), 'WorkBuddy', 'Claw');

  log.info('Registering WorkBuddy host workspace...');
  let tokens: CentrifugeTokens;
  try {
    // Step 1: Register host workspace (workspaceId="") — gets the Centrifuge connection
    tokens = await oauth.registerWorkspace({
      userId: pc.userId ?? '',
      hostId,
      workspaceId: '',
      workspaceName: 'Host Channel',
    });
  } catch (err) {
    log.error('Host workspace registration failed:', err);
    scheduleReconnect();
    return;
  }

  // sessionId = userId_hostId_clawPath (matches plugin's buildSessionId format)
  const workspaceSessionId = oauth.buildSessionId(clawPath);
  const channel = tokens.channel;
  const guid = pc.guid ?? randomUUID();

  log.info(`Host workspace registered: channel=${channel}, clawSessionId=${workspaceSessionId}`);

  if (centrifugeClient) {
    centrifugeClient.stop();
    centrifugeClient = null;
  }

  // Mutex flag: prevents the heartbeat from overriding channelId while a reply is in flight.
  let replyLock = false;

  // Re-registers the WeChat KF channel with the given externalUserId as channelId.
  // The WorkBuddy server uses channelId as the WeChat send_msg `touser`, so this
  // must be called with the customer's external_userid before sending each reply.
  // Sets replyLock=true to block the heartbeat from overriding while we send.
  const registerChannelFn = async (externalUserId: string): Promise<void> => {
    replyLock = true;
    const clawSessionId = oauth.buildSessionId(clawPath);
    log.debug(`registerChannelFn: registering channelId=${externalUserId} (heartbeat paused)`);
    await oauth.registerChannel({
      type: 'wechatkf',
      sessionId: clawSessionId,
      channelId: externalUserId,
      userId: pc.userId ?? '',
    });
  };

  const releaseChannelLockFn = (): void => {
    replyLock = false;
    log.debug('registerChannelFn: reply sent, heartbeat resumed');
  };

  centrifugeClient = new WorkBuddyCentrifugeClient(
    {
      url: tokens.url,
      connectionToken: tokens.connectionToken,
      subscriptionToken: tokens.subscriptionToken,
      channel,
      guid,
      userId: pc.userId ?? '',
      httpBaseUrl: baseUrl,
      httpAccessToken: pc.accessToken ?? '',
      workspaceSessionId,
      registerChannelFn,
      releaseChannelLockFn,
    },
    {
      onConnected: () => {
        log.info('WorkBuddy Centrifuge connected');
        log.info(`WeChat KF sessionId: ${workspaceSessionId}`);
        reconnectAttempt = 0;
        updateState('connected');

        // Step 2: Register Claw workspace to get WeChat KF routing channel + sessionId
        oauth.registerWorkspace({
          userId: pc.userId ?? '',
          hostId,
          workspaceId: clawPath,
          workspaceName: 'Claw',
        }).then((clawParams: CentrifugeTokens & { sessionId?: string }) => {
          const clawSessionId = clawParams.sessionId ?? workspaceSessionId;
          log.info(`Claw workspace registered: channel=${clawParams.channel}, sessionId=${clawSessionId}`);

          // Subscribe to Claw channel — WeChat KF messages are published here
          centrifugeClient?.subscribeChannel(clawParams.channel, clawParams.subscriptionToken);

          const doRegister = () => {
            if (stopped || channelState !== 'connected') return;
            if (replyLock) {
              log.debug('Heartbeat skipped (reply in progress)');
              return;
            }
            oauth.registerChannel({
              type: 'wechatkf',
              sessionId: clawSessionId,
              channelId: pc.userId ?? '',  // plugin uses userId, not full channel name
              userId: pc.userId ?? '',
            })
              .then((res) => log.info(`WeChat KF channel registered (online): ${JSON.stringify(res)}`))
              .catch((err: unknown) => log.warn(`registerChannel failed: ${String(err)}`));
          };

          doRegister();
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(doRegister, CHANNEL_HEARTBEAT_MS);
        }).catch((err: unknown) => {
          log.error('Claw workspace registration failed:', err);
          // Fallback: register with host sessionId
          const doRegister = () => {
            if (stopped || channelState !== 'connected') return;
            if (replyLock) {
              log.debug('Heartbeat skipped (reply in progress, fallback path)');
              return;
            }
            oauth.registerChannel({
              type: 'wechatkf',
              sessionId: workspaceSessionId,
              channelId: pc.userId ?? '',
              userId: pc.userId ?? '',
            })
              .then((res) => log.info(`WeChat KF channel registered (fallback): ${JSON.stringify(res)}`))
              .catch((e: unknown) => log.warn(`registerChannel failed: ${String(e)}`));
          };
          doRegister();
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(doRegister, CHANNEL_HEARTBEAT_MS);
        });
      },
      onDisconnected: (reason) => {
        log.info(`WorkBuddy Centrifuge disconnected: ${reason}`);
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        updateState('disconnected');
        scheduleReconnect();
      },
      onError: (error) => {
        log.error('WorkBuddy Centrifuge error:', error);
        updateState('error');
      },
      onMessage: async (chatId, msgId, content) => {
        if (messageHandler) {
          try { await messageHandler(chatId, msgId, content); }
          catch (err) { log.error('Error in message handler:', err); }
        }
      },
    },
  );

  centrifugeClient.start();
}

function scheduleReconnect(): void {
  if (stopped) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
  reconnectAttempt++;
  log.info(`Reconnecting in ${delay}ms (attempt ${reconnectAttempt})...`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (stopped) return;
    try {
      await connect();
    } catch (err) {
      log.error('Reconnect attempt failed:', err);
      scheduleReconnect();
    }
  }, delay);
}

function updateState(state: WorkBuddyState): void {
  channelState = state;
  stateChangeHandler?.(state);
  log.debug(`WorkBuddy state: ${state}`);
}

export function getCentrifugeClient(): WorkBuddyCentrifugeClient | null {
  return centrifugeClient;
}

export function getOAuth(): WorkBuddyOAuth | null {
  return oauthClient;
}

export function stopWorkBuddy(): void {
  log.info('Stopping WorkBuddy client...');
  stopped = true;
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (centrifugeClient) { centrifugeClient.stop(); centrifugeClient = null; }
  oauthClient = null;
  platformConfig = null;
  updateState('disconnected');
  log.info('WorkBuddy client stopped');
}
