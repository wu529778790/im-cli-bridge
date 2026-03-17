import type { DWClientDownStream, RobotMessage } from 'dingtalk-stream';
import { resolvePlatformAiCommand, type Config } from '../config.js';
import { AccessControl } from '../access/access-control.js';
import type { SessionManager } from '../session/session-manager.js';
import { RequestQueue } from '../queue/request-queue.js';
import {
  configureDingTalkMessageSender,
  sendThinkingMessage,
  updateMessage,
  sendFinalMessages,
  sendErrorMessage,
  sendTextReply,
  sendImageReply,
  startTypingLoop,
  sendDirectorySelection,
} from './message-sender.js';
import { ackMessage, downloadRobotMessageFile, registerSessionWebhook } from './client.js';
import { CommandHandler } from '../commands/handler.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask, type TaskRunState } from '../shared/ai-task.js';
import { startTaskCleanup } from '../shared/task-cleanup.js';
import { setActiveChatId, setDingTalkActiveTarget } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import { createLogger } from '../logger.js';
import type { ThreadContext } from '../shared/types.js';
import type { DingTalkStreamingTarget } from './client.js';
import { buildUnsupportedInboundMessage } from '../channels/capabilities.js';
import { buildMediaMetadataPrompt } from '../shared/media-prompt.js';
import { buildSavedMediaPrompt } from '../shared/media-analysis-prompt.js';
import { buildMediaContext } from '../shared/media-context.js';
import {
  downloadMediaFromUrl,
  inferExtensionFromBuffer,
  inferExtensionFromContentType,
  saveBufferMedia,
} from '../shared/media-storage.js';

const log = createLogger('DingTalkHandler');
const DINGTALK_THROTTLE_MS = 1000;
type DingTalkInboundKind = 'image' | 'file' | 'voice' | 'video';
type DingTalkRobotPayload = RobotMessage & Record<string, unknown>;

export interface DingTalkEventHandlerHandle {
  stop: () => void;
  getRunningTaskCount: () => number;
  handleEvent: (data: DWClientDownStream) => Promise<void>;
}

function parseRobotMessage(data: DWClientDownStream): RobotMessage | null {
  try {
    return JSON.parse(data.data) as RobotMessage;
  } catch (err) {
    log.error('Failed to parse DingTalk message:', err);
    return null;
  }
}

function toInboundKind(msgType: string): 'image' | 'file' | 'voice' | 'video' {
  if (msgType === 'picture' || msgType === 'image') return 'image';
  if (msgType === 'audio' || msgType === 'voice') return 'voice';
  if (msgType === 'video') return 'video';
  return 'file';
}

function extractMediaPayload(message: DingTalkRobotPayload, kind: DingTalkInboundKind): Record<string, unknown> | null {
  const candidates = [
    message[kind],
    kind === 'image' ? message.picture : undefined,
    kind === 'voice' ? message.audio : undefined,
    kind === 'file' ? message.file : undefined,
    kind === 'video' ? message.video : undefined,
    message.content,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') {
      return candidate as Record<string, unknown>;
    }
  }

  return null;
}

function buildDingTalkMediaContext(text: string | undefined, payload: Record<string, unknown>): string | undefined {
  const fileName = typeof payload.fileName === 'string'
    ? payload.fileName
    : typeof payload.file_name === 'string'
      ? payload.file_name
      : undefined;
  const duration = typeof payload.duration === 'number'
    ? payload.duration
    : typeof payload.duration === 'string'
      ? payload.duration
      : undefined;
  const mediaType = typeof payload.fileType === 'string'
    ? payload.fileType
    : typeof payload.file_type === 'string'
      ? payload.file_type
      : undefined;
  return buildMediaContext({
    Filename: fileName,
    MediaType: mediaType,
    Duration: duration,
  }, text);
}

