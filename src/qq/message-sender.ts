import { createLogger } from "../logger.js";
import { splitLongContent } from "../shared/utils.js";
import { getQQBot } from "./client.js";

const log = createLogger("QQSender");

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

async function sendRaw(chatId: string, text: string, replyToMessageId?: string): Promise<void> {
  const bot = getQQBot();
  if (chatId.startsWith("channel:")) {
    await bot.sendChannelMessage(chatId.slice("channel:".length), text, replyToMessageId);
    return;
  }
  const target = parseChatTarget(chatId);
  if (target.kind === "group") {
    await bot.sendGroupMessage(target.id, text, replyToMessageId);
    return;
  }
  await bot.sendPrivateMessage(target.id, text, replyToMessageId);
}

export async function sendTextReply(chatId: string, text: string): Promise<void> {
  try {
    for (const part of splitLongContent(text, 1500)) {
      await sendRaw(chatId, part);
    }
  } catch (error) {
    log.error("Failed to send QQ text reply:", error);
  }
}

export async function sendThinkingMessage(chatId: string, _replyToMessageId?: string, toolId = "claude"): Promise<string> {
  await sendRaw(chatId, `[${toolId}] thinking...`, _replyToMessageId);
  return _replyToMessageId || `${Date.now()}`;
}

export async function updateMessage(
  _chatId: string,
  _messageId: string,
  _content: string,
  _status: "thinking" | "streaming" | "done" | "error",
  _note?: string,
  _toolId = "claude",
): Promise<void> {
  // QQ minimal integration uses final-message delivery first.
}

export async function sendFinalMessages(
  chatId: string,
  _messageId: string,
  fullContent: string,
  note: string,
  toolId = "claude",
): Promise<void> {
  for (const part of splitLongContent(`[${toolId}]\n${fullContent}${note ? `\n\n${note}` : ""}`, 1500)) {
    await sendRaw(chatId, part, _messageId);
  }
}

export async function sendErrorMessage(chatId: string, _messageId: string, error: string, toolId = "claude"): Promise<void> {
  await sendRaw(chatId, `[${toolId}] error\n${error}`, _messageId);
}

export async function sendDirectorySelection(chatId: string, currentDir: string): Promise<void> {
  await sendTextReply(chatId, `Current directory: ${currentDir}\nUse /cd <path> to switch.`);
}

export async function sendModeKeyboard(chatId: string, _userId: string, currentMode: string): Promise<void> {
  await sendTextReply(chatId, `Current mode: ${currentMode}\nUse /mode ask|accept-edits|plan|yolo to switch.`);
}

export function startTypingLoop(): () => void {
  return () => {};
}
