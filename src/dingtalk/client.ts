import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream';
import type { Config } from '../config.js';
import { createLogger } from '../logger.js';
import {
  registerSessionWebhook as registerWebhook,
  clearWebhooks,
  sendText as webhookSendText,
  sendMarkdown as webhookSendMarkdown,
  downloadRobotMessageFile as webhookDownloadFile,
  sendProactiveText as webhookSendProactive,
} from './webhook.js';
import type { DingTalkDownloadedMessageFile as WebhookDownloadedFile } from './webhook.js';
import {
  prepareStreamingCard as cardPrepare,
  updateStreamingCard as cardUpdate,
  finishStreamingCard as cardFinish,
  createAndDeliverCard as cardCreateAndDeliver,
  updateCardInstance as cardUpdateInstance,
  sendRobotInteractiveCard as cardSendInteractive,
  updateRobotInteractiveCard as cardUpdateInteractive,
  clearUnionIdCache,
} from './streaming-card.js';
import type { DingTalkStreamingTarget as StreamingTarget } from './streaming-card.js';

const log = createLogger('DingTalk');
const DINGTALK_STREAM_HOST = 'wss-open-connection.dingtalk.com';

let client: DWClient | null = null;
let messageHandler: ((data: DWClientDownStream) => Promise<void>) | null = null;
let dingtalkWarnFilterInstalled = false;

// ---------------------------------------------------------------------------
// Re-exports (types)
// ---------------------------------------------------------------------------

export type DingTalkStreamingTarget = StreamingTarget;
export type DingTalkDownloadedMessageFile = WebhookDownloadedFile;

// ---------------------------------------------------------------------------
// Client lifecycle
// ---------------------------------------------------------------------------

function getClient(): DWClient {
  if (!client) {
    throw new Error('DingTalk client not initialized');
  }
  return client;
}

function getAccessToken(): Promise<string> {
  return getClient().getAccessToken();
}

/** 从 axios/请求错误中提取是否 429 限流 */
function is429(err: unknown): boolean {
  const o = err as { response?: { status?: number }; status?: number };
  return o?.response?.status === 429 || o?.status === 429;
}

type NodeLikeError = Error & {
  code?: string;
  host?: string;
  port?: number;
};

export function shouldSuppressDingTalkSocketWarn(args: unknown[]): boolean {
  if (args.length < 2 || args[0] !== 'ERROR') return false;
  const err = args[1];
  if (!(err instanceof Error)) return false;

  const socketError = err as NodeLikeError;
  return (
    socketError.code === 'ECONNRESET' &&
    socketError.host === DINGTALK_STREAM_HOST &&
    socketError.port === 443
  );
}

function installDingTalkSocketWarnFilter(): void {
  if (dingtalkWarnFilterInstalled) return;

  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (shouldSuppressDingTalkSocketWarn(args)) {
      const err = args[1] as NodeLikeError;
      log.warn(
        `DingTalk stream socket reset before TLS handshake; waiting for SDK auto-reconnect (${err.code ?? 'UNKNOWN'} ${err.host ?? 'unknown-host'}:${err.port ?? 0})`,
      );
      return;
    }
    originalWarn(...args);
  };
  dingtalkWarnFilterInstalled = true;
}

/** 钉钉初始化错误简短描述，避免把整份 axios response 打屏 */
export function formatDingTalkInitError(err: unknown): string {
  if (err instanceof Error && !(err as unknown as { response?: unknown }).response) {
    return err.message;
  }
  const o = err as { response?: { status?: number; data?: { Code?: string; Message?: string } }; message?: string };
  const status = o?.response?.status;
  const data = o?.response?.data;
  if (status === 429 || data?.Code === 'Throttling') {
    const msg = typeof data?.Message === 'string' ? data.Message : '请求被限流';
    return `钉钉网关限流(429): ${msg}。请稍后重试或减少连接/重启频率。`;
  }
  if (typeof o?.message === 'string') return o.message;
  return String(err).slice(0, 200);
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
  installDingTalkSocketWarnFilter();
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

  const maxTries = 3;
  const retryDelayMs = 60_000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      await client.connect();
      log.info('DingTalk stream client connected');
      return;
    } catch (err) {
      lastErr = err;
      if (is429(err) && attempt < maxTries) {
        log.warn(`DingTalk gateway 429 (attempt ${attempt}/${maxTries}), retrying in ${retryDelayMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      throw new Error(formatDingTalkInitError(err));
    }
  }
  throw new Error(formatDingTalkInitError(lastErr));
}

export function stopDingTalk(): void {
  try {
    client?.disconnect();
  } catch (err) {
    log.debug('Failed to disconnect DingTalk client:', err);
  } finally {
    clearWebhooks();
    clearUnionIdCache();
    client = null;
    messageHandler = null;
    log.info('DingTalk client stopped');
  }
}

// ---------------------------------------------------------------------------
// Proactive text
// ---------------------------------------------------------------------------

export async function sendProactiveText(
  target: string | import('../shared/active-chats.js').DingTalkActiveTarget,
  content: string,
): Promise<void> {
  return webhookSendProactive(getAccessToken, target, content);
}

// ---------------------------------------------------------------------------
// Facade re-exports: wrap module functions with injected getAccessToken
// ---------------------------------------------------------------------------

export function registerSessionWebhook(chatId: string, sessionWebhook: string): void {
  registerWebhook(chatId, sessionWebhook);
}

export async function sendText(chatId: string, content: string): Promise<unknown> {
  return webhookSendText(getAccessToken, chatId, content);
}

export async function sendMarkdown(chatId: string, title: string, text: string): Promise<unknown> {
  return webhookSendMarkdown(getAccessToken, chatId, title, text);
}

export async function downloadRobotMessageFile(
  downloadCode: string,
  robotCode: string,
): Promise<DingTalkDownloadedMessageFile> {
  return webhookDownloadFile(getAccessToken, downloadCode, robotCode);
}

export async function prepareStreamingCard(
  target: string | DingTalkStreamingTarget,
  templateId: string,
  cardData: Record<string, unknown>,
): Promise<string> {
  return cardPrepare({ getAccessToken }, target, templateId, cardData);
}

export async function updateStreamingCard(
  conversationToken: string,
  templateId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  return cardUpdate({ getAccessToken }, conversationToken, templateId, cardData);
}

export async function finishStreamingCard(conversationToken: string): Promise<void> {
  return cardFinish({ getAccessToken }, conversationToken);
}

export async function createAndDeliverCard(
  target: DingTalkStreamingTarget,
  templateId: string,
  outTrackId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  return cardCreateAndDeliver({ getAccessToken }, target, templateId, outTrackId, cardData);
}

export async function updateCardInstance(
  outTrackId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  return cardUpdateInstance({ getAccessToken }, outTrackId, cardData);
}

export async function sendRobotInteractiveCard(
  target: DingTalkStreamingTarget,
  cardBizId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  return cardSendInteractive({ getAccessToken }, target, cardBizId, cardData);
}

export async function updateRobotInteractiveCard(
  cardBizId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  return cardUpdateInteractive({ getAccessToken }, cardBizId, cardData);
}
