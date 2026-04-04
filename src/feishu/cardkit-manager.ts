/**
 * CardKit 流式卡片管理 - 打字机效果
 * 参考 cc-im: https://github.com/congqiu/cc-im
 */

import { getClient } from './client.js';
import { createLogger } from '../logger.js';

const log = createLogger('CardKit');

/** Throw to signal withRetry should not retry */
class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

interface RetryOpts {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

async function withRetry<T>(fn: () => Promise<T>, opts?: RetryOpts): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelay = opts?.baseDelayMs ?? 500;
  const maxDelay = opts?.maxDelayMs ?? 5000;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof NonRetryableError || attempt >= maxRetries) throw err;
      const delay = Math.min(baseDelay * 2 ** attempt + Math.random() * 200, maxDelay);
      log.warn(`Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms: ${(err as Error)?.message ?? err}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/** 飞书 SDK Client 的 CardKit / IM 扩展（SDK 类型未导出时使用） */
interface FeishuClientWithCardKit {
  cardkit?: {
    v1: {
      card: {
        create(opts: { data: { type: string; data: string } }): Promise<{ data?: { card_id?: string }; code?: number; msg?: string }>;
        settings(opts: { path: { card_id: string }; data: { settings: string; sequence: number } }): Promise<{ code?: number; msg?: string }>;
        update(opts: unknown): Promise<{ code?: number; msg?: string }>;
      };
      cardElement: {
        content(opts: { path: { card_id: string; element_id: string }; data: { content: string; sequence: number } }): Promise<{ code?: number; msg?: string }>;
      };
    };
  };
  im?: { v1?: { message?: { create(opts: unknown): Promise<{ data?: { message_id?: string } }> } }; message?: { create(opts: unknown): Promise<{ data?: { message_id?: string } }> } };
}

interface CardSession {
  cardId: string;
  sequence: number;
  streamingEnabled: boolean;
  completed: boolean;
  createdAt: number;
  reenableFailCount: number;
}

const MAX_REENABLE_ATTEMPTS = 3;
const SESSION_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

const sessions = new Map<string, CardSession>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.createdAt > SESSION_TTL_MS) {
        sessions.delete(id);
        log.info(`Auto-cleaned expired card session: ${id}`);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  (cleanupTimer as NodeJS.Timeout).unref?.();
}

export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

function nextSeq(cardId: string): number {
  const s = sessions.get(cardId);
  if (!s) return -1;
  s.sequence += 1;
  return s.sequence;
}

/** 创建 CardKit 卡片实例 */
export async function createCard(cardJson: string): Promise<string> {
  ensureCleanupTimer();
  const client = getClient() as FeishuClientWithCardKit;
  const res = await client.cardkit!.v1.card.create({
    data: { type: 'card_json', data: cardJson },
  });

  const cardId = res.data?.card_id;
  if (!cardId) {
    log.error('card.create response:', JSON.stringify(res, null, 2));
    throw new Error(`card.create returned no card_id (code=${res.code}, msg=${res.msg})`);
  }

  sessions.set(cardId, {
    cardId,
    sequence: 0,
    streamingEnabled: false,
    completed: false,
    createdAt: Date.now(),
    reenableFailCount: 0,
  });
  log.debug(`Card created: ${cardId}`);
  return cardId;
}

/** 启用流式模式 */
export async function enableStreaming(cardId: string): Promise<void> {
  await withRetry(async () => {
    const s = sessions.get(cardId);
    if (s?.completed) return;

    const client = getClient() as FeishuClientWithCardKit;
    const res = await client.cardkit!.v1.card.settings({
      path: { card_id: cardId },
      data: {
        settings: JSON.stringify({ streaming_mode: true }),
        sequence: nextSeq(cardId),
      },
    });

    if (res?.code && res.code !== 0) {
      if (res.code === 200400) {
        log.warn(`enableStreaming rate limited: ${res.msg}`);
        throw new NonRetryableError(`enableStreaming rate limited: code=${res.code}, msg=${res.msg}`);
      }
      log.error(`enableStreaming failed: code=${res.code}, msg=${res.msg}`);
      throw new Error(`enableStreaming error: code=${res.code}, msg=${res.msg}`);
    }
    if (s) s.streamingEnabled = true;
    log.debug(`Streaming enabled for card ${cardId}`);
  });
}

/** 流式更新元素内容（打字机效果） */
export async function streamContent(
  cardId: string,
  elementId: string,
  content: string
): Promise<void> {
  const client = getClient() as FeishuClientWithCardKit;
  const call = async (s: number) => {
    return await client.cardkit!.v1.cardElement.content({
      path: { card_id: cardId, element_id: elementId },
      data: { content, sequence: s },
    });
  };

  const seq = nextSeq(cardId);
  if (seq === -1) return;

  let res;
  try {
    res = await call(seq);
  } catch (err: unknown) {
    const respData = (err as { response?: { data?: { code?: number } } })?.response?.data;
    if (respData?.code === 99991400) return;
    log.warn(`streamContent exception: ${(err as Error)?.message ?? err}`);
    return;
  }

  const code = res?.code;

  if (!code || code === 0) {
    const s = sessions.get(cardId);
    if (s) s.reenableFailCount = 0;
    return;
  }
  if (code === 200810) return;
  if (code === 300317) return;
  if (code === 200400) return;
  if (code === 200937) return;
  if (code === 200740) return;

  if (code === 200850 || code === 300309) {
    const s = sessions.get(cardId);
    if (!s || s.completed) return;
    if (s.reenableFailCount >= MAX_REENABLE_ATTEMPTS) return;
    log.warn(`Streaming closed/timeout (${code}) for card ${cardId}, re-enabling...`);
    try {
      await enableStreaming(cardId);
      const s2 = sessions.get(cardId);
      if (!s2 || s2.completed) return;
      const retryRes = await call(nextSeq(cardId));
      if (retryRes?.code && retryRes.code !== 0) {
        s.reenableFailCount++;
        log.warn(`Retry still failed: code=${retryRes.code}, skipping (${s.reenableFailCount}/${MAX_REENABLE_ATTEMPTS})`);
      } else {
        s.reenableFailCount = 0;
      }
    } catch {
      s.reenableFailCount++;
      log.warn(`Re-enable failed for card ${cardId}, skipping (${s.reenableFailCount}/${MAX_REENABLE_ATTEMPTS})`);
    }
    return;
  }

  log.error(`streamContent failed: code=${code}, msg=${res.msg}`);
}

/** 全量更新卡片（完成/错误状态） */
export async function updateCardFull(cardId: string, cardJson: string): Promise<void> {
  await withRetry(async () => {
    const client = getClient() as FeishuClientWithCardKit;
    const res = await client.cardkit!.v1.card.update({
      path: { card_id: cardId },
      data: {
        card: { type: 'card_json', data: cardJson },
        sequence: nextSeq(cardId),
      },
    });

    const code = res?.code;
    if (code && code !== 0) {
      if (code === 200810 || code === 300317) return;
      log.error(`updateCardFull failed: code=${code}, msg=${res.msg}`);
      throw new Error(`updateCardFull error: code=${code}, msg=${res.msg}`);
    }
    log.debug(`Card ${cardId} fully updated`);
  });
}

/** 通过 card_id 发送卡片消息到聊天 */
export async function sendCardMessage(chatId: string, cardId: string): Promise<string> {
  const client = getClient() as FeishuClientWithCardKit;
  const content = JSON.stringify({ type: 'card', data: { card_id: cardId } });
  const im = client.im?.v1?.message ?? client.im?.message;
  if (!im) throw new Error('Feishu IM message API not available');
  const res = await im.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      content,
      msg_type: 'interactive',
    },
  });
  const messageId = res.data?.message_id ?? '';
  log.debug(`Card message sent: messageId=${messageId}, cardId=${cardId}`);
  return messageId;
}

/** 关闭流式模式 */
export async function disableStreaming(cardId: string): Promise<void> {
  const s = sessions.get(cardId);
  if (!s || !s.streamingEnabled) return;

  s.completed = true;

  try {
    await withRetry(
      async () => {
        const client = getClient() as FeishuClientWithCardKit;
        const seq = nextSeq(cardId);
        if (seq === -1) return;
        const res = await client.cardkit!.v1.card.settings({
          path: { card_id: cardId },
          data: {
            settings: JSON.stringify({ streaming_mode: false }),
            sequence: seq,
          },
        });
        if (res?.code && res.code !== 0) {
          if (res.code === 200400) {
            throw new Error(`disableStreaming rate limited: code=${res.code}, msg=${res.msg}`);
          }
          log.warn(`disableStreaming failed: code=${res.code}, msg=${res.msg}`);
        } else {
          s.streamingEnabled = false;
          log.debug(`Streaming disabled for card ${cardId}`);
        }
      },
      { maxRetries: 3, baseDelayMs: 500 }
    );
  } catch (err) {
    log.warn(`disableStreaming error for card ${cardId}:`, err);
  } finally {
    s.streamingEnabled = false;
  }
}

export function markCompleted(cardId: string): void {
  const s = sessions.get(cardId);
  if (s) s.completed = true;
}

export function destroySession(cardId: string): void {
  sessions.delete(cardId);
  log.debug(`Session destroyed for card ${cardId}`);
}
