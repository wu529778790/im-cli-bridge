import type { Config } from "../config.js";
import { AccessControl } from "../access/access-control.js";
import type { SessionManager } from "../session/session-manager.js";
import { RequestQueue } from "../queue/request-queue.js";
import {
  sendThinkingMessage,
  updateMessage,
  sendFinalMessages,
  sendErrorMessage,
  sendTextReply,
  sendModeKeyboard,
  sendDirectorySelection,
  startTypingLoop,
} from "./message-sender.js";
import { registerPermissionSender } from "../hook/permission-server.js";
import { CommandHandler } from "../commands/handler.js";
import { getAdapter } from "../adapters/registry.js";
import { runAITask, type TaskRunState } from "../shared/ai-task.js";
import { startTaskCleanup } from "../shared/task-cleanup.js";
import { setActiveChatId } from "../shared/active-chats.js";
import { setChatUser } from "../shared/chat-user-map.js";
import { createLogger } from "../logger.js";
import type { ThreadContext } from "../shared/types.js";
import type { QQAttachment, QQMessageEvent } from "./types.js";
import { buildImageFallbackMessage } from "../channels/capabilities.js";
import { buildMediaMetadataPrompt } from "../shared/media-prompt.js";
import { buildSavedMediaPrompt } from "../shared/media-analysis-prompt.js";
import { downloadMediaFromUrl } from "../shared/media-storage.js";

const log = createLogger("QQHandler");
const QQ_THROTTLE_MS = 1200;
const QQ_MIN_STREAM_DELTA_CHARS = 80;

function toChatId(event: QQMessageEvent): string {
  if (event.type === "group") {
    return `group:${event.groupOpenid}`;
  }
  if (event.type === "channel") {
    return `channel:${event.channelId}`;
  }
  return `private:${event.userOpenid}`;
}

function classifyAttachment(attachment: QQAttachment): "image" | "file" {
  if (attachment.contentType?.startsWith("image/")) return "image";
  const filename = attachment.filename?.toLowerCase() ?? "";
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(filename)) return "image";
  return "file";
}

function buildQQAttachmentContext(
  text: string,
  attachment: {
    filename?: string;
    contentType?: string;
    size?: number;
    width?: number;
    height?: number;
  },
): string | undefined {
  const lines: string[] = [];
  if (text) {
    lines.push(text);
  }
  if (attachment.filename) {
    lines.push(`Filename: ${attachment.filename}`);
  }
  if (attachment.contentType) {
    lines.push(`MimeType: ${attachment.contentType}`);
  }
  if (attachment.size !== undefined) {
    lines.push(`Size: ${attachment.size}`);
  }
  if (attachment.width !== undefined) {
    lines.push(`Width: ${attachment.width}`);
  }
  if (attachment.height !== undefined) {
    lines.push(`Height: ${attachment.height}`);
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
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
          fallbackExtension: kind === "image" ? "jpg" : "bin",
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
      text: buildQQAttachmentContext(event.content, attachmentSummary[0]),
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
  const stopTaskCleanup = startTaskCleanup(runningTasks);

  const commandHandler = new CommandHandler({
    config,
    sessionManager,
    requestQueue,
    sender: { sendTextReply, sendModeKeyboard, sendDirectorySelection },
    getRunningTasksSize: () => runningTasks.size,
  });

  registerPermissionSender("qq", { sendTextReply });

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
    const toolAdapter = getAdapter(config.aiCommand);
    if (!toolAdapter) {
      await sendTextReply(chatId, `AI tool is not configured: ${config.aiCommand}`);
      return;
    }

    const sessionId = convId
      ? sessionManager.getSessionIdForConv(userId, convId, config.aiCommand)
      : undefined;
    const toolId = config.aiCommand;
    const msgId = await sendThinkingMessage(chatId, replyToMessageId, toolId);
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
          await sendTextReply(chatId, buildImageFallbackMessage("qq", path));
        },
      },
    );
  }

  async function handleEvent(event: QQMessageEvent): Promise<void> {
    const userId = event.userOpenid;
    const chatId = toChatId(event);
    const text = event.content?.trim() ?? "";
    const attachmentPrompt = await buildAttachmentPrompt(event);

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