async function buildMediaPrompt(
  message: DingTalkRobotPayload,
  kind: DingTalkInboundKind,
  robotCodeFallback?: string,
): Promise<string | null> {
  const payload = extractMediaPayload(message, kind);
  if (!payload) return null;
  const text = typeof message.text?.content === 'string' ? message.text.content.trim() : undefined;
  const contextText = buildDingTalkMediaContext(text, payload);

  const remoteUrl = [
    payload.url,
    payload.downloadUrl,
    payload.download_url,
    payload.picUrl,
  ].find((value): value is string => typeof value === 'string' && value.length > 0);
  const downloadCode = [
    payload.downloadCode,
    payload.download_code,
    payload.pictureDownloadCode,
    payload.picture_download_code,
  ].find((value): value is string => typeof value === 'string' && value.length > 0);
  let localPath: string | undefined;
  if (remoteUrl) {
    try {
      localPath = await downloadMediaFromUrl(remoteUrl, {
        basenameHint: typeof payload.fileName === 'string' ? payload.fileName : undefined,
        fallbackExtension: kind === 'image' ? 'jpg' : 'bin',
      });
    } catch {
      localPath = undefined;
    }
  }

  if (!localPath && downloadCode) {
    try {
      const robotCode =
        (typeof message.robotCode === 'string' && message.robotCode.length > 0
          ? message.robotCode
          : robotCodeFallback) ?? '';
      if (robotCode) {
        const downloaded = await downloadRobotMessageFile(downloadCode, robotCode);
        const extension =
          inferExtensionFromContentType(downloaded.contentType ?? '') ||
          inferExtensionFromBuffer(downloaded.buffer) ||
          (kind === 'image' ? '.jpg' : '.bin');
        const basenameHint =
          downloaded.filename ??
          (typeof payload.fileName === 'string' ? payload.fileName : undefined);
        localPath = await saveBufferMedia(downloaded.buffer, extension, basenameHint);
      }
    } catch {
      localPath = undefined;
    }
  }

  if (localPath) {
    return buildSavedMediaPrompt({
      source: 'DingTalk',
      kind,
      localPath,
      text: contextText,
    });
  }

  const sanitized = {
    msgtype: message.msgtype,
    conversationType: message.conversationType,
    senderNick: message.senderNick,
    payload,
  };

  return buildMediaMetadataPrompt({
    source: 'DingTalk',
    kind,
    text: contextText,
    metadata: sanitized,
  });
}

