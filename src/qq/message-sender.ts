import { createLogger } from "../logger.js";
import { splitLongContent } from "../shared/utils.js";
import { buildImageFallbackMessage } from "../channels/capabilities.js";
import { getQQBot } from "./client.js";
import { buildMessageTitle, OPEN_IM_SYSTEM_TITLE } from "../shared/message-title.js";
import { buildDirectoryMessage } from "../shared/system-messages.js";

const log = createLogger("QQSender");
const MAX_QQ_MESSAGE_LENGTH = 1500;

interface PendingReplyState {
  replyToMessageId?: string;
}

const pendingReplies = new Map<string, PendingReplyState>();

// Periodic cleanup of orphaned pending replies
const PENDING_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, state] of pendingReplies) {
    // pendingReplies don't have timestamps, but we can clear old ones based on size
    if (pendingReplies.size > 100) {
      pendingReplies.delete(id);
    }
  }
}, PENDING_MAX_AGE_MS).unref();

function parseChatTarget(chatId: string): { kind: "group" | "private"; id: string } {
  if (chatId.startsWith("group:")) {
    return { kind: "group", id: chatId.slice("group:".length) };
  }
  if (chatId.startsWith("channel:")) {
    return { kind: "private", id: chatId.slice("channel:".length) };
  }
  if (chatId.startsWith("private:")) {
    return { kind: "private", id: chatId.slice("private:".length) };
  }
  return { kind: "private", id: chatId };
}

async function sendRaw(chatId: string, text: string, replyToMessageId?: string): Promise<string | undefined> {
  const bot = getQQBot();
  if (chatId.startsWith("channel:")) {
    return bot.sendChannelMessage(chatId.slice("channel:".length), text, replyToMessageId);
  }
  const target = parseChatTarget(chatId);
  if (target.kind === "group") {
    return bot.sendGroupMessage(target.id, text, replyToMessageId);
  }
  return bot.sendPrivateMessage(target.id, text, replyToMessageId);
}

export async function sendTextReply(chatId: string, text: string): Promise<void> {
  try {
    const formatted = `${buildMessageTitle(OPEN_IM_SYSTEM_TITLE, "done")}\n\n${text}`;
    for (const part of splitLongContent(formatted, MAX_QQ_MESSAGE_LENGTH)) {
      await sendRaw(chatId, part);
    }
  } catch (error) {
    log.error("Failed to send QQ text reply:", error);
  }
}

export async function sendImageReply(chatId: string, imagePath: string): Promise<void> {
  await sendTextReply(chatId, buildImageFallbackMessage("qq", imagePath));
}

export async function sendThinkingMessage(chatId: string, replyToMessageId?: string, _toolId = "claude"): Promise<string> {
  const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  pendingReplies.set(messageId, { replyToMessageId });
  return messageId;
}

export async function updateMessage(
  _chatId: string,
  _messageId: string,
  _content: string,
  _status: "thinking" | "streaming" | "done" | "error",
  _note?: string,
  _toolId = "claude",
): Promise<void> {
  // QQ 官方机器人接口不支持单条消息流式更新，这里显式忽略中间增量，只发送最终结果。
}

export async function sendFinalMessages(
  chatId: string,
  messageId: string,
  fullContent: string,
  _note: string,
  toolId = "claude",
): Promise<void> {
  const replyToMessageId = pendingReplies.get(messageId)?.replyToMessageId;
  pendingReplies.delete(messageId);

  const completionText = `${buildMessageTitle(toolId, "done")}\n${fullContent}`;
  for (const part of splitLongContent(completionText, MAX_QQ_MESSAGE_LENGTH)) {
    await sendRaw(chatId, part, replyToMessageId);
  }
}

export async function sendErrorMessage(chatId: string, messageId: string, error: string, toolId = "claude"): Promise<void> {
  const replyToMessageId = pendingReplies.get(messageId)?.replyToMessageId;
  pendingReplies.delete(messageId);
  await sendRaw(chatId, `${buildMessageTitle(toolId, "error")}\n${error}`, replyToMessageId);
}

export async function sendDirectorySelection(chatId: string, currentDir: string): Promise<void> {
  await sendTextReply(chatId, buildDirectoryMessage(currentDir));
}


export function startTypingLoop(): () => void {
  return () => {};
}
