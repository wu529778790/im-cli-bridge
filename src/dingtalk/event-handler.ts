import type { DWClientDownStream, RobotMessage } from 'dingtalk-stream';
import { type Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
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
import { createPlatformEventContext } from '../platform/create-event-context.js';
import { createPlatformAIRequestHandler, type PlatformSender, type PlatformTaskCallbacks } from '../platform/handle-ai-request.js';
import { setActiveChatId, setDingTalkActiveTarget } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import { createLogger } from '../logger.js';
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
  runningTasks: Map<string, import('../shared/ai-task.js').TaskRunState>;
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
    } catch (err) {
      log.warn('Failed to download DingTalk media from URL:', err);
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
    } catch (err) {
      log.warn('Failed to download DingTalk media via robotCode:', err);
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

  // Mutable ref that captures the dingtalkTarget of the message currently being handled.
  // DingTalk delivers messages sequentially via stream, so there is no race condition.
  const senderCtx = { dingtalkTarget: undefined as DingTalkStreamingTarget | undefined };

  const ctx = createPlatformEventContext({
    platform: 'dingtalk',
    allowedUserIds: config.dingtalkAllowedUserIds,
    config,
    sessionManager,
    sender: { sendTextReply, sendDirectorySelection },
  });
  const { accessControl, requestQueue, runningTasks, commandHandler } = ctx;

  // DingTalk-specific sender callbacks for the factory
  const dingtalkSender: PlatformSender = {
    sendThinkingMessage: async (chatId, replyToMessageId, toolId) => {
      return await sendThinkingMessage(chatId, replyToMessageId, toolId, senderCtx.dingtalkTarget);
    },
    sendTextReply: async (chatId, text) => {
      await sendTextReply(chatId, text);
    },
    startTyping: (chatId) => startTypingLoop(chatId),
    sendImage: async (chatId, imagePath) => {
      await sendImageReply(chatId, imagePath);
    },
  };

  // DingTalk-specific task callbacks factory
  const dingtalkTaskCallbacksFactory = (factoryCtx: {
    chatId: string;
    msgId: string;
    taskKey: string;
    userId: string;
    toolId: string;
    replyToMessageId: string | undefined;
  }): PlatformTaskCallbacks => ({
    streamUpdate: async (content, toolNote) => {
      await updateMessage(factoryCtx.chatId, factoryCtx.msgId, content, 'streaming', toolNote, factoryCtx.toolId);
    },
    sendComplete: async (content, note) => {
      await sendFinalMessages(factoryCtx.chatId, factoryCtx.msgId, content, note ?? '', factoryCtx.toolId);
    },
    sendError: async (error) => {
      await sendErrorMessage(factoryCtx.chatId, factoryCtx.msgId, error, factoryCtx.toolId);
    },
  });

  const handleAIRequest = createPlatformAIRequestHandler({
    platform: 'dingtalk',
    config,
    sessionManager,
    sender: dingtalkSender,
    throttleMs: DINGTALK_THROTTLE_MS,
    runningTasks,
    taskCallbacksFactory: dingtalkTaskCallbacksFactory,
  });

  async function enqueuePrompt(
    userId: string,
    chatId: string,
    prompt: string,
    dingtalkTarget?: DingTalkStreamingTarget,
  ): Promise<'running' | 'queued' | 'rejected'> {
    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);
    return requestQueue.enqueue(userId, convId, prompt, async (nextPrompt, signal) => {
      senderCtx.dingtalkTarget = dingtalkTarget;
      await handleAIRequest({ userId, chatId, prompt: nextPrompt, workDir, convId, signal });
    });
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
      await sendTextReply(chatId, `抱歉，您没有访问权限。\n您的 ID: ${userId}`);
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
        await sendTextReply(chatId, '请求队列已满，请稍后再试。');
      } else if (enqueueResult === 'queued') {
        await sendTextReply(chatId, '您的请求已排队等待。');
      }
      ackMessage(callbackId, { queued: enqueueResult, kind });
      return;
    }

    if (!text) {
      ackMessage(callbackId, { ignored: 'empty text' });
      return;
    }

    try {
      const handled = await commandHandler.dispatch(text, chatId, userId, 'dingtalk', (userId, chatId, prompt, workDir, convId) => {
        return handleAIRequest({ userId, chatId, prompt, workDir, convId });
      });
      if (handled) {
        ackMessage(callbackId, { handled: true });
        return;
      }
    } catch (err) {
      log.error('Error in commandHandler.dispatch:', err);
    }

    const enqueueResult = await enqueuePrompt(userId, chatId, text, dingtalkTarget);

    if (enqueueResult === 'rejected') {
      await sendTextReply(chatId, '请求队列已满，请稍后再试。');
    } else if (enqueueResult === 'queued') {
      await sendTextReply(chatId, '您的请求已排队等待。');
    }

    ackMessage(callbackId, { queued: enqueueResult });
  }

  return {
    stop: () => {},
    runningTasks,
    getRunningTaskCount: () => runningTasks.size,
    handleEvent,
  };
}
