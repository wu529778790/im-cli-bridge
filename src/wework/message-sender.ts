/**
 * WeWork (企业微信/WeCom) Message Sender
 * 通过 WebSocket `aibot_respond_msg` 发送消息，并透传 `req_id`
 */

import { sendText, sendStream, sendStreamWithItems, sendProactiveMessage } from './client.js';
import { createLogger } from '../logger.js';
import { splitLongContent } from '../shared/utils.js';
import { buildMessageTitle, OPEN_IM_SYSTEM_TITLE } from '../shared/message-title.js';
import { buildTextNote } from '../shared/message-note.js';
import {
  buildDirectoryMessage,
} from '../shared/system-messages.js';
import { MAX_WEWORK_MESSAGE_LENGTH } from '../constants.js';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const log = createLogger('WeWorkSender');
const STREAM_SEND_INTERVAL_MS = 900;
const STREAM_SAFE_TTL_MS = 5 * 60 * 1000;

function getReqId(explicitReqId?: string): string {
  if (!explicitReqId) {
    log.warn('No req_id - cannot send WeWork reply');
    return '';
  }
  return explicitReqId;
}

type MessageStatus = 'thinking' | 'streaming' | 'done' | 'error';

const STATUS_CONFIG: Record<MessageStatus, { icon: string; title: string }> = {
  thinking: { icon: '[thinking]', title: '思考中' },
  streaming: { icon: '[streaming]', title: '输出中' },
  done: { icon: '[done]', title: '完成' },
  error: { icon: '[error]', title: '错误' },
};

function getToolTitle(toolId: string, status: MessageStatus): string {
  return buildMessageTitle(toolId, status, {
    statusTitles: {
      thinking: STATUS_CONFIG.thinking.title,
      streaming: STATUS_CONFIG.streaming.title,
      done: STATUS_CONFIG.done.title,
      error: STATUS_CONFIG.error.title,
    },
  });
}

function generateReqId(): string {
  return `${Date.now()}-${randomBytes(8).toString('hex')}`;
}

function generateStreamId(): string {
  return `${Date.now()}-${randomBytes(8).toString('hex')}`;
}

function formatWeWorkNote(note: string): string {
  const trimmedNote = note.trim();
  const lines = trimmedNote.split('\n').map((line) => line.trim()).filter(Boolean);

  if (lines.length === 0) return buildTextNote(trimmedNote);

  const formattedLines = lines.flatMap((line) => {
    if (line.startsWith('输出中')) {
      return ['💡 输出中...'];
    }

    const bashIndex = line.indexOf('Bash');
    if (bashIndex >= 0) {
      const command = line
        .slice(bashIndex + 'Bash'.length)
        .replace(/^[\s:：\-–—>→]+/, '')
        .trim();
      return command ? ['🔧 Bash', '```', command, '```'] : ['🔧 Bash'];
    }

    const readIndex = line.indexOf('Read');
    if (readIndex >= 0) {
      const path = line
        .slice(readIndex + 'Read'.length)
        .replace(/^[\s:：\-–—>→]+/, '')
        .trim();
      return path ? [`📖 Read \`${path.replace(/`/g, '\\`')}\``] : ['📖 Read'];
    }

    const writeIndex = line.indexOf('Write');
    if (writeIndex >= 0) {
      const path = line
        .slice(writeIndex + 'Write'.length)
        .replace(/^[\s:：\-–—>→]+/, '')
        .trim();
      return path ? [`✏️ Write \`${path.replace(/`/g, '\\`')}\``] : ['✏️ Write'];
    }

    return [line];
  });

  return `─────────\n\n${formattedLines.join('\n')}`;
}

function formatWeWorkMessage(
  title: string,
  content: string,
  status: MessageStatus,
  note?: string
): string {
  const statusConfig = STATUS_CONFIG[status];
  let message = `${statusConfig.icon} **${title}**\n\n`;

  if (content) {
    message += `${content}\n\n`;
  } else if (status === 'thinking') {
    message += `_正在思考，请稍候..._\n\n[thinking] **准备中**\n\n`;
  }

  if (note) {
    message += formatWeWorkNote(note);
  }

  return message;
}

interface StreamState {
  chatId: string;
  content: string;
  createdAt: number;
  lastSentAt: number;
  closed: boolean;
  expired: boolean;
  flushing: boolean;
  expireLogged: boolean;
  pendingUpdate?: {
    message: string;
    status: MessageStatus;
    reqId?: string;
  };
}

const streamStates = new Map<string, StreamState>();