export function setupDingTalkHandlers(
  config: Config,
  sessionManager: SessionManager,
): DingTalkEventHandlerHandle {
  configureDingTalkMessageSender({
    cardTemplateId: config.dingtalkCardTemplateId,
    robotCodeFallback: config.dingtalkClientId,
  });
  if (config.dingtalkCardTemplateId) {
    log.info('DingTalk AI card streaming enabled');
  } else {
    log.info('DingTalk AI card streaming disabled: no cardTemplateId configured');
  }

  const accessControl = new AccessControl(config.dingtalkAllowedUserIds);
  const requestQueue = new RequestQueue();
  const runningTasks = new Map<string, TaskRunState>();
  const stopTaskCleanup = startTaskCleanup(runningTasks);

  const commandHandler = new CommandHandler({
    config,
    sessionManager,
    requestQueue,
    sender: { sendTextReply, sendDirectorySelection },
    getRunningTasksSize: () => runningTasks.size,
  });

  async function enqueuePrompt(
    userId: string,
    chatId: string,
    prompt: string,
    dingtalkTarget?: DingTalkStreamingTarget,
  ): Promise<'running' | 'queued' | 'rejected'> {
    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);
    return requestQueue.enqueue(userId, convId, prompt, async (nextPrompt) => {
      await handleAIRequest(userId, chatId, nextPrompt, workDir, convId, undefined, undefined, dingtalkTarget);
    });
  }

  async function handleAIRequest(
    userId: string,
    chatId: string,
    prompt: string,
    workDir: string,
    convId?: string,
    _threadCtx?: ThreadContext,
    replyToMessageId?: string,
    dingtalkTarget?: DingTalkStreamingTarget,
  ) {
    log.info(`[AI_REQUEST] userId=${userId}, chatId=${chatId}, promptLength=${prompt.length}`);

    const aiCommand = resolvePlatformAiCommand(config, 'dingtalk');
    const toolAdapter = getAdapter(aiCommand);
    if (!toolAdapter) {
      await sendTextReply(chatId, `AI tool is not configured: ${aiCommand}`);
      return;
    }

    const sessionId = convId
      ? sessionManager.getSessionIdForConv(userId, convId, aiCommand)
      : undefined;
    log.info(`[AI_REQUEST] Running ${aiCommand} for user ${userId}, sessionId=${sessionId ?? 'new'}`);

    const toolId = aiCommand;
    const msgId = await sendThinkingMessage(chatId, replyToMessageId, toolId, dingtalkTarget);
    const stopTyping = startTypingLoop(chatId);
    const taskKey = `${userId}:${msgId}`;

    await runAITask(
      { config, sessionManager },
      { userId, chatId, workDir, sessionId, convId, platform: 'dingtalk', taskKey },
      prompt,
      toolAdapter,
      {
        throttleMs: DINGTALK_THROTTLE_MS,
        streamUpdate: async (content, toolNote) => {
          await updateMessage(chatId, msgId, content, 'streaming', toolNote, toolId);
        },
        sendComplete: async (content, note) => {
          await sendFinalMessages(chatId, msgId, content, note ?? '', toolId);
        },
        sendError: async (error) => {
          await sendErrorMessage(chatId, msgId, error, toolId);
        },
        extraCleanup: () => {
          stopTyping();
          runningTasks.delete(taskKey);
        },
        onTaskReady: (state) => {
          runningTasks.set(taskKey, state);
        },
        sendImage: async (path) => {
          await sendImageReply(chatId, path);
        },
      },
    );
  }

  async function handleEvent(data: DWClientDownStream): Promise<void> {
    const robotMessage = parseRobotMessage(data);
    const callbackId = data.headers.messageId;

    if (!robotMessage) {
      ackMessage(callbackId, { error: 'invalid payload' });
      return;
    }

    const message = robotMessage as DingTalkRobotPayload;
    const chatId = message.conversationId;
    const userId = message.senderStaffId || message.senderId;
    const text = message.msgtype === 'text' ? message.text?.content?.trim() ?? '' : '';

    log.info(`[MSG] DingTalk message: type=${message.msgtype}, user=${userId}, chat=${chatId}`);

    if (!accessControl.isAllowed(userId)) {
      await sendTextReply(chatId, `Access denied. Your DingTalk user ID: ${userId}`);
      ackMessage(callbackId, { denied: true });
      return;
    }

    registerSessionWebhook(chatId, message.sessionWebhook);
    setActiveChatId('dingtalk', chatId);
    setDingTalkActiveTarget({
      chatId,
      userId,
      conversationType: message.conversationType,
      robotCode: message.robotCode || config.dingtalkClientId,
    });
    setChatUser(chatId, userId, 'dingtalk');

    const dingtalkTarget: DingTalkStreamingTarget = {
      chatId,
      conversationType: message.conversationType,
      senderStaffId: message.senderStaffId,
      senderId: message.senderId,
      robotCode: message.robotCode || config.dingtalkClientId,
    };

    if (message.msgtype !== 'text') {
      const kind = toInboundKind(message.msgtype);
      const prompt = await buildMediaPrompt(message, kind, config.dingtalkClientId);
      if (!prompt) {
        await sendTextReply(chatId, buildUnsupportedInboundMessage('dingtalk', kind));
        ackMessage(callbackId, { ignored: message.msgtype });
        return;
      }

      const enqueueResult = await enqueuePrompt(userId, chatId, prompt, dingtalkTarget);
      if (enqueueResult === 'rejected') {
        await sendTextReply(chatId, 'Request queue is full. Please try again later.');
      } else if (enqueueResult === 'queued') {
        await sendTextReply(chatId, 'Your request is queued.');
      }
      ackMessage(callbackId, { queued: enqueueResult, kind });
      return;
    }

    if (!text) {
      ackMessage(callbackId, { ignored: 'empty text' });
      return;
    }

    try {
      const handled = await commandHandler.dispatch(text, chatId, userId, 'dingtalk', handleAIRequest);
      if (handled) {
        ackMessage(callbackId, { handled: true });
        return;
      }
    } catch (err) {
      log.error('Error in commandHandler.dispatch:', err);
    }

    const enqueueResult = await enqueuePrompt(userId, chatId, text, dingtalkTarget);

    if (enqueueResult === 'rejected') {
      await sendTextReply(chatId, 'Request queue is full. Please try again later.');
    } else if (enqueueResult === 'queued') {
      await sendTextReply(chatId, 'Your request is queued.');
    }

    ackMessage(callbackId, { queued: enqueueResult });
  }

  return {
    stop: () => stopTaskCleanup(),
    getRunningTaskCount: () => runningTasks.size,
    handleEvent,
  };
}
