/**
 * WeChat Event Handler - Handle WeChat message events from AGP WebSocket
 */

import { resolvePlatformAiCommand, type Config } from '../config.js';
import { AccessControl } from '../access/access-control.js';
import type { SessionManager } from '../session/session-manager.js';
import { RequestQueue } from '../queue/request-queue.js';
import {
  sendThinkingMessage,
  updateMessage,
  sendFinalMessages,
  sendTextReply,
  sendImageReply,
  startTypingLoop,
} from './message-sender.js';
import { CommandHandler } from '../commands/handler.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask, type TaskRunState } from '../shared/ai-task.js';
import { startTaskCleanup } from '../shared/task-cleanup.js';
import { WECHAT_THROTTLE_MS } from '../constants.js';
import { setActiveChatId } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import { createLogger } from '../logger.js';
import type { AGPEnvelope, SessionPromptPayload, WeChatIncomingMessage } from './types.js';
import { buildSavedMediaPrompt } from '../shared/media-analysis-prompt.js';
import { buildMediaMetadataPrompt } from '../shared/media-prompt.js';
import { buildMediaContext } from '../shared/media-context.js';
import { downloadMediaFromUrl } from '../shared/media-storage.js';
import { buildErrorNote, buildProgressNote } from '../shared/message-note.js';

const log = createLogger('WeChatHandler');
type WeChatInboundMediaKind = 'image' | 'file' | 'voice' | 'video';

function getWeChatFilename(message: WeChatIncomingMessage): string | undefined {
  return message.filename || message.file_name;
}

function getWeChatMimeType(message: WeChatIncomingMessage): string | undefined {
  return message.mime_type || message.mimeType;
}

function getWeChatFileSize(message: WeChatIncomingMessage): number | undefined {
  return typeof message.file_size === 'number'
    ? message.file_size
    : typeof message.size === 'number'
      ? message.size
      : undefined;
}

export interface WeChatEventHandlerHandle {
  stop: () => void;
  getRunningTaskCount: () => number;
  handleEvent: (data: unknown) => Promise<void>;
}

