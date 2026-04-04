import { createLogger } from '../logger.js';
import type { DingTalkActiveTarget } from '../shared/active-chats.js';
import { DINGTALK_OPENAPI_BASE, callOpenApi, buildTextPayload } from './api.js';

const log = createLogger('DingTalk');

// ---------------------------------------------------------------------------
// Session webhook registry
// ---------------------------------------------------------------------------

// sessionWebhook 有过期时间（约 2 小时），需要记录时间戳
const sessionWebhookByChat = new Map<string, { webhook: string; registeredAt: number }>();
const WEBHOOK_TTL_MS = 90 * 60 * 1000; // 90 分钟后视为过期

export function registerSessionWebhook(chatId: string, sessionWebhook: string): void {
  if (!chatId || !sessionWebhook) return;
  sessionWebhookByChat.set(chatId, { webhook: sessionWebhook, registeredAt: Date.now() });
}

export function clearWebhooks(): void {
  sessionWebhookByChat.clear();
}

// ---------------------------------------------------------------------------
// Webhook-based send helpers
// ---------------------------------------------------------------------------

async function sendByWebhook(
  getAccessToken: () => Promise<string>,
  chatId: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const entry = sessionWebhookByChat.get(chatId);
  if (!entry) {
    throw new Error(`DingTalk sessionWebhook unavailable for chat ${chatId}`);
  }

  // 检查 webhook 是否过期
  if (Date.now() - entry.registeredAt > WEBHOOK_TTL_MS) {
    sessionWebhookByChat.delete(chatId);
    throw new Error(`DingTalk sessionWebhook expired for chat ${chatId}`);
  }

  const sessionWebhook = entry.webhook;

  const accessToken = await getAccessToken();
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

export async function sendText(
  getAccessToken: () => Promise<string>,
  chatId: string,
  content: string,
): Promise<unknown> {
  return sendByWebhook(getAccessToken, chatId, {
    msgtype: 'text',
    text: { content },
  });
}

export async function sendMarkdown(
  getAccessToken: () => Promise<string>,
  chatId: string,
  title: string,
  text: string,
): Promise<unknown> {
  return sendByWebhook(getAccessToken, chatId, {
    msgtype: 'markdown',
    markdown: {
      title,
      text,
    },
  });
}

// ---------------------------------------------------------------------------
// File download
// ---------------------------------------------------------------------------

export interface DingTalkDownloadedMessageFile {
  buffer: Buffer;
  contentType?: string;
  filename?: string;
}

export async function downloadRobotMessageFile(
  getAccessToken: () => Promise<string>,
  downloadCode: string,
  robotCode: string,
): Promise<DingTalkDownloadedMessageFile> {
  const accessToken = await getAccessToken();
  const response = await fetch(`${DINGTALK_OPENAPI_BASE}/v1.0/robot/messageFiles/download`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-acs-dingtalk-access-token': String(accessToken),
    },
    body: JSON.stringify({ downloadCode, robotCode }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DingTalk message file download failed: ${response.status} ${text}`);
  }

  const contentType = response.headers.get('content-type') ?? undefined;
  const contentDisposition = response.headers.get('content-disposition') ?? '';
  const filenameMatch = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(contentDisposition);
  const filename = filenameMatch?.[1] ?? filenameMatch?.[2];
  const buffer = Buffer.from(await response.arrayBuffer());

  if (contentType?.includes('application/json')) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new Error(`DingTalk message file download returned JSON payload that could not be parsed`);
    }

    const errorCode = parsed.code ?? parsed.errcode ?? parsed.errorcode;
    if (errorCode !== undefined && errorCode !== 0 && errorCode !== '0') {
      const message =
        typeof parsed.message === 'string'
          ? parsed.message
          : typeof parsed.errmsg === 'string'
            ? parsed.errmsg
            : JSON.stringify(parsed);
      throw new Error(`DingTalk message file download business error: ${String(errorCode)} ${message}`);
    }

    const downloadUrl =
      typeof parsed.downloadUrl === 'string'
        ? parsed.downloadUrl
        : typeof parsed.download_url === 'string'
          ? parsed.download_url
          : typeof parsed.url === 'string'
            ? parsed.url
            : undefined;
    if (!downloadUrl) {
      throw new Error(`DingTalk message file download returned JSON without binary payload or download URL`);
    }

    const redirected = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(30000),
    });
    if (!redirected.ok) {
      const text = await redirected.text();
      throw new Error(`DingTalk redirected file download failed: ${redirected.status} ${text}`);
    }

    return {
      buffer: Buffer.from(await redirected.arrayBuffer()),
      contentType: redirected.headers.get('content-type') ?? undefined,
      filename,
    };
  }

  return { buffer, contentType, filename };
}

// ---------------------------------------------------------------------------
// Proactive text (API-based send to user/group)
// ---------------------------------------------------------------------------

function getRobotCode(target: DingTalkActiveTarget): string {
  if (!target.robotCode) {
    throw new Error('DingTalk proactive target is missing robotCode');
  }
  return target.robotCode;
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

  if (
    normalizedType === '1' ||
    normalizedType === '2' ||
    normalizedType === 'group' ||
    normalizedType === 'groupchat'
  ) {
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

  // 文档里 conversationType 的取值描述并不完全统一；未知时优先按原会话发群，避免误私发给个人。
  pushGroup();
  pushSingle();
  return attempts;
}

export async function sendProactiveText(
  getAccessToken: () => Promise<string>,
  target: string | DingTalkActiveTarget,
  content: string,
): Promise<void> {
  if (typeof target === 'string') {
    await sendText(getAccessToken, target, content);
    return;
  }

  const attempts = buildProactiveAttempts(target, content);
  if (attempts.length === 0) {
    throw new Error('DingTalk proactive target is incomplete');
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      await callOpenApi(getAccessToken, attempt.path, attempt.body);
      return;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('robot') || msg.includes('resource.not.found')) {
        log.debug(`DingTalk proactive ${attempt.label} send failed:`, err);
      } else {
        log.warn(`DingTalk proactive ${attempt.label} send failed:`, err);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`DingTalk proactive send failed for chat ${target.chatId}`);
}
