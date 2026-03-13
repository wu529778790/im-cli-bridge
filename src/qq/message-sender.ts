import { createLogger } from "../logger.js";
import { splitLongContent } from "../shared/utils.js";
import { getQQBot } from "./client.js";

const log = createLogger("QQSender");
const MAX_QQ_MESSAGE_LENGTH = 1500;
const STREAM_CHUNK_LENGTH = 1200;

interface StreamState {
  chatId: string;
  replyToMessageId?: string;
  lastSentLength: number;
  lastToolNote?: string;
  sentStreamChunk: boolean;
}

const streamStates = new Map<string, StreamState>();

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

function getOrCreateStreamState(
  messageId: string,
  chatId: string,
  replyToMessageId?: string,
): StreamState {
  const existing = streamStates.get(messageId);
  if (existing) return existing;

  const state: StreamState = {
    chatId,
    replyToMessageId,
    lastSentLength: 0,
    sentStreamChunk: false,
  };
  streamStates.set(messageId, state);
  return state;
}

function buildStreamChunk(toolId: string, content: string, note?: string, withHeader = false): string {
  const header = withHeader ? `[${toolId}]` : "";
  const noteBlock = note ? `\n\n${note}` : "";
  return `${header}${header ? "\n" : ""}${content}${noteBlock}`.trim();
}

async function sendIncrementalContent(
  state: StreamState,
  messageId: string,
  toolId: string,
  content: string,
  note?: string,
): Promise<void> {
  const delta = content.slice(state.lastSentLength);
  const hasNewNote = !!note && note !== state.lastToolNote;

  if (!delta && !hasNewNote) return;

  if (delta) {
    const parts = splitLongContent(delta, STREAM_CHUNK_LENGTH);
    for (let i = 0; i < parts.length; i++) {
      const text = buildStreamChunk(
        toolId,
        parts[i],
        i === parts.length - 1 && hasNewNote ? note : undefined,
        !state.sentStreamChunk && i === 0,
      );
      await sendRaw(state.chatId, text, state.replyToMessageId);
      state.sentStreamChunk = true;
    }
    state.lastSentLength = content.length;
    if (hasNewNote) state.lastToolNote = note;
    return;
  }

  await sendRaw(state.chatId, `[${toolId}] ${note}`, state.replyToMessageId);
  state.lastToolNote = note;
}

export async function sendTextReply(chatId: string, text: string): Promise<void> {
  try {
    for (const part of splitLongContent(text, MAX_QQ_MESSAGE_LENGTH)) {
      await sendRaw(chatId, part);
    }
  } catch (error) {
    log.error("Failed to send QQ text reply:", error);
  }
}

export async function sendThinkingMessage(chatId: string, _replyToMessageId?: string, toolId = "claude"): Promise<string> {
  const messageId = `${Date.now()}`;
  getOrCreateStreamState(messageId, chatId, _replyToMessageId);
  return messageId;
}

export async function updateMessage(
  chatId: string,
  messageId: string,
  content: string,
  status: "thinking" | "streaming" | "done" | "error",
  note?: string,
  toolId = "claude",
): Promise<void> {
  if (status !== "streaming" && status !== "thinking") return;
  const state = getOrCreateStreamState(messageId, chatId);
  await sendIncrementalContent(state, messageId, toolId, content, note);
}

export async function sendFinalMessages(
  chatId: string,
  messageId: string,
  fullContent: string,
  note: string,
  toolId = "claude",
): Promise<void> {
  const state = getOrCreateStreamState(messageId, chatId);
  await sendIncrementalContent(state, messageId, toolId, fullContent);

  const completionText = note
    ? `[${toolId}] done\n${note}`
    : state.sentStreamChunk
      ? `[${toolId}] done`
      : `[${toolId}]\n${fullContent}`;

  for (const part of splitLongContent(completionText, MAX_QQ_MESSAGE_LENGTH)) {
    await sendRaw(chatId, part, state.replyToMessageId);
  }

  streamStates.delete(messageId);
}

export async function sendErrorMessage(chatId: string, messageId: string, error: string, toolId = "claude"): Promise<void> {
  const replyToMessageId = streamStates.get(messageId)?.replyToMessageId;
  streamStates.delete(messageId);
  await sendRaw(chatId, `[${toolId}] error\n${error}`, replyToMessageId);
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
