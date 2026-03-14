import { createLogger } from "../logger.js";
import { splitLongContent } from "../shared/utils.js";
import { buildImageFallbackMessage } from "../channels/capabilities.js";
import { getQQBot } from "./client.js";
import { buildMessageTitle, OPEN_IM_SYSTEM_TITLE } from "../shared/message-title.js";
import { buildTextNote } from "../shared/message-note.js";
import { buildDirectoryMessage, buildModeMessage } from "../shared/system-messages.js";

const log = createLogger("QQSender");
const MAX_QQ_MESSAGE_LENGTH = 1500;
const STREAM_CHUNK_LENGTH = 1200;

interface StreamState {
  chatId: string;
  replyToMessageId?: string;
  lastSentLength: number;
  lastToolNote?: string;
  pendingText: string;
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
    pendingText: "",
  };
  streamStates.set(messageId, state);
  return state;
}

function buildStreamChunk(toolId: string, content: string, note?: string, withHeader = false): string {
  const header = withHeader ? buildMessageTitle(toolId, "streaming") : "";
  const noteBlock = note ? `\n\n${buildTextNote(note)}` : "";
  return `${header}${header ? "\n" : ""}${content}${noteBlock}`.trim();
}

function findPreferredSplit(text: string, limit: number): number {
  const normalizedLimit = Math.min(text.length, limit);
  const boundaries = ["\n\n", "\n", "。", "！", "？", ". ", "! ", "? ", "，", "、", " "];
  const minimumUsefulSplit = Math.min(80, Math.floor(normalizedLimit / 3));

  for (const boundary of boundaries) {
    const index = text.lastIndexOf(boundary, normalizedLimit);
    if (index >= minimumUsefulSplit) {
      return index + boundary.length;
    }
  }

  return text.length >= limit ? normalizedLimit : 0;
}

async function sendIncrementalContent(
  state: StreamState,
  toolId: string,
  content: string,
  note?: string,
  flushAll = false,
): Promise<void> {
  const delta = content.slice(state.lastSentLength);
  const hasNewNote = !!note && note !== state.lastToolNote;

  if (!delta && !hasNewNote) return;

  if (delta) {
    state.pendingText += delta;
    let noteSent = false;

    while (state.pendingText.length > 0) {
      const splitAt = flushAll
        ? Math.min(state.pendingText.length, STREAM_CHUNK_LENGTH)
        : findPreferredSplit(state.pendingText, STREAM_CHUNK_LENGTH);
      // 修复：即使 splitAt <= 0，如果还有 pendingText，也应该继续处理
      // 防止最后一个分块被跳过导致 lastSentLength 没有更新
      if (splitAt <= 0 && state.pendingText.length > 0) {
        // 如果无法找到合适的分割点，但有内容待发送，强制分割
        const part = state.pendingText.trim();
        state.pendingText = "";
        if (part) {
          const text = buildStreamChunk(
            toolId,
            part,
            hasNewNote ? note : undefined,
            !state.sentStreamChunk,
          );
          await sendRaw(state.chatId, text, state.replyToMessageId);
          if (hasNewNote) noteSent = true;
          state.sentStreamChunk = true;
        }
        break;
      }

      if (splitAt <= 0) break;

      const part = state.pendingText.slice(0, splitAt).trim();
      state.pendingText = state.pendingText.slice(splitAt).trimStart();
      if (!part) continue;

      const text = buildStreamChunk(
        toolId,
        part,
        state.pendingText.length === 0 && hasNewNote ? note : undefined,
        !state.sentStreamChunk,
      );
      await sendRaw(state.chatId, text, state.replyToMessageId);
      if (state.pendingText.length === 0 && hasNewNote) noteSent = true;
      state.sentStreamChunk = true;
    }

    state.lastSentLength = content.length;
    if (noteSent) state.lastToolNote = note;
    return;
  }

  await sendRaw(state.chatId, `[${toolId}] ${note}`, state.replyToMessageId);
  state.lastToolNote = note;
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
  await sendIncrementalContent(state, toolId, content, note);
}

export async function sendFinalMessages(
  chatId: string,
  messageId: string,
  fullContent: string,
  note: string,
  toolId = "claude",
): Promise<void> {
  const state = getOrCreateStreamState(messageId, chatId);
  await sendIncrementalContent(state, toolId, fullContent, undefined, true);

  const completionText = note
    ? `${buildMessageTitle(toolId, "done")}\n${note}`
    : state.sentStreamChunk
      ? buildMessageTitle(toolId, "done")
      : `${buildMessageTitle(toolId, "done")}\n${fullContent}`;

  for (const part of splitLongContent(completionText, MAX_QQ_MESSAGE_LENGTH)) {
    await sendRaw(chatId, part, state.replyToMessageId);
  }

  streamStates.delete(messageId);
}

export async function sendErrorMessage(chatId: string, messageId: string, error: string, toolId = "claude"): Promise<void> {
  const replyToMessageId = streamStates.get(messageId)?.replyToMessageId;
  streamStates.delete(messageId);
  await sendRaw(chatId, `${buildMessageTitle(toolId, "error")}\n${error}`, replyToMessageId);
}

export async function sendDirectorySelection(chatId: string, currentDir: string): Promise<void> {
  await sendTextReply(chatId, buildDirectoryMessage(currentDir));
}

export async function sendModeKeyboard(chatId: string, _userId: string, currentMode: string): Promise<void> {
  const { MODE_LABELS } = await import("../permission-mode/types.js");
  const label = MODE_LABELS[currentMode as keyof typeof MODE_LABELS] || currentMode;
  await sendTextReply(chatId, buildModeMessage(label));
}

export function startTypingLoop(): () => void {
  return () => {};
}
