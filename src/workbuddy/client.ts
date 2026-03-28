/**
 * WorkBuddy Client - Main client for WorkBuddy WeChat integration
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createLogger } from '../logger.js';
import type { Config } from '../config.js';
import { WorkBuddyOAuth } from './oauth.js';
import { WorkBuddyCentrifugeClient, type CentrifugeCallbacks } from './centrifuge-client.js';
import type { WorkBuddyState, CentrifugeTokens } from './types.js';

const log = createLogger('WorkBuddy');
const CREDENTIALS_FILE = 'workbuddy-credentials.json';
const DEFAULT_BASE_URL = 'https://copilot.tencent.com';
const DEFAULT_WORKSPACE_ID = 'open-im-workspace';
const DEFAULT_WORKSPACE_NAME = 'OpenIM Workspace';

// Global state
let oauth: WorkBuddyOAuth | null = null;
let centrifugeClient: WorkBuddyCentrifugeClient | null = null;
let channelState: WorkBuddyState = 'disconnected';
let credentialsPath: string | null = null;
let currentSessionId: string | null = null;

// Event handlers
let messageHandler: ((chatId: string, msgId: string, content: string) => Promise<void>) | null = null;
let stateChangeHandler: ((state: WorkBuddyState) => void) | null = null;

/**
 * Get current channel state
 */
export function getChannelState(): WorkBuddyState {
  return channelState;
}

/**
 * Initialize WorkBuddy client with CodeBuddy OAuth and Centrifuge WebSocket
 */
export async function initWorkBuddy(
  config: Config,
  eventHandler: (chatId: string, msgId: string, content: string) => Promise<void>,
  onStateChange?: (state: WorkBuddyState) => void,
): Promise<void> {
  const platformConfig = config.platforms?.workbuddy;
  if (!platformConfig?.enabled) {
    throw new Error('WorkBuddy platform not enabled');
  }

  // Check credentials
  const hasCredentials = platformConfig.accessToken && platformConfig.refreshToken && platformConfig.userId;
  if (!hasCredentials) {
    throw new Error('WorkBuddy credentials required: accessToken, refreshToken, userId');
  }

  log.info('Initializing WorkBuddy client...');

  messageHandler = eventHandler;
  stateChangeHandler = onStateChange ?? null;

  // Set up credentials storage path
  const baseDir = config.logDir ?? join(process.env.HOME ?? '', '.open-im');
  credentialsPath = join(baseDir, 'data');
  if (!existsSync(credentialsPath)) {
    mkdirSync(credentialsPath, { recursive: true });
  }

  // Initialize OAuth client
  const baseUrl = platformConfig.baseUrl || DEFAULT_BASE_URL;
  oauth = new WorkBuddyOAuth(baseUrl);
  oauth.loadCredentials({
    accessToken: platformConfig.accessToken,
    refreshToken: platformConfig.refreshToken,
    userId: platformConfig.userId,
  });

  // Build session ID
  currentSessionId = oauth.buildSessionId(platformConfig.workspacePath);
  log.info(`WorkBuddy sessionId: ${currentSessionId ?? ''}`);

  // Register workspace to get Centrifuge tokens
  let centrifugeTokens: CentrifugeTokens;
  try {
    centrifugeTokens = await oauth.registerWorkspace({
      userId: platformConfig.userId || '',
      hostId: hostname(),
      workspaceId: DEFAULT_WORKSPACE_ID,
      workspaceName: DEFAULT_WORKSPACE_NAME,
    });
    log.info(`Registered workspace: channel=${centrifugeTokens.channel}`);
  } catch (err) {
    log.error('Failed to register workspace:', err);
    throw new Error(`WorkBuddy workspace registration failed: ${err}`);
  }

  // Generate GUID for this instance
  const guid = platformConfig.guid || randomUUID();
  const workspaceSessionId: string = currentSessionId || '';

  // Create Centrifuge client
  const callbacks: CentrifugeCallbacks = {
    onConnected: () => {
      log.info('WorkBuddy Centrifuge connected');
      updateState('connected');
    },
    onDisconnected: (reason) => {
      log.info(`WorkBuddy Centrifuge disconnected: ${reason}`);
      updateState('disconnected');
    },
    onError: (error) => {
      log.error('WorkBuddy Centrifuge error:', error);
      updateState('error');
    },
    onMessage: async (chatId, msgId, content) => {
      if (messageHandler) {
        try {
          await messageHandler(chatId, msgId, content);
        } catch (err) {
          log.error('Error in message handler:', err);
        }
      }
    },
  };

  centrifugeClient = new WorkBuddyCentrifugeClient(
    {
      url: centrifugeTokens.url,
      connectionToken: centrifugeTokens.connectionToken,
      subscriptionToken: centrifugeTokens.subscriptionToken,
      channel: centrifugeTokens.channel,
      guid,
      userId: platformConfig.userId || '',
      httpBaseUrl: baseUrl,
      httpAccessToken: platformConfig.accessToken || '',
      workspaceSessionId,
    },
    callbacks,
  );

  // Start Centrifuge client
  centrifugeClient.start();
  log.info('WorkBuddy client initialized');
}

/**
 * Get Centrifuge client for sending messages
 */
export function getCentrifugeClient(): WorkBuddyCentrifugeClient | null {
  return centrifugeClient;
}

/**
 * Get OAuth client
 */
export function getOAuth(): WorkBuddyOAuth | null {
  return oauth;
}

/**
 * Update channel state and notify listeners
 */
function updateState(state: WorkBuddyState): void {
  channelState = state;
  if (stateChangeHandler) {
    stateChangeHandler(state);
  }
  log.debug(`Channel state: ${state}`);
}

/**
 * Stop WorkBuddy client
 */
export function stopWorkBuddy(): void {
  log.info('Stopping WorkBuddy client...');
  if (centrifugeClient) {
    centrifugeClient.stop();
    centrifugeClient = null;
  }
  oauth = null;
  currentSessionId = null;
  updateState('disconnected');
  log.info('WorkBuddy client stopped');
}

/**
 * Helper to get hostname
 */
function hostname(): string {
  return process.env.HOSTNAME || process.env.COMPUTERNAME || 'unknown';
}
