/**
 * WeWork (浼佷笟寰俊) Message Sender - Send messages to WeWork
 * 閫氳繃 WebSocket aibot_respond_msg 鍙戦€侊紝闇€閫忎紶 req_id
 */

import { sendText, sendStream, sendStreamWithItems, sendMessage, sendProactiveMessage } from './client.js';
import { createLogger } from '../logger.js';
import { splitLongContent, getAIToolDisplayName } from '../shared/utils.js';
import { MAX_WEWORK_MESSAGE_LENGTH } from '../constants.js';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const log = createLogger('WeWorkSender');
const STREAM_SEND_INTERVAL_MS = 900;
const STREAM_SAFE_TTL_MS = 5 * 60 * 1000;

/** 褰撳墠鍚屾澶勭悊涓殑 req_id锛堜粎鐢ㄤ簬 commandHandler 绛夊悓姝ヨ皟鐢級 */
let currentReqId: string | null = null;

export function setCurrentReqId(reqId: string | null): void {
  currentReqId = reqId;
}

function getReqId(explicitReqId?: string): string {
  const id = explicitReqId ?? currentReqId;
  if (!id) {
    log.warn('No req_id - cannot send WeWork reply');
    return '';
  }
  return id;
}

type MessageStatus = 'thinking' | 'streaming' | 'done' | 'error';

const STATUS_CONFIG: Record<MessageStatus, { icon: string; title: string }> = {
  thinking: { icon: '...', title: 'Thinking' },
  streaming: { icon: '...', title: 'Streaming' },
  done: { icon: '[ok]', title: 'Done' },
  error: { icon: '[error]', title: 'Error' },
};

function getToolTitle(toolId: string, status: MessageStatus): string {
  const name = getAIToolDisplayName(toolId);
  const statusText = STATUS_CONFIG[status].title;
  return status === 'done' ? name : `${name} - ${statusText}`;
}

/**
 * Generate unique request ID
 */
function generateReqId(): string {
  return `${Date.now()}-${randomBytes(8).toString('hex')}`;
}

/**
 * Generate unique stream ID for WeWork streaming responses
 */
function generateStreamId(): string {
  return `${Date.now()}-${randomBytes(8).toString('hex')}`;
}

/**
 * Format message for WeWork (markdown-like format)
 */
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
    message += `_姝ｅ湪鎬濊€冿紝璇风◢鍊?.._\n\n馃挱 **鍑嗗涓?*\n\n`;
  }

  if (note) {
    message += `---\n\n馃挕 **${note}**`;
  }

  return message;
}

/**
 * Local tracking for stream states
 * WeWork doesn't support message editing, so we track stream IDs locally
 */
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
 * Send thinking message to WeWork
 * Returns a stream ID that can be used for updates
 * @param reqId - 娑堟伅鍥炶皟鐨?req_id锛岀敤浜?WebSocket 鍥炲
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

    // Store initial stream state
    getOrCreateStreamState(streamId, chatId);

    // Send initial stream message (not finished)
    sendStream(getReqId(reqId), streamId, content, false);

    log.info(`Thinking message sent: ${streamId}`);
    return streamId;
  } catch (err) {
    log.error('Failed to send thinking message:', err);
    throw err;
  }
}

/**
 * Update existing message in WeWork
 * Note: WeWork doesn't support message editing, so we send new stream messages
 */
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
      return;
    }

    state.pendingUpdate = { message, status, reqId };
    await flushStreamUpdate(streamId, state);
  } catch (err) {
    log.error('Failed to update message:', err);
    throw err;
  }
}

/**
 * Send final messages to WeWork (handle long content)
 */
export async function sendFinalMessages(
  chatId: string,
  streamId: string,
  fullContent: string,
  note: string,
  toolId = 'claude',
  reqId?: string
): Promise<void> {
  const title = getToolTitle(toolId, 'done');
  const parts = splitLongContent(fullContent, MAX_WEWORK_MESSAGE_LENGTH);

  // Send final stream message to finish the stream
  const finalMessage = formatWeWorkMessage(title, parts[0], 'done', parts.length > 1 ? `鍐呭杈冮暱锛屽凡鍒嗘鍙戦€?(1/${parts.length})` : note);

  try {
    const state = streamStates.get(streamId);
    const shouldFallbackToText =
      !!state && (state.expired || Date.now() - state.createdAt >= STREAM_SAFE_TTL_MS);

    if (state) {
      state.closed = true;
      state.pendingUpdate = undefined;
    }

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

    streamStates.delete(streamId);

    // Send remaining parts as separate messages
    for (let i = 1; i < parts.length; i++) {
      try {
        const partContent = `${parts[i]}\n\n_*(缁?${i + 1}/${parts.length})*_`;
        const partMessage = formatWeWorkMessage(title, partContent, 'done', i === parts.length - 1 ? note : undefined);

        sendText(getReqId(reqId), partMessage);
        log.info(`Final message part ${i + 1}/${parts.length} sent`);
      } catch (err) {
        log.error(`Failed to send part ${i + 1}:`, err);
      }
    }
  } catch (err) {
    log.error('Failed to send final messages:', err);
  }
}

