/**
 * WeWork Event Handler - Handle WeWork message events
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config.js';
import { AccessControl } from '../access/access-control.js';
import type { SessionManager } from '../session/session-manager.js';
import { RequestQueue } from '../queue/request-queue.js';
import {
  sendThinkingMessage,
  updateMessage,
  sendFinalMessages,
  sendTextReply,
  startTypingLoop,
  sendPermissionCard,
  sendModeCard,
  setCurrentReqId,
} from './message-sender.js';
import { registerPermissionSender } from '../hook/permission-server.js';
import { CommandHandler } from '../commands/handler.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask, type TaskRunState } from '../shared/ai-task.js';
import { startTaskCleanup } from '../shared/task-cleanup.js';
import { IMAGE_DIR, WEWORK_THROTTLE_MS } from '../constants.js';
import { setActiveChatId } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import { createLogger } from '../logger.js';
import type { ThreadContext } from '../shared/types.js';
import type { WeWorkCallbackMessage } from './types.js';
import { buildImageFallbackMessage, buildUnsupportedInboundMessage } from '../channels/capabilities.js';
import { buildMediaMetadataPrompt } from '../shared/media-prompt.js';

const log = createLogger('WeWorkHandler');

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
  getRunningTaskCount: () => number;
  handleEvent: (data: WeWorkCallbackMessage) => Promise<void>;
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

async function saveBase64Payload(base64: string, extension: string): Promise<string> {
  await mkdir(IMAGE_DIR, { recursive: true });
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const path = join(IMAGE_DIR, filename);
  await writeFile(path, Buffer.from(base64, 'base64'));
  return path;
}

async function buildMediaPrompt(data: WeWorkCallbackMessage, kind: MediaKind): Promise<string | null> {
  const text = extractTextContent(data);
  const payload = extractMediaPayload(data, kind);

  if (kind === 'image') {
    const imagePayload = payload ?? extractImagePayload(data);
    if (!imagePayload) return null;

    let imageReference = '';
    if (typeof imagePayload.base64 === 'string' && imagePayload.base64.length > 0) {
      const savedPath = await saveBase64Payload(imagePayload.base64, 'jpg');
      imageReference = `Saved local image path: ${savedPath}`;
    } else if (typeof imagePayload.url === 'string' && imagePayload.url.length > 0) {
      imageReference = `Remote image URL: ${imagePayload.url}`;
    }

    return buildMediaMetadataPrompt({
      source: 'WeWork',
      kind: 'image',
      text,
      metadata: {
        reference: imageReference || 'No direct image bytes were included; only metadata is available.',
        payload: imagePayload,
      },
      guidance:
        'Analyze the image if a local path or accessible URL is available. Otherwise explain the limitation and ask the user to resend via Telegram/Feishu or provide more context.',
    });
  }

  return buildMediaMetadataPrompt({
    source: 'WeWork',
    kind,
    text,
    metadata: payload ?? 'none',
    guidance:
      'If the media content is not directly accessible, explain that clearly and ask the user for a text summary, transcript, or a resend via a channel with native media support.',
  });
}

export function setupWeWorkHandlers(
  config: Config,
  sessionManager: SessionManager,
): WeWorkEventHandlerHandle {
  const accessControl = new AccessControl(config.weworkAllowedUserIds);
  const requestQueue = new RequestQueue();
  const runningTasks = new Map<string, TaskRunState>();
  const stopTaskCleanup = startTaskCleanup(runningTasks);

  const commandHandler = new CommandHandler({
    config,
    sessionManager,
    requestQueue,
    sender: { sendTextReply, sendModeCard },
    getRunningTasksSize: () => runningTasks.size,
  });

  registerPermissionSender('wework', { sendTextReply, sendPermissionCard });

  async function handleAIRequest(
    userId: string,
    chatId: string,
    prompt: string,
    workDir: string,
    convId?: string,
    _threadCtx?: { rootMessageId: string; threadId: string },
    replyToMessageId?: string,
    reqId?: string,
  ) {
    log.info(`[AI_REQUEST] userId=${userId}, chatId=${chatId}, promptLength=${prompt.length}`);
    if (reqId) setCurrentReqId(reqId);

    try {
      const toolAdapter = getAdapter(config.aiCommand);
      if (!toolAdapter) {
        log.error(`[handleAIRequest] No adapter found for: ${config.aiCommand}`);
        await sendTextReply(chatId, `AI tool is not configured: ${config.aiCommand}`, reqId);
        return;
      }

      const sessionId = convId
        ? sessionManager.getSessionIdForConv(userId, convId, config.aiCommand)
        : undefined;
      log.info(`[handleAIRequest] Running ${config.aiCommand} for user ${userId}, sessionId=${sessionId ?? 'new'}`);

      const toolId = config.aiCommand;
      const msgId = await sendThinkingMessage(chatId, replyToMessageId, toolId, reqId);
      const stopTyping = startTypingLoop(chatId);
      const taskKey = `${userId}:${msgId}`;

      await runAITask(
        { config, sessionManager },
        { userId, chatId, workDir, sessionId, convId, platform: 'wework', taskKey },
        prompt,
        toolAdapter,
        {
          throttleMs: WEWORK_THROTTLE_MS,
          streamUpdate: async (content, toolNote) => {
            const note = toolNote ? `Working...\n${toolNote}` : 'Working...';
            try {
              await updateMessage(chatId, msgId, content, 'streaming', note, toolId, reqId);
            } catch (err) {
              log.debug('Stream update failed:', err);
            }
          },
          sendComplete: async (content, note) => {
            await sendFinalMessages(chatId, msgId, content, note ?? '', toolId, reqId);
          },
          sendError: async (error) => {
            await updateMessage(chatId, msgId, `Error: ${error}`, 'error', 'Execution failed', toolId, reqId);
          },
          extraCleanup: () => {
            stopTyping();
            runningTasks.delete(taskKey);
          },
          onTaskReady: (state) => {
            runningTasks.set(taskKey, state);
          },
          sendImage: async (path) => {
            await sendTextReply(chatId, buildImageFallbackMessage('wework', path), reqId);
          },
        },
      );
    } finally {
      setCurrentReqId(null);
    }
  }

  async function enqueuePrompt(
    userId: string,
    chatId: string,
    prompt: string,
    reqId: string,
  ): Promise<void> {
    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);
    const enqueueResult = requestQueue.enqueue(userId, convId, prompt, async (nextPrompt) => {
      await handleAIRequest(userId, chatId, nextPrompt, workDir, convId, undefined, undefined, reqId);
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
    setCurrentReqId(reqId);

    try {
      const body = data.body;
      const msgType = body.msgtype;
      const fromUser = body.from.userid;
      const chatId = body.chatid ?? fromUser;

      log.info(`WeWork event: msgType=${msgType}, from=${fromUser}, chatId=${chatId}`);

      if (!accessControl.isAllowed(fromUser)) {
        log.warn(`Access denied for sender: ${fromUser}`);
        await sendTextReply(chatId, `Access denied. Your WeWork user ID: ${fromUser}`, reqId);
        return;
      }

      setActiveChatId('wework', chatId);
      setChatUser(chatId, fromUser, 'wework');

      if (msgType === 'text') {
        const text = extractTextContent(data);
        if (!text) return;

        try {
          const handleAIRequestWithReqId = (
            u: string,
            c: string,
            p: string,
            w: string,
            conv?: string,
            tc?: ThreadContext,
            replyTo?: string,
          ) => handleAIRequest(u, c, p, w, conv, tc, replyTo, reqId);
          const handled = await commandHandler.dispatch(text, chatId, fromUser, 'wework', handleAIRequestWithReqId);
          if (handled) return;
        } catch (err) {
          log.error('Error in commandHandler.dispatch:', err);
        }

        await enqueuePrompt(fromUser, chatId, text, reqId);
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
    } finally {
      setCurrentReqId(null);
    }
  }

  return {
    stop: () => stopTaskCleanup(),
    getRunningTaskCount: () => runningTasks.size,
    handleEvent,
  };
}
