import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream';
import type { Config } from '../config.js';
import { createLogger } from '../logger.js';
import type { DingTalkActiveTarget } from '../shared/active-chats.js';

const log = createLogger('DingTalk');
const DINGTALK_OPENAPI_BASE = 'https://api.dingtalk.com';
const TEXT_MSG_KEY = 'sampleText';

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

function getRobotCode(target: DingTalkActiveTarget): string {
  if (!target.robotCode) {
    throw new Error('DingTalk proactive target is missing robotCode');
  }
  return target.robotCode;
}

function buildTextPayload(content: string): Record<string, unknown> {
  return {
    msgKey: TEXT_MSG_KEY,
    msgParam: JSON.stringify({ content }),
  };
}

async function callOpenApi(path: string, body: Record<string, unknown>): Promise<unknown> {
  const accessToken = await getClient().getAccessToken();
  const res = await fetch(`${DINGTALK_OPENAPI_BASE}${path}`, {
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
    throw new Error(`DingTalk OpenAPI failed: ${res.status} ${text}`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function normalizeConversationType(type?: string): string | undefined {
  return type?.trim().toLowerCase();
}

function buildProactiveAttempts(
  target: DingTalkActiveTarget,
  content: string,
): Array<{ label: string; path: string; body: Record<string, unknown> }> {
  const robotCode = getRobotCode(target);
  const payload = buildTextPayload(content);
  const normalizedType = normalizeConversationType(target.conversationType);
  const attempts: Array<{ label: string; path: string; body: Record<string, unknown> }> = [];

  const pushSingle = () => {
    if (!target.userId) return;
    attempts.push({
      label: 'single',
      path: '/v1.0/robot/oToMessages/batchSend',
      body: {
        robotCode,
        userIds: [target.userId],
        ...payload,
      },
    });
  };

  const pushGroup = () => {
    if (!target.chatId) return;
    attempts.push({
      label: 'group',
      path: '/v1.0/robot/groupMessages/send',
      body: {
        robotCode,
        openConversationId: target.chatId,
        ...payload,
      },
    });
  };

  if (normalizedType === '2' || normalizedType === 'group' || normalizedType === 'groupchat') {
    pushGroup();
    return attempts;
  }

  if (
    normalizedType === '0' ||
    normalizedType === 'single' ||
    normalizedType === 'singlechat' ||
    normalizedType === 'oto'
  ) {
    pushSingle();
    if (attempts.length === 0) pushGroup();
    return attempts;
  }

  // 文档里 conversationType 的取值描述并不统一；未知时优先尝试单聊，再回退群聊。
  pushSingle();
  pushGroup();
  return attempts;
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

export async function sendProactiveText(
  target: string | DingTalkActiveTarget,
  content: string,
): Promise<void> {
  if (typeof target === 'string') {
    await sendText(target, content);
    return;
  }

  const attempts = buildProactiveAttempts(target, content);
  if (attempts.length === 0) {
    throw new Error('DingTalk proactive target is incomplete');
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      await callOpenApi(attempt.path, attempt.body);
      return;
    } catch (err) {
      lastError = err;
      log.warn(`DingTalk proactive ${attempt.label} send failed:`, err);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`DingTalk proactive send failed for chat ${target.chatId}`);
}
