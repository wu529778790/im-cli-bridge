import { resolvePlatformAiCommand, type Config } from "../config.js";
import type { SessionManager } from "../session/session-manager.js";
import {
  sendThinkingMessage,
  updateMessage,
  sendFinalMessages,
  sendErrorMessage,
  sendTextReply,
  sendImageReply,
  sendDirectorySelection,
  startTypingLoop,
} from "./message-sender.js";
import { createLogger } from "../logger.js";
import type { ThreadContext } from "../shared/types.js";
import type { QQAttachment, QQMessageEvent } from "./types.js";
import { buildMediaMetadataPrompt } from "../shared/media-prompt.js";
import { buildSavedMediaBatchPrompt, buildSavedMediaPrompt } from "../shared/media-analysis-prompt.js";
import { buildMediaContext } from "../shared/media-context.js";
import { downloadMediaFromUrl } from "../shared/media-storage.js";
import { setActiveChatId } from "../shared/active-chats.js";
import { setChatUser } from "../shared/chat-user-map.js";
import { createPlatformEventContext } from "../platform/create-event-context.js";
import { createPlatformAIRequestHandler } from "../platform/handle-ai-request.js";
import { handleTextFlow } from "../platform/handle-text-flow.js";
import type { TaskRunState } from "../shared/ai-task.js";

const log = createLogger("QQHandler");
const QQ_THROTTLE_MS = 1200;
const QQ_MIN_STREAM_DELTA_CHARS = 80;
const QQ_EVENT_DEDUP_TTL_MS = 5 * 60 * 1000;
const QQ_EVENT_FINGERPRINT_TTL_MS = 8 * 1000;
type QQAttachmentKind = "image" | "file" | "voice" | "video";

function toChatId(event: QQMessageEvent): string {
  if (event.type === "group") {
    return `group:${event.groupOpenid}`;
  }
  if (event.type === "channel") {
    return `channel:${event.channelId}`;
  }
  return `private:${event.userOpenid}`;
}

function classifyAttachment(attachment: QQAttachment): QQAttachmentKind {
  if (attachment.contentType?.startsWith("image/")) return "image";
  if (attachment.contentType?.startsWith("audio/")) return "voice";
  if (attachment.contentType?.startsWith("video/")) return "video";
  const filename = attachment.filename?.toLowerCase() ?? "";
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(filename)) return "image";
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/.test(filename)) return "voice";
  if (/\.(mp4|mov|avi|mkv|webm|m4v)$/.test(filename)) return "video";
  return "file";
}

async function buildAttachmentPrompt(event: QQMessageEvent): Promise<string | null> {
  if (!event.attachments || event.attachments.length === 0) return null;

  const attachmentSummary = await Promise.all(event.attachments.map(async (attachment) => {
    const kind = classifyAttachment(attachment);
    let localPath: string | undefined;

    if (attachment.url) {
      try {
        localPath = await downloadMediaFromUrl(attachment.url, {
          basenameHint: attachment.filename,
          fallbackExtension:
            kind === "image"
              ? "jpg"
              : kind === "voice"
                ? "ogg"
                : kind === "video"
                  ? "mp4"
                  : "bin",
        });
      } catch (err) {
        log.warn('Failed to download QQ media attachment:', err);
        localPath = undefined;
      }
    }

    return {
      kind,
      url: attachment.url,
      localPath,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
      raw: attachment.raw,
    };
  }));

  if (attachmentSummary.length === 1 && attachmentSummary[0].localPath) {
    return buildSavedMediaPrompt({
      source: "QQ",
      kind: attachmentSummary[0].kind,
      localPath: attachmentSummary[0].localPath,
      text: buildMediaContext({
        Filename: attachmentSummary[0].filename,
        MimeType: attachmentSummary[0].contentType,
        Size: attachmentSummary[0].size,
        Width: attachmentSummary[0].width,
        Height: attachmentSummary[0].height,
      }, event.content || undefined),
    });
  }

  const savedAttachments = attachmentSummary.filter((attachment) => attachment.localPath);
  if (savedAttachments.length > 1 && savedAttachments.length === attachmentSummary.length) {
    return buildSavedMediaBatchPrompt({
      source: "QQ",
      text: event.content || undefined,
      items: savedAttachments.map((attachment) => ({
        kind: attachment.kind,
        localPath: attachment.localPath!,
        label: attachment.filename,
      })),
    });
  }

  return buildMediaMetadataPrompt({
    source: "QQ",
    kind: "attachment",
    text: event.content,
        metadata: attachmentSummary,
    guidance:
      "If direct attachment fetch is not available, explain the limitation and ask the user for a text summary or a resend via Telegram/Feishu/WeWork.",
  });
}

