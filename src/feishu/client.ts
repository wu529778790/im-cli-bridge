import { Client, WSClient, EventDispatcher, LoggerLevel } from '@larksuiteoapi/node-sdk';
import type { Config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('Feishu');

let client: Client | null = null;
let wsClient: WSClient | null = null;

export function getClient(): Client {
  if (!client) throw new Error('Feishu client not initialized');
  return client;
}

export async function initFeishu(
  config: Config,
  eventHandler: (data: unknown) => void
): Promise<void> {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error('Feishu app_id and app_secret are required');
  }

  client = new Client({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    loggerLevel: LoggerLevel.info,
    disableTokenCache: false,
  });

  // Create event dispatcher for WebSocket events
  const eventDispatcher = new EventDispatcher({});

  // Register event handler for message received
  // Note: register() takes an object with event type as key and handler as value
  eventDispatcher.register({
    'im.message.receive_v1': (data: unknown) => {
      log.debug('Received Feishu message event:', JSON.stringify(data).slice(0, 500));
      eventHandler(data);
    },
  });

  // Register catch-all handler using wildcard
  eventDispatcher.register({
    '*': (data: unknown) => {
      log.info('Received Feishu event (catch-all):', JSON.stringify(data).slice(0, 500));
      // Don't call eventHandler for catch-all, let specific handlers handle it
    },
  });

  // Start WebSocket connection for event receiving
  wsClient = new WSClient({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    loggerLevel: LoggerLevel.info,
  });

  try {
    // WSClient.start() requires eventDispatcher parameter
    await wsClient.start({ eventDispatcher });
    log.info('Feishu WebSocket started');
  } catch (err) {
    log.error('Failed to start Feishu WebSocket:', err);
    throw err;
  }

  log.info('Feishu client initialized');
}

export function stopFeishu(): void {
  if (wsClient) {
    wsClient.close();
    wsClient = null;
    log.info('Feishu WebSocket closed');
  }
  client = null;
}