export function setupWeChatHandlers(
  config: Config,
  sessionManager: SessionManager,
): WeChatEventHandlerHandle {
  const accessControl = new AccessControl(config.wechatAllowedUserIds);
  const requestQueue = new RequestQueue();
  const runningTasks = new Map<string, TaskRunState>();
  const taskKeyByChatId = new Map<string, string>();
  const stopTaskCleanup = startTaskCleanup(runningTasks);

  const commandHandler = new CommandHandler({
    config,
    sessionManager,
    requestQueue,
    sender: { sendTextReply },
    getRunningTasksSize: () => runningTasks.size,
  });

  function parseWeChatIncomingMessage(raw: string): WeChatIncomingMessage | null {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.msg_type !== 'string') {
        return null;
      }
      return parsed as unknown as WeChatIncomingMessage;
    } catch (err) {
      log.debug('Failed to parse WeChat incoming message JSON:', err);
      return null;
    }
  }

  async function buildWeChatMediaPrompt(message: WeChatIncomingMessage): Promise<string | null> {
    const kind = message.msg_type as WeChatInboundMediaKind;
    if (!['image', 'file', 'voice', 'video'].includes(kind)) {
      return null;
    }

    const mediaUrl = kind === 'image' ? message.image_url : message.file_url;
    const contextText = buildMediaContext({
      FromUser: message.from_user_name || message.from_user_id,
      MessageType: message.msg_type,
      Filename: getWeChatFilename(message),
      MimeType: getWeChatMimeType(message),
      FileSize: getWeChatFileSize(message),
      Duration: message.duration,
    }, message.content || undefined);

    if (typeof mediaUrl === 'string' && mediaUrl.length > 0) {
      try {
        const savedPath = await downloadMediaFromUrl(mediaUrl, {
          basenameHint: getWeChatFilename(message) || message.msg_id,
          fallbackExtension:
            kind === 'image'
              ? 'jpg'
              : kind === 'voice'
                ? 'ogg'
                : kind === 'video'
                  ? 'mp4'
                  : 'bin',
        });
        return buildSavedMediaPrompt({
          source: 'WeChat',
          kind,
          localPath: savedPath,
          text: contextText,
        });
      } catch (err) {
        log.warn('Failed to download WeChat media, falling back to metadata-only prompt:', err);
      }
    }

    return buildMediaMetadataPrompt({
      source: 'WeChat',
      kind,
      text: contextText,
      metadata: {
        msg_id: message.msg_id,
        from_user_id: message.from_user_id,
        filename: getWeChatFilename(message),
        mime_type: getWeChatMimeType(message),
        file_size: getWeChatFileSize(message),
        duration: message.duration,
        image_url: message.image_url,
        file_url: message.file_url,
      },
    });
  }

  async function handleAIRequest(
    userId: string,
    chatId: string,
    prompt: string,
    workDir: string,
    convId?: string,
    _threadCtx?: { rootMessageId: string; threadId: string },
    replyToMessageId?: string,
  ) {
    log.info(`[AI_REQUEST] userId=${userId}, chatId=${chatId}, promptLength=${prompt.length}`);

    const aiCommand = resolvePlatformAiCommand(config, 'wechat');
    const toolAdapter = getAdapter(aiCommand);
    if (!toolAdapter) {
      log.error(`[handleAIRequest] No adapter found for: ${aiCommand}`);
      await sendTextReply(chatId, `AI tool is not configured: ${aiCommand}`);
      return;
    }

    const sessionId = convId
      ? sessionManager.getSessionIdForConv(userId, convId, aiCommand)
      : undefined;
    log.info(`[handleAIRequest] Running ${aiCommand} for user ${userId}, sessionId=${sessionId ?? 'new'}`);

    const toolId = aiCommand;
    let msgId: string;
    try {
      msgId = await sendThinkingMessage(chatId, replyToMessageId, toolId);
    } catch (err) {
      log.error('Failed to send thinking message:', err);
      try {
        await sendTextReply(chatId, '启动 AI 处理失败，请重试。');
      } catch (err) {
        log.warn('Failed to send startup error reply:', err);
      }
      return;
    }

    const stopTyping = startTypingLoop(chatId);
    const taskKey = `${userId}:${msgId}`;

    await runAITask(
      { config, sessionManager },
      { userId, chatId, workDir, sessionId, convId, platform: 'wechat', taskKey },
      prompt,
      toolAdapter,
      {
        throttleMs: WECHAT_THROTTLE_MS,
        streamUpdate: async (content, toolNote) => {
          const note = buildProgressNote(toolNote);
          try {
            await updateMessage(chatId, msgId, content, 'streaming', note, toolId);
          } catch (err) {
            log.debug('Stream update failed:', err);
          }
        },
        sendComplete: async (content, note) => {
          await sendFinalMessages(chatId, msgId, content, note ?? '', toolId);
        },
        sendError: async (error) => {
          await updateMessage(chatId, msgId, `Error: ${error}`, 'error', buildErrorNote(), toolId);
        },
        extraCleanup: () => {
          stopTyping();
          runningTasks.delete(taskKey);
          if (taskKeyByChatId.get(chatId) === taskKey) {
            taskKeyByChatId.delete(chatId);
          }
        },
        onTaskReady: (state) => {
          runningTasks.set(taskKey, state);
          taskKeyByChatId.set(chatId, taskKey);
        },
        sendImage: async (path) => {
          await sendImageReply(chatId, path);
        },
      },
    );
  }

  async function handleEvent(data: unknown): Promise<void> {
    log.info('[handleEvent] Called with data:', JSON.stringify(data).slice(0, 800));

    try {
      const envelope = data as AGPEnvelope<SessionPromptPayload>;

      if (!envelope.method || !envelope.payload) {
        log.warn('Invalid AGP envelope: missing method or payload');
        return;
      }

      switch (envelope.method) {
        case 'session.prompt':
          await handleSessionPrompt(envelope);
          break;
        case 'session.cancel':
          await handleSessionCancel(envelope);
          break;
        case 'session.update':
          await handleSessionUpdate(envelope);
          break;
        case 'ping':
          log.debug('Received ping, no action needed');
          break;
        default:
          log.warn('Unknown AGP method:', envelope.method);
      }
    } catch (err) {
      log.error('[handleEvent] Error processing event:', err);
    }
  }

  async function handleSessionPrompt(envelope: AGPEnvelope<SessionPromptPayload>): Promise<void> {
    const payload = envelope.payload;
    const userId = envelope.user_id ?? envelope.guid ?? 'unknown';
    const chatId = payload.session_id;
    const rawContent = payload.content?.trim() ?? '';
    const inboundMessage = parseWeChatIncomingMessage(rawContent);
    const text = inboundMessage ? inboundMessage.content?.trim() ?? '' : rawContent;

    log.info(`[SESSION_PROMPT] userId=${userId}, chatId=${chatId}, text="${text}"`);

    if (!accessControl.isAllowed(userId)) {
      log.warn(`Access denied for sender: ${userId}`);
      await sendTextReply(chatId, `Access denied. Your WeChat user ID: ${userId}`);
      return;
    }

    setActiveChatId('wechat', chatId);
    setChatUser(chatId, userId, 'wechat');

    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);
    let prompt = text;
    if (inboundMessage && inboundMessage.msg_type !== 'text') {
      const mediaPrompt = await buildWeChatMediaPrompt(inboundMessage);
      if (mediaPrompt) {
        prompt = mediaPrompt;
      }
    } else {
      try {
        const handled = await commandHandler.dispatch(text, chatId, userId, 'wechat', handleAIRequest);
        if (handled) {
          log.info(`Command handled for message: ${text}`);
          return;
        }
      } catch (err) {
        log.error('Error in commandHandler.dispatch:', err);
      }
    }

    if (!prompt) {
      return;
    }

    const enqueueResult = requestQueue.enqueue(userId, convId, prompt, async (nextPrompt) => {
      log.info(`Executing AI request for: ${prompt}`);
      await handleAIRequest(userId, chatId, nextPrompt, workDir, convId);
    });

    if (enqueueResult === 'rejected') {
      await sendTextReply(chatId, 'Request queue is full. Please try again later.');
    } else if (enqueueResult === 'queued') {
      await sendTextReply(chatId, 'Your request is queued.');
    }
  }

  async function handleSessionCancel(envelope: AGPEnvelope): Promise<void> {
    const payload = envelope.payload as { session_id: string; reason?: string };
    const chatId = payload.session_id;
    log.info(`[SESSION_CANCEL] chatId=${chatId}, reason=${payload.reason ?? 'none'}`);

    const taskKey = taskKeyByChatId.get(chatId);
    if (taskKey) {
      const state = runningTasks.get(taskKey);
      if (state?.handle) {
        log.info(`Cancelling task: ${taskKey}`);
        state.handle.abort();
        state.settle();
      }
      runningTasks.delete(taskKey);
      taskKeyByChatId.delete(chatId);
      await sendTextReply(chatId, 'Task cancelled.');
      return;
    }

    await sendTextReply(chatId, 'No running task found for this session.');
  }

  async function handleSessionUpdate(envelope: AGPEnvelope): Promise<void> {
    const payload = envelope.payload as { session_id: string; updates: Record<string, unknown> };
    const chatId = payload.session_id;
    const updates = payload.updates;

    log.info(`[SESSION_UPDATE] chatId=${chatId}, updates=`, JSON.stringify(updates));

  }

  return {
    stop: () => stopTaskCleanup(),
    getRunningTaskCount: () => runningTasks.size,
    handleEvent,
  };
}