export interface QQEventHandlerHandle {
  stop: () => void;
  getRunningTaskCount: () => number;
  handleEvent: (event: QQMessageEvent) => Promise<void>;
}

export function setupQQHandlers(
  config: Config,
  sessionManager: SessionManager,
): QQEventHandlerHandle {
  // Use shared platform event context factory
  const platformContext = createPlatformEventContext({
    platform: "qq",
    allowedUserIds: config.qqAllowedUserIds,
    config,
    sessionManager,
    sender: { sendTextReply, sendDirectorySelection },
  });

  const { accessControl, requestQueue, runningTasks, commandHandler } = platformContext;

  const recentEventIds = new Map<string, number>();
  const recentEventFingerprints = new Map<string, number>();

  // QQ-specific: Store taskKey -> { { chatId, msgId } } mapping
  // This allows callbacks to access to context they need
  const qqTaskContextMap = new Map<string, { chatId: string; msgId: string }>();

  // Create shared handleAIRequest using factory
  const factoryHandleAIRequest = createPlatformAIRequestHandler({
    platform: "qq",
    config,
    sessionManager,
    sender: {
      sendThinkingMessage: async (chatId, replyToMessageId) => {
        return sendThinkingMessage(chatId, replyToMessageId, undefined);
      },
      sendTextReply: async (chatId, text) => {
        await sendTextReply(chatId, text);
      },
      startTyping: () => {
        return startTypingLoop();
      },
      sendImage: async (chatId, imagePath) => {
        await sendImageReply(chatId, imagePath);
      },
    },
    throttleMs: QQ_THROTTLE_MS,
    minContentDeltaChars: QQ_MIN_STREAM_DELTA_CHARS,
    runningTasks,
    extraInit: (ctx) => {
      // Store context for this task
      qqTaskContextMap.set(ctx.taskKey, { chatId: ctx.chatId, msgId: ctx.msgId });
      return () => {
        qqTaskContextMap.delete(ctx.taskKey);
      };
    },
    taskCallbacks: {
      streamUpdate: async (content: string, toolNote?: string) => {
        // QQ doesn't support streaming updates; this is a no-op
      },
      sendComplete: async (content: string, note?: string) => {
        // QQ sends final - handled via pendingReplies in message-sender.ts
      },
      sendError: async (error: string) => {
        // QQ sends error - handled via pendingReplies in message-sender.ts
      },
    },
  });

  // Wrap factory handleAIRequest to match ClaudeRequestHandler signature
  // (used by commandHandler.dispatch and handleTextFlow)
  async function handleAIRequest(
    userId: string,
    chatId: string,
    prompt: string,
    workDir: string,
    convId?: string,
    _threadCtx?: ThreadContext,
    replyToMessageId?: string,
  ): Promise<void> {
    await factoryHandleAIRequest({
      userId,
      chatId,
      prompt,
      workDir,
      convId,
      replyToMessageId,
    });
  }

  function cleanupRecentEvents(now: number): void {
    for (const [eventId, timestamp] of recentEventIds) {
      if (now - timestamp > QQ_EVENT_DEDUP_TTL_MS) {
        recentEventIds.delete(eventId);
      }
    }

    for (const [fingerprint, timestamp] of recentEventFingerprints) {
      if (now - timestamp > QQ_EVENT_FINGERPRINT_TTL_MS) {
        recentEventFingerprints.delete(fingerprint);
      }
    }
  }

  function buildEventFingerprint(event: QQMessageEvent, chatId: string): string {
    const attachmentKey = (event.attachments ?? [])
      .map((attachment) => [
        attachment.url ?? "",
        attachment.filename ?? "",
        attachment.contentType ?? "",
        attachment.size ?? "",
      ].join("|"))
      .join(";");

    return [
      event.type,
      chatId,
      event.userOpenid,
      (event.content ?? "").trim(),
      attachmentKey,
    ].join("::");
  }

  async function handleEvent(event: QQMessageEvent): Promise<void> {
    const chatId = toChatId(event);
    try {
      const now = Date.now();
      cleanupRecentEvents(now);

      // QQ-specific: Event deduplication by ID
      if (event.id) {
        if (recentEventIds.has(event.id)) {
          log.info(`Skipping duplicate QQ event: ${event.id}`);
          return;
        }
        recentEventIds.set(event.id, now);
      }

      const userId = event.userOpenid;
      const eventFingerprint = buildEventFingerprint(event, chatId);
      const text = event.content?.trim() ?? "";
      const attachmentPrompt = await buildAttachmentPrompt(event);

      // QQ-specific: Event deduplication by fingerprint
      if (recentEventFingerprints.has(eventFingerprint)) {
        log.info(`Skipping duplicate QQ event fingerprint: ${eventFingerprint}`);
        return;
      }
      recentEventFingerprints.set(eventFingerprint, now);

      // Use shared handleTextFlow for text message processing
      if (text) {
        const processed = await handleTextFlow({
          platform: "qq",
          userId,
          chatId,
          text,
          ctx: platformContext,
          handleAIRequest,
          sendTextReply,
          workDir: sessionManager.getWorkDir(userId),
          convId: sessionManager.getConvId(userId),
          replyToMessageId: event.id,
          accessDeniedMessage: (userId) => `Access denied. Your QQ user ID: ${userId}`,
          queueFullMessage: "Request queue is full. Please try again later.",
          queuedMessage: "Your request is queued.",
        });

        if (processed) {
          log.info(`QQ message handled: user=${userId}, chat=${chatId}, text=true`);
          return;
        }
      }

      // Handle attachments-only messages
      if (attachmentPrompt) {
        const workDir = sessionManager.getWorkDir(userId);
        const convId = sessionManager.getConvId(userId);

        // Check access control
        if (!accessControl.isAllowed(userId)) {
          await sendTextReply(chatId, `Access denied. Your QQ user ID: ${userId}`);
          return;
        }

        // Set active chat
        setActiveChatId("qq", chatId);
        setChatUser(chatId, userId, "qq");

        // Enqueue attachment prompt
        const enqueueResult = requestQueue.enqueue(
          userId,
          convId ?? '',
          attachmentPrompt,
          async (prompt) => {
            await handleAIRequest(
              userId,
              chatId,
              prompt,
              workDir,
              convId,
              undefined,
              event.id,
            );
          },
        );

        if (enqueueResult === "rejected") {
          await sendTextReply(chatId, "Request queue is full. Please try again later.");
        } else if (enqueueResult === "queued") {
          await sendTextReply(chatId, "Your request is queued.");
        }

        log.info(`QQ message handled: user=${userId}, chat=${chatId}, attachments=${event.attachments?.length ?? 0}`);
      }
    } catch (err) {
      log.error('Unhandled error in QQ event handler:', err);
      try {
        if (chatId) {
          await sendTextReply(chatId, 'Internal error occurred. Please try again.');
        }
      } catch { /* ignore */ }
    }
  }

  return {
    stop: () => {},
    getRunningTaskCount: () => runningTasks.size,
    handleEvent,
  };
}
