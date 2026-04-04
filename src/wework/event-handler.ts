/**
 * WeWork Event Handler - Handle WeWork message events
 */

import type { Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import {
  sendThinkingMessage,
  updateMessage,
  sendFinalMessages,
  sendTextReply,
  sendImageReply,
  sendDirectorySelection,
  startTypingLoop,
} from './message-sender.js';
import { WEWORK_THROTTLE_MS } from '../constants.js';
import { setActiveChatId } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import { createLogger } from '../logger.js';
import type { WeWorkCallbackMessage } from './types.js';
import { buildUnsupportedInboundMessage } from '../channels/capabilities.js';
import { buildMediaMetadataPrompt } from '../shared/media-prompt.js';
import { buildSavedMediaPrompt } from '../shared/media-analysis-prompt.js';
import { buildMediaContext } from '../shared/media-context.js';
import { buildErrorNote, buildProgressNote } from '../shared/message-note.js';
import { createPlatformEventContext, type PlatformEventContext } from '../platform/create-event-context.js';
import { createPlatformAIRequestHandler, type PlatformSender, type PlatformTaskCallbacks } from '../platform/handle-ai-request.js';
import { handleTextFlow } from '../platform/handle-text-flow.js';
import {
  decryptAes256CbcMedia,
  downloadMediaFromUrl,
  inferExtensionFromBuffer,
  inferExtensionFromContentType,
  saveBase64Media,
  saveBufferMedia,
} from '../shared/media-storage.js';

const log = createLogger('WeWorkHandler');
const WEWORK_MEDIA_TIMEOUT_MS = 60_000;
// Safety timeout: abort hung tasks before stream expires (5 min TTL → 4.5 min safety)
const WEWORK_TASK_SAFETY_TIMEOUT_MS = 4.5 * 60 * 1000;

type MediaKind = 'image' | 'file' | 'voice' | 'video';

interface WeWorkMediaPayload {
  url?: string;
  base64?: string;
  md5?: string;
  aeskey?: string;
  filename?: string;
  fileext?: string;
  duration?: number;
  [key: string]: unknown;
}

export interface WeWorkEventHandlerHandle {
  stop: () => void;
  runningTasks: Map<string, import('../shared/ai-task.js').TaskRunState>;
  getRunningTaskCount: () => number;
  handleEvent: (data: WeWorkCallbackMessage) => Promise<void>;
}

async function saveWeWorkUrlMedia(
  payload: WeWorkMediaPayload,
  fallbackExtension: string,
): Promise<string> {
  if (!payload.url) {
    throw new Error("Missing WeWork media URL");
  }

  if (typeof payload.aeskey === "string" && payload.aeskey.trim().length > 0) {
    const response = await fetch(payload.url, { signal: AbortSignal.timeout(WEWORK_MEDIA_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`Failed to download media: HTTP ${response.status}`);
    }

    const encryptedBuffer = Buffer.from(await response.arrayBuffer());
    const decryptedBuffer = decryptAes256CbcMedia(encryptedBuffer, payload.aeskey);
    const extension =
      inferExtensionFromBuffer(decryptedBuffer) ||
      inferExtensionFromContentType(response.headers.get("content-type") ?? "") ||
      `.${fallbackExtension}`;
    return saveBufferMedia(decryptedBuffer, extension, payload.filename ?? payload.md5);
  }

  return downloadMediaFromUrl(payload.url, {
    basenameHint: payload.filename ?? payload.md5,
    fallbackExtension,
  });
}

function extractTextContent(data: WeWorkCallbackMessage): string {
  const body = data.body;

  if (body.msgtype === 'text' && body.text?.content) {
    return body.text.content.trim();
  }

  if (body.msgtype === 'mixed' && body.mixed?.msg_item) {
    return body.mixed.msg_item
      .filter((item) => item.msgtype === 'text' && item.text?.content)
      .map((item) => item.text!.content.trim())
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

function extractImagePayload(data: WeWorkCallbackMessage): WeWorkMediaPayload | null {
  const body = data.body;

  if (body.msgtype === 'image' && body.image) {
    return body.image;
  }

  if (body.msgtype === 'mixed' && body.mixed?.msg_item) {
    const imageItem = body.mixed.msg_item.find((item) => item.msgtype === 'image' && item.image);
    return imageItem?.image ?? null;
  }

  return null;
}

function extractMediaPayload(data: WeWorkCallbackMessage, kind: MediaKind): WeWorkMediaPayload | null {
  if (kind === 'image') {
    return extractImagePayload(data);
  }

  const raw = data.body as unknown as Record<string, unknown>;
  const direct = raw[kind];
  if (direct && typeof direct === 'object') {
    return direct as WeWorkMediaPayload;
  }

  const quote = raw.quote;
  if (quote && typeof quote === 'object') {
    const quotePayload = quote as Record<string, unknown>;
    const quotedKindPayload = quotePayload[kind];
    if (quotedKindPayload && typeof quotedKindPayload === 'object') {
      return quotedKindPayload as WeWorkMediaPayload;
    }
  }

  return null;
}

export async function buildMediaPrompt(data: WeWorkCallbackMessage, kind: MediaKind): Promise<string | null> {
  const text = extractTextContent(data);
  const payload = extractMediaPayload(data, kind);
  const contextText = buildMediaContext({
    Filename: payload?.filename,
    Extension: payload?.fileext,
    DurationMs: payload?.duration,
  }, text || undefined);

  if (kind === 'image') {
    const imagePayload = payload ?? extractImagePayload(data);
    if (!imagePayload) return null;

    let imageReference = '';
    if (typeof imagePayload.base64 === 'string' && imagePayload.base64.length > 0) {
      const savedPath = await saveBase64Media(imagePayload.base64, 'jpg');
      return buildSavedMediaPrompt({
        source: 'WeWork',
        kind: 'image',
        localPath: savedPath,
        text: contextText,
      });
    } else if (typeof imagePayload.url === 'string' && imagePayload.url.length > 0) {
      try {
        const savedPath = await saveWeWorkUrlMedia(imagePayload, 'jpg');
        log.info(`Downloaded WeWork image: ${savedPath}`);
        return buildSavedMediaPrompt({
          source: 'WeWork',
          kind: 'image',
          localPath: savedPath,
          text: contextText,
        });
      } catch (err) {
        log.warn('Failed to download WeWork image, falling back to URL reference:', err);
        imageReference = `Remote image URL: ${imagePayload.url}`;
      }
    }

    return buildMediaMetadataPrompt({
      source: 'WeWork',
      kind: 'image',
      text: contextText,
      metadata: {
        reference: imageReference || 'No direct image bytes were included; only metadata is available.',
        payload: imagePayload,
      },
      guidance:
        'Analyze the image if a local path or accessible URL is available. Otherwise explain the limitation and ask the user to resend via Telegram/Feishu or provide more context.',
    });
  }

  if (payload?.url) {
    try {
      const savedPath = await saveWeWorkUrlMedia(
        payload,
        kind === 'voice' ? 'ogg' : kind === 'video' ? 'mp4' : 'bin',
      );
      return buildSavedMediaPrompt({
        source: 'WeWork',
        kind,
        localPath: savedPath,
        text: contextText,
      });
    } catch (err) {
      log.warn('Failed to download WeWork media, falling back to metadata-only prompt:', err);
    }
  }

  return buildMediaMetadataPrompt({
    source: 'WeWork',
    kind,
    text: contextText,
    metadata: payload ?? 'none',
    guidance:
      'If the media content is not directly accessible, explain that clearly and ask the user for a text summary, transcript, or a resend via a channel with native media support.',
  });
}

export function setupWeWorkHandlers(
  config: Config,
  sessionManager: SessionManager,
): WeWorkEventHandlerHandle {
  // Mutable ref that captures the req_id of the message currently being handled.
  // WeWork requires req_id to reply; CommandHandler doesn't carry it, so we inject
  // it via a closure. WeWork delivers messages sequentially over WebSocket, so
  // there is no race condition between concurrent messages from the same bot.
  const senderCtx = { reqId: '' };

  // Create shared platform event context with a sender that captures reqId
  const ctx = createPlatformEventContext({
    platform: 'wework',
    allowedUserIds: config.weworkAllowedUserIds,
    config,
    sessionManager,
    sender: {
      sendTextReply: (chatId: string, text: string) =>
        sendTextReply(chatId, text, senderCtx.reqId),
      sendDirectorySelection: (chatId: string, currentDir: string, userId: string) =>
        sendDirectorySelection(chatId, currentDir, userId, senderCtx.reqId),
    },
  });

  // Map to track safety timers by taskKey
  const safetyTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // WeWork-specific sender callbacks
  const platformSender: PlatformSender = {
    sendThinkingMessage: async (chatId, replyToMessageId, toolId) => {
      return await sendThinkingMessage(chatId, replyToMessageId, toolId, senderCtx.reqId);
    },
    sendTextReply: async (chatId, text) => {
      await sendTextReply(chatId, text, senderCtx.reqId);
    },
    startTyping: (chatId) => startTypingLoop(chatId),
    sendImage: async (chatId, imagePath) => {
      await sendImageReply(chatId, imagePath);
    },
  };

  // WeWork-specific streaming callbacks factory
  const weworkTaskCallbacksFactory = (ctx: {
    chatId: string;
    msgId: string;
    taskKey: string;
    userId: string;
    toolId: string;
    replyToMessageId: string | undefined;
  }): PlatformTaskCallbacks => ({
    streamUpdate: async (content, toolNote) => {
      const note = buildProgressNote(toolNote);
      try {
        await updateMessage(ctx.chatId, ctx.msgId, content, 'streaming', note, ctx.toolId, senderCtx.reqId);
      } catch (err) {
        log.debug('Stream update failed:', err);
      }
    },
    sendComplete: async (content, note) => {
      await sendFinalMessages(ctx.chatId, ctx.msgId, content, note ?? '', ctx.toolId, senderCtx.reqId);
    },
    sendError: async (error) => {
      await updateMessage(ctx.chatId, ctx.msgId, `Error: ${error}`, 'error', buildErrorNote(), ctx.toolId, senderCtx.reqId);
    },
  });

  // WeWork-specific init for safety timeout
  const extraInit = ({ chatId, taskKey }: { chatId: string; msgId: string; taskKey: string }) => {
    // Safety timeout: abort hung tasks before stream expires, unblocking the queue
    const safetyTimer = setTimeout(() => {
      const state = ctx.runningTasks.get(taskKey);
      if (state) {
        log.warn(`[SAFETY_TIMEOUT] Task ${taskKey} exceeded ${WEWORK_TASK_SAFETY_TIMEOUT_MS}ms, aborting`);
        state.handle.abort();
        ctx.runningTasks.delete(taskKey);
        sendTextReply(chatId, `AI 处理超时（${Math.round(WEWORK_TASK_SAFETY_TIMEOUT_MS / 1000)}s），已自动取消。请重试。`, senderCtx.reqId).catch(() => {});
      }
    }, WEWORK_TASK_SAFETY_TIMEOUT_MS);

    safetyTimers.set(taskKey, safetyTimer);

    return () => {
      const timer = safetyTimers.get(taskKey);
      if (timer) {
        clearTimeout(timer);
        safetyTimers.delete(taskKey);
      }
    };
  };

  // Create platform-specific AI request handler
  const handleAIRequest = createPlatformAIRequestHandler({
    platform: 'wework',
    config,
    sessionManager,
    sender: platformSender,
    throttleMs: WEWORK_THROTTLE_MS,
    runningTasks: ctx.runningTasks,
    extraInit,
    taskCallbacksFactory: weworkTaskCallbacksFactory,
  });

  async function enqueuePrompt(
    userId: string,
    chatId: string,
    prompt: string,
    reqId: string,
  ): Promise<void> {
    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);
    const enqueueResult = ctx.requestQueue.enqueue(userId, convId, prompt, async (nextPrompt, signal) => {
      await handleAIRequest({ userId, chatId, prompt: nextPrompt, workDir, convId, replyToMessageId: undefined, signal });
    });

    if (enqueueResult === 'rejected') {
      await sendTextReply(chatId, 'Request queue is full. Please try again later.', reqId);
    } else if (enqueueResult === 'queued') {
      await sendTextReply(chatId, 'Your request is queued.', reqId);
    }
  }

  async function handleEvent(data: WeWorkCallbackMessage): Promise<void> {
    log.info('[handleEvent] Called with data:', JSON.stringify(data).slice(0, 800));

    const reqId = data.headers?.req_id ?? '';
    senderCtx.reqId = reqId;

    try {
      const body = data.body;
      const msgType = body.msgtype;
      const fromUser = body.from.userid;
      const chatId = body.chatid ?? fromUser;

      log.info(`WeWork event: msgType=${msgType}, from=${fromUser}, chatId=${chatId}`);

      // Check access control
      if (!ctx.accessControl.isAllowed(fromUser)) {
        log.warn(`Access denied for sender: ${fromUser}`);
        await sendTextReply(chatId, `Access denied. Your WeWork user ID: ${fromUser}`, reqId);
        return;
      }

      setActiveChatId('wework', chatId);
      setChatUser(chatId, fromUser, 'wework');

      if (msgType === 'text') {
        const text = extractTextContent(data);
        if (!text) return;

        // Use shared text flow
        await handleTextFlow({
          platform: 'wework',
          userId: fromUser,
          chatId,
          text,
          ctx,
          handleAIRequest,
          sendTextReply: (chatId, text) => sendTextReply(chatId, text, reqId),
          workDir: sessionManager.getWorkDir(fromUser),
          convId: sessionManager.getConvId(fromUser),
        });
        return;
      }

      if (msgType === 'mixed' || msgType === 'image') {
        const prompt = await buildMediaPrompt(data, 'image');
        if (!prompt) {
          await sendTextReply(chatId, buildUnsupportedInboundMessage('wework', 'image'), reqId);
          return;
        }
        await enqueuePrompt(fromUser, chatId, prompt, reqId);
        return;
      }

      if (msgType === 'file' || msgType === 'voice' || msgType === 'video') {
        const prompt = await buildMediaPrompt(data, msgType);
        if (!prompt) {
          await sendTextReply(chatId, buildUnsupportedInboundMessage('wework', msgType), reqId);
          return;
        }
        await enqueuePrompt(fromUser, chatId, prompt, reqId);
        return;
      }

      if (msgType === 'stream') {
        log.debug(`[MSG] Stream message from ${fromUser}, streamId=${body.stream?.id}`);
        return;
      }

      log.warn(`[MSG] Unsupported message type: ${msgType}, fromUser=${fromUser}`);
    } catch (err) {
      log.error('[handleEvent] Error processing event:', err);
    }
  }

  return {
    stop: () => {
      // Clean up all safety timers
      for (const timer of safetyTimers.values()) {
        clearTimeout(timer);
      }
      safetyTimers.clear();
    },
    runningTasks: ctx.runningTasks,
    getRunningTaskCount: () => ctx.runningTasks.size,
    handleEvent,
  };
}