// Periodic cleanup of expired/orphaned stream states
const STREAM_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, state] of streamStates) {
    if (now - state.createdAt >= STREAM_SAFE_TTL_MS) {
      state.closed = true;
      streamStates.delete(id);
      log.info(`Cleaned up expired stream state: ${id}`);
    }
  }
}, STREAM_CLEANUP_INTERVAL_MS).unref();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOrCreateStreamState(streamId: string, chatId: string): StreamState {
  const existing = streamStates.get(streamId);
  if (existing) return existing;

  const state: StreamState = {
    chatId,
    content: '',
    createdAt: Date.now(),
    lastSentAt: 0,
    closed: false,
    expired: false,
    flushing: false,
    expireLogged: false,
  };
  streamStates.set(streamId, state);
  return state;
}

function markExpired(state: StreamState, streamId: string): void {
  state.expired = true;
  if (!state.expireLogged) {
    state.expireLogged = true;
    log.warn(`Stream expired locally, switching to text fallback: streamId=${streamId}`);
  }
}

async function flushStreamUpdate(streamId: string, state: StreamState): Promise<void> {
  if (state.flushing || state.closed || state.expired) return;
  state.flushing = true;

  try {
    while (state.pendingUpdate && !state.closed && !state.expired) {
      const queued = state.pendingUpdate;
      state.pendingUpdate = undefined;

      if (Date.now() - state.createdAt >= STREAM_SAFE_TTL_MS) {
        markExpired(state, streamId);
        break;
      }

      const elapsed = Date.now() - state.lastSentAt;
      if (elapsed < STREAM_SEND_INTERVAL_MS) {
        await sleep(STREAM_SEND_INTERVAL_MS - elapsed);
      }

      if (state.closed || state.expired) break;

      sendStream(getReqId(queued.reqId), streamId, queued.message, false);
      state.lastSentAt = Date.now();
      log.info(`Message updated: ${queued.status}, streamId=${streamId}`);
    }
  } finally {
    state.flushing = false;
  }
}

/**
 * Send thinking message to WeWork.
 * Returns a stream ID that can be used for updates.
 * @param reqId 消息回调里的 `req_id`，用于通过 WebSocket 回复
 */
export async function sendThinkingMessage(
  chatId: string,
  _replyToMessageId: string | undefined,
  toolId = 'claude',
  reqId?: string
): Promise<string> {
  const streamId = generateStreamId();
  const title = getToolTitle(toolId, 'thinking');
  const content = formatWeWorkMessage(title, '', 'thinking');

  try {
    log.info(`Sending thinking message to user ${chatId}, streamId=${streamId}`);

    getOrCreateStreamState(streamId, chatId);
    sendStream(getReqId(reqId), streamId, content, false);

    log.info(`Thinking message sent: ${streamId}`);
    return streamId;
  } catch (err) {
    log.error('Failed to send thinking message:', err);
    throw err;
  }
}

export async function updateMessage(
  chatId: string,
  streamId: string,
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = 'claude',
  reqId?: string
): Promise<void> {
  const title = getToolTitle(toolId, status);
  const message = formatWeWorkMessage(title, content, status, note);
  const state = getOrCreateStreamState(streamId, chatId);

  try {
    state.chatId = chatId;
    state.content = content;
    if (state.closed) return;

    if (Date.now() - state.createdAt >= STREAM_SAFE_TTL_MS) {
      markExpired(state, streamId);
      // Stream expired - fall back to text delivery for errors and final states
      if (status === 'error' || status === 'done') {
        const reqIdUsed = getReqId(reqId);
        sendText(reqIdUsed, message);
        log.info(`Stream expired, sent ${status} via text fallback: streamId=${streamId}`);
      }
      return;
    }

    state.pendingUpdate = { message, status, reqId };
    await flushStreamUpdate(streamId, state);
  } catch (err) {
    log.error('Failed to update message:', err);
    throw err;
  }
}

