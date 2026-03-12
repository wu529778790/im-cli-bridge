import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream';
import type { Config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('DingTalk');

let client: DWClient | null = null;
let messageHandler: ((data: DWClientDownStream) => Promise<void>) | null = null;
const sessionWebhookByChat = new Map<string, string>();

function getClient(): DWClient {
  if (!client) {
    throw new Error('DingTalk client not initialized');
  }
  return client;
}

export function registerSessionWebhook(chatId: string, sessionWebhook: string): void {
  if (!chatId || !sessionWebhook) return;
  sessionWebhookByChat.set(chatId, sessionWebhook);
}

async function sendByWebhook(chatId: string, body: Record<string, unknown>): Promise<unknown> {
  const sessionWebhook = sessionWebhookByChat.get(chatId);
  if (!sessionWebhook) {
    throw new Error(`DingTalk sessionWebhook unavailable for chat ${chatId}`);
  }

  const accessToken = await getClient().getAccessToken();
  const res = await fetch(sessionWebhook, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-acs-dingtalk-access-token': String(accessToken),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DingTalk reply failed: ${res.status} ${text}`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function sendText(chatId: string, content: string): Promise<unknown> {
  return sendByWebhook(chatId, {
    msgtype: 'text',
    text: { content },
  });
}

export async function sendMarkdown(chatId: string, title: string, text: string): Promise<unknown> {
  return sendByWebhook(chatId, {
    msgtype: 'markdown',
    markdown: {
      title,
      text,
    },
  });
}

export function ackMessage(messageId: string, result: unknown = { ok: true }): void {
  if (!client || !messageId) return;
  try {
    client.socketCallBackResponse(messageId, result);
  } catch (err) {
    log.debug('Failed to ack DingTalk callback:', err);
  }
}

export async function initDingTalk(
  cfg: Config,
  eventHandler: (data: DWClientDownStream) => Promise<void>,
): Promise<void> {
  if (!cfg.dingtalkClientId || !cfg.dingtalkClientSecret) {
    throw new Error('DingTalk clientId and clientSecret are required');
  }

  messageHandler = eventHandler;
  client = new DWClient({
    clientId: cfg.dingtalkClientId,
    clientSecret: cfg.dingtalkClientSecret,
    keepAlive: true,
    debug: false,
  });

  client.registerCallbackListener(TOPIC_ROBOT, async (data: DWClientDownStream) => {
    if (!messageHandler) return;
    try {
      await messageHandler(data);
    } catch (err) {
      log.error('Unhandled DingTalk callback error:', err);
      ackMessage(data.headers.messageId, { error: String(err) });
    }
  });

  await client.connect();
  log.info('DingTalk stream client connected');
}

export function stopDingTalk(): void {
  try {
    client?.disconnect();
  } catch (err) {
    log.debug('Failed to disconnect DingTalk client:', err);
  } finally {
    sessionWebhookByChat.clear();
    client = null;
    messageHandler = null;
    log.info('DingTalk client stopped');
  }
}

export async function sendProactiveText(chatId: string, content: string): Promise<void> {
  await sendText(chatId, content);
}
