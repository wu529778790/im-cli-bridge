import { resolvePlatformAiCommand, type Config } from "../config.js";
import { AccessControl } from "../access/access-control.js";
import type { SessionManager } from "../session/session-manager.js";
import { RequestQueue } from "../queue/request-queue.js";
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
import { CommandHandler } from "../commands/handler.js";
import { getAdapter } from "../adapters/registry.js";
import { runAITask, type TaskRunState } from "../shared/ai-task.js";
import { startTaskCleanup } from "../shared/task-cleanup.js";
import { setActiveChatId } from "../shared/active-chats.js";
import { setChatUser } from "../shared/chat-user-map.js";
import { createLogger } from "../logger.js";
import type { ThreadContext } from "../shared/types.js";
import type { QQAttachment, QQMessageEvent } from "./types.js";
import { buildMediaMetadataPrompt } from "../shared/media-prompt.js";
import { buildSavedMediaBatchPrompt, buildSavedMediaPrompt } from "../shared/media-analysis-prompt.js";
import { buildMediaContext } from "../shared/media-context.js";
import { downloadMediaFromUrl } from "../shared/media-storage.js";

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
      } catch {
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
  const accessControl = new AccessControl(config.qqAllowedUserIds);
  const requestQueue = new RequestQueue();
  const runningTasks = new Map<string, TaskRunState>();
  const recentEventIds = new Map<string, number>();
  const recentEventFingerprints = new Map<string, number>();
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
    replyToMessageId?: string,
  ): Promise<"running" | "queued" | "rejected"> {
    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);
    return requestQueue.enqueue(userId, convId, prompt, async (nextPrompt) => {
      await handleAIRequest(userId, chatId, nextPrompt, workDir, convId, undefined, replyToMessageId);
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
  ) {
    const aiCommand = resolvePlatformAiCommand(config, "qq");
    const toolAdapter = getAdapter(aiCommand);
    if (!toolAdapter) {
      await sendTextReply(chatId, `AI tool is not configured: ${aiCommand}`);
      return;
    }

    const sessionId = convId
      ? sessionManager.getSessionIdForConv(userId, convId, aiCommand)
      : undefined;
    const toolId = aiCommand;
    let msgId: string;
    try {
      msgId = await sendThinkingMessage(chatId, replyToMessageId, toolId);
    } catch (err) {
      log.error("Failed to send thinking message:", err);
      try {
        await sendTextReply(chatId, "启动 AI 处理失败，请重试。");
      } catch { /* ignore */ }
      return;
    }
    const stopTyping = startTypingLoop();
    const taskKey = `${userId}:${msgId}`;

    await runAITask(
      { config, sessionManager },
      { userId, chatId, workDir, sessionId, convId, platform: "qq", taskKey },
      prompt,
      toolAdapter,
      {
        throttleMs: QQ_THROTTLE_MS,
        minContentDeltaChars: QQ_MIN_STREAM_DELTA_CHARS,
        streamUpdate: async (content, toolNote) => {
          await updateMessage(chatId, msgId, content, "streaming", toolNote, toolId);
        },
        sendComplete: async (content, note) => {
          await sendFinalMessages(chatId, msgId, content, note ?? "", toolId);
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
    const now = Date.now();
    cleanupRecentEvents(now);

    if (event.id) {
      if (recentEventIds.has(event.id)) {
        log.info(`Skipping duplicate QQ event: ${event.id}`);
        return;
      }
      recentEventIds.set(event.id, now);
    }

    const userId = event.userOpenid;
    const chatId = toChatId(event);
    const eventFingerprint = buildEventFingerprint(event, chatId);
    const text = event.content?.trim() ?? "";
    const attachmentPrompt = await buildAttachmentPrompt(event);

    if (recentEventFingerprints.has(eventFingerprint)) {
      log.info(`Skipping duplicate QQ event fingerprint: ${eventFingerprint}`);
      return;
    }
    recentEventFingerprints.set(eventFingerprint, now);

    if (!accessControl.isAllowed(userId)) {
      await sendTextReply(chatId, `Access denied. Your QQ user ID: ${userId}`);
      return;
    }

    setActiveChatId("qq", chatId);
    setChatUser(chatId, userId, "qq");

    if (text) {
      const handled = await commandHandler.dispatch(text, chatId, userId, "qq", handleAIRequest);
      if (handled) return;
    } else if (!attachmentPrompt) {
      return;
    }

    const enqueueResult = await enqueuePrompt(
      userId,
      chatId,
      attachmentPrompt ?? text,
      event.id,
    );

    if (enqueueResult === "rejected") {
      await sendTextReply(chatId, "Request queue is full. Please try again later.");
    } else if (enqueueResult === "queued") {
      await sendTextReply(chatId, "Your request is queued.");
    }

    log.info(`QQ message handled: user=${userId}, chat=${chatId}, status=${enqueueResult}, attachments=${event.attachments?.length ?? 0}`);
  }

  return {
    stop: () => stopTaskCleanup(),
    getRunningTaskCount: () => runningTasks.size,
    handleEvent,
  };
}