export async function sendFinalMessages(
  chatId: string,
  streamId: string,
  fullContent: string,
  note: string,
  toolId = 'claude',
  reqId?: string
): Promise<void> {
  const contentToSend = fullContent?.trim() || '(无输出)';
  const reqIdUsed = getReqId(reqId);
  if (!reqIdUsed) {
    log.warn(`sendFinalMessages: no req_id, streamId=${streamId}, contentLen=${contentToSend.length}`);
  }
  log.info(`sendFinalMessages: streamId=${streamId}, contentLen=${contentToSend.length}, reqId=${reqIdUsed ? 'ok' : 'missing'}`);
  const title = getToolTitle(toolId, 'done');
  const parts = splitLongContent(contentToSend, MAX_WEWORK_MESSAGE_LENGTH);
  const finalMessage = formatWeWorkMessage(
    title,
    parts[0],
    'done',
    parts.length > 1 ? `内容较长，已分段发送 (1/${parts.length})` : note
  );

  const state = streamStates.get(streamId);
  const shouldFallbackToText =
    !!state && (state.expired || Date.now() - state.createdAt >= STREAM_SAFE_TTL_MS);

  // 先发一条「输出中」带正文，再发 finish 的最终条，避免企微端一直停在「思考中」不刷新
  // 独立 try-catch：即使此步失败，仍须发送 finish=true，否则企微永远卡在「正在思考」
  if (!shouldFallbackToText && state && contentToSend.length > 0) {
    try {
      await updateMessage(chatId, streamId, contentToSend, 'streaming', note, toolId, reqId);
    } catch (err) {
      log.warn('Pre-finish streaming update failed, will still send finish=true:', err);
    }
  }

  if (state) {
    state.closed = true;
    state.pendingUpdate = undefined;
  }

  // finish=true 是关键：必须保证发出，否则企微 UI 永远停留在「正在思考」
  try {
    if (!shouldFallbackToText) {
      if (state) {
        const elapsed = Date.now() - state.lastSentAt;
        if (elapsed < STREAM_SEND_INTERVAL_MS) {
          await sleep(STREAM_SEND_INTERVAL_MS - elapsed);
        }
      }
      sendStream(getReqId(reqId), streamId, finalMessage, true);
      log.info(`Final stream message sent, streamId=${streamId}`);
    } else {
      sendText(getReqId(reqId), finalMessage);
      log.info(`Final stream expired, sent text fallback instead: streamId=${streamId}`);
    }
  } catch (err) {
    log.warn('Primary finish send failed, trying text fallback:', err);
    try {
      sendText(getReqId(reqId), finalMessage);
      log.info(`Fallback text sent after primary finish failure, streamId=${streamId}`);
    } catch (fallbackErr) {
      log.error('Both primary and fallback finish sends failed:', fallbackErr);
    }
  }

  streamStates.delete(streamId);

  for (let i = 1; i < parts.length; i++) {
    try {
      const partContent = `${parts[i]}\n\n_*(续 ${i + 1}/${parts.length})*_`;
      const partMessage = formatWeWorkMessage(
        title,
        partContent,
        'done',
        i === parts.length - 1 ? note : undefined
      );

      sendText(getReqId(reqId), partMessage);
      log.info(`Final message part ${i + 1}/${parts.length} sent`);
    } catch (err) {
      log.error(`Failed to send part ${i + 1}:`, err);
    }
  }
}

/**
 * 主动推送文本，用于启动/关闭通知等场景，无需 req_id。
 */
export async function sendProactiveTextReply(chatId: string, text: string): Promise<void> {
  const message = formatWeWorkMessage(OPEN_IM_SYSTEM_TITLE, text, 'done');
  try {
    sendProactiveMessage(chatId, message);
    log.info(`Proactive text sent to user ${chatId}`);
  } catch (err) {
    log.error('Failed to send proactive text:', err);
  }
}

/**
 * Send simple text reply to WeWork.
 * @param threadCtxOrReqId 兼容 MessageSender 的 threadCtx；若为 string 则作为 reqId 使用
 */
export async function sendTextReply(
  chatId: string,
  text: string,
  threadCtxOrReqId?: import('../shared/types.js').ThreadContext | string
): Promise<void> {
  const message = formatWeWorkMessage(OPEN_IM_SYSTEM_TITLE, text, 'done');
  const effectiveReqId = typeof threadCtxOrReqId === 'string' ? threadCtxOrReqId : undefined;

  try {
    sendText(getReqId(effectiveReqId), message);
    log.info(`Text reply sent to user ${chatId}`);
  } catch (err) {
    log.error('Failed to send text reply:', err);
  }
}


export async function sendImageReply(chatId: string, imagePath: string): Promise<void> {
  try {
    const reqId = getReqId();
    if (!reqId) {
      await sendTextReply(chatId, `Generated image saved at: ${imagePath}`);
      return;
    }

    const imageBuffer = await readFile(imagePath);
    const base64 = imageBuffer.toString('base64');
    const md5 = createHash('md5').update(imageBuffer).digest('hex');
    sendStreamWithItems(reqId, generateStreamId(), 'Generated image', true, [
      {
        msgtype: 'image',
        image: { base64, md5 },
      },
    ]);
  } catch (err) {
    log.warn('Failed to send native WeWork image reply, falling back to text path:', err);
    await sendTextReply(chatId, `Generated image saved at: ${imagePath}`);
  }
}

export async function sendDirectorySelection(
  chatId: string,
  currentDir: string,
  _userId: string,
  reqId?: string,
): Promise<void> {
  await sendTextReply(chatId, buildDirectoryMessage(currentDir), reqId);
}

export function startTypingLoop(_chatId: string): () => void {
  return () => {};
}

export async function sendErrorMessage(chatId: string, error: string, reqId?: string): Promise<void> {
  const message = formatWeWorkMessage('错误', error, 'error');

  try {
    sendText(getReqId(reqId), message);
    log.info(`Error message sent to user ${chatId}`);
  } catch (err) {
    log.error('Failed to send error message:', err);
  }
}