/**
 * 涓诲姩鎺ㄩ€佹枃鏈紙鐢ㄤ簬鍚姩/鍏抽棴閫氱煡绛夛紝鏃犻渶 req_id锛?
 */
export async function sendProactiveTextReply(chatId: string, text: string): Promise<void> {
  const message = formatWeWorkMessage('馃摙 open-im', text, 'done');
  try {
    sendProactiveMessage(chatId, message);
    log.info(`Proactive text sent to user ${chatId}`);
  } catch (err) {
    log.error('Failed to send proactive text:', err);
  }
}

/**
 * Send simple text reply to WeWork
 * @param threadCtxOrReqId - 鍏煎 MessageSender 鐨?threadCtx锛涜嫢涓?string 鍒欎綔涓?reqId 浣跨敤
 */
export async function sendTextReply(
  chatId: string,
  text: string,
  threadCtxOrReqId?: import('../shared/types.js').ThreadContext | string
): Promise<void> {
  const message = formatWeWorkMessage('馃摙 open-im', text, 'done');
  // 鏄惧紡浼犻€掔殑 reqId锛堢敤浜庡吋瀹?MessageSender 鎺ュ彛锛?
  const explicitReqId = typeof threadCtxOrReqId === 'string' ? threadCtxOrReqId : undefined;
  // 鍥為€€鍒板綋鍓嶈姹傜殑 reqId锛堝湪 handleEvent 涓€氳繃 setCurrentReqId 璁剧疆锛?
  const effectiveReqId = explicitReqId ?? currentReqId;

  try {
    sendText(getReqId(effectiveReqId ?? undefined), message);
    log.info(`Text reply sent to user ${chatId}`);
  } catch (err) {
    log.error('Failed to send text reply:', err);
  }
}

/**
 * Send permission card with action buttons (for permission prompts)
 * Note: WeWork doesn't support interactive cards, so we send text with instructions
 */
export async function sendPermissionCard(
  chatId: string,
  requestId: string,
  toolName: string,
  toolInput: string,
  reqId?: string
): Promise<void> {
  const message = [
    '[Permission Request]',
    '',
    `Tool: ${toolName}`,
    'Arguments:',
    '```',
    toolInput,
    '```',
    '',
    'Reply with one of the following commands:',
    '- /allow',
    '- /deny',
    '',
    `Request ID: ${requestId.slice(-8)}`,
  ].join('\n');

  try {
    sendText(getReqId(reqId), message);
    log.info(`Permission card sent to user ${chatId}`);
  } catch (err) {
    log.error('Failed to send permission card:', err);
  }
}
/**
 * Send mode switch card
 */
export async function sendModeCard(
  chatId: string,
  _userId: string,
  currentMode: string,
  reqId?: string
): Promise<void> {
  const { MODE_LABELS } = await import('../permission-mode/types.js');
  const label = MODE_LABELS[currentMode as keyof typeof MODE_LABELS] || currentMode;
  const message = [
    '[Permission Mode]',
    '',
    `Current mode: ${label}`,
    '',
    'Send one of the following commands to switch:',
    '- /mode ask',
    '- /mode accept-edits',
    '- /mode plan',
    '- /mode yolo',
  ].join('\n');

  try {
    sendText(getReqId(reqId), message);
    log.info(`Mode card sent to user ${chatId}`);
  } catch (err) {
    log.error('Failed to send mode card:', err);
  }
}
/**
 * Send image reply
 */
export async function sendImageReply(chatId: string, imagePath: string): Promise<void> {
  try {
    const reqId = getReqId();
    if (!reqId) {
      await sendTextReply(chatId, "Generated image saved at: " + imagePath);
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
    await sendTextReply(chatId, "Generated image saved at: " + imagePath);
  }
}

/**
 * Send directory selection (not supported in WeWork, use text instead)
 */
export async function sendDirectorySelection(
  chatId: string,
  currentDir: string,
  _userId: string
): Promise<void> {
  await sendTextReply(chatId, `Current directory: ${currentDir}\n\nUse \`/cd <directory>\` to switch.`);
}
/**
 * Start typing indicator (WeWork doesn't support this)
 */
export function startTypingLoop(_chatId: string): () => void {
  // WeWork doesn't have a typing indicator like Telegram
  // Return a no-op function
  return () => {};
}

/**
 * Send error message
 */
export async function sendErrorMessage(chatId: string, error: string, reqId?: string): Promise<void> {
  const message = formatWeWorkMessage('鉂?閿欒', error, 'error');

  try {
    sendText(getReqId(reqId), message);
    log.info(`Error message sent to user ${chatId}`);
  } catch (err) {
    log.error('Failed to send error message:', err);
  }
}


