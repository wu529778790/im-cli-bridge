import { getBot } from "./client.js";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { createLogger } from "../logger.js";
import {
  splitLongContent,
  truncateText,
} from "../shared/utils.js";
import { buildMessageTitle, OPEN_IM_SYSTEM_TITLE } from "../shared/message-title.js";
import { buildTextNote } from "../shared/message-note.js";
import { MAX_TELEGRAM_MESSAGE_LENGTH } from "../constants.js";
import {
  listDirectories,
  buildDirectoryKeyboard,
} from "../commands/handler.js";

const log = createLogger("TgSender");
const lastSentByMsg = new Map<string, string>();

export type MessageStatus = "thinking" | "streaming" | "done" | "error";

const STATUS_ICONS: Record<MessageStatus, string> = {
  thinking: "🔵",
  streaming: "🔵",
  done: "🟢",
  error: "🔴",
};

function getToolTitle(toolId: string, status: MessageStatus): string {
  return buildMessageTitle(toolId, status);
}

const TG_MAX_LENGTH = 4096;
const RESERVED_LENGTH = 150;

function formatMessage(
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = "claude",
): string {
  const icon = STATUS_ICONS[status];
  const title = getToolTitle(toolId, status);
  const headerLength = `${icon} ${title}\n\n`.length;
  const noteBlock = note ? `\n\n${buildTextNote(note)}` : "";
  const noteLength = noteBlock.length;
  const maxContentLength =
    TG_MAX_LENGTH - headerLength - noteLength - RESERVED_LENGTH;

  const text = truncateText(content, Math.max(100, maxContentLength));
  let out = `${icon} ${title}\n\n${text}`;
  out += noteBlock;

  if (out.length > TG_MAX_LENGTH) {
    const keepLen = TG_MAX_LENGTH - 50;
    const tail = text.slice(text.length - keepLen);
    const lineBreak = tail.indexOf("\n");
    const clean =
      lineBreak > 0 && lineBreak < 200 ? tail.slice(lineBreak + 1) : tail;
    out = `${icon} ${title}\n\n...(前文已省略)...\n${clean}`;
    out += noteBlock;
  }

  return out;
}

function buildStopKeyboard(messageId: number) {
  return {
    inline_keyboard: [
      [{ text: "⏹️ 停止", callback_data: `stop_${messageId}` }],
    ],
  };
}

export async function sendThinkingMessage(
  chatId: string,
  replyToMessageId?: string,
  toolId = "claude",
): Promise<string> {
  const bot = getBot();
  const extra: Record<string, unknown> = {};
  if (replyToMessageId) {
    (extra as { reply_parameters?: { message_id: number } }).reply_parameters =
      {
        message_id: Number(replyToMessageId),
      };
  }
  const text = formatMessage("正在思考...", "thinking", "请稍候", toolId);
  const msg = await bot.telegram.sendMessage(Number(chatId), text, {
    ...extra,
  });
  await bot.telegram.editMessageReplyMarkup(
    Number(chatId),
    msg.message_id,
    undefined,
    buildStopKeyboard(msg.message_id),
  );
  return String(msg.message_id);
}

export async function updateMessage(
  chatId: string,
  messageId: string,
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = "claude",
): Promise<void> {
  const formatted = formatMessage(content, status, note, toolId);
  if (lastSentByMsg.get(messageId) === formatted) return;
  lastSentByMsg.set(messageId, formatted);

  const bot = getBot();
  const opts: Record<string, unknown> = {};
  if (status === "thinking" || status === "streaming") {
    opts.reply_markup = buildStopKeyboard(Number(messageId));
  }
  try {
    await bot.telegram.editMessageText(
      Number(chatId),
      Number(messageId),
      undefined,
      formatted,
      opts,
    );
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "message" in err &&
      String((err as { message: string }).message).includes("not modified")
    ) {
      /* ignore */
    } else {
      log.error("Failed to update message:", err);
      // 对 done/error 状态的更新失败必须 throw，否则消息永远卡在 streaming
      if (status === "done" || status === "error") {
        throw err;
      }
    }
  }
  if (status === "done" || status === "error") {
    lastSentByMsg.delete(messageId);
  }
}

export async function sendFinalMessages(
  chatId: string,
  messageId: string,
  fullContent: string,
  note: string,
  toolId = "claude",
): Promise<void> {
  const parts = splitLongContent(fullContent, MAX_TELEGRAM_MESSAGE_LENGTH);
  await updateMessage(chatId, messageId, parts[0], "done", note, toolId);
  const bot = getBot();
  for (let i = 1; i < parts.length; i++) {
    try {
      await bot.telegram.sendMessage(
        Number(chatId),
        formatMessage(
          parts[i],
          "done",
          `(续 ${i + 1}/${parts.length}) ${note}`,
          toolId,
        ),
      );
    } catch (err) {
      log.error("Failed to send continuation:", err);
    }
  }
}

export async function sendTextReply(
  chatId: string,
  text: string,
): Promise<void> {
  const bot = getBot();
  try {
    await bot.telegram.sendMessage(Number(chatId), formatMessage(text, "done", undefined, OPEN_IM_SYSTEM_TITLE), {
      parse_mode: "Markdown",
    });
  } catch (err) {
    log.error("Failed to send text:", err);
  }
}

export async function sendImageReply(
  chatId: string,
  imagePath: string,
): Promise<void> {
  const bot = getBot();
  await bot.telegram.sendPhoto(Number(chatId), {
    source: createReadStream(imagePath),
  });
}

export async function sendDirectorySelection(
  chatId: string,
  currentDir: string,
  userId: string,
): Promise<void> {
  const bot = getBot();
  const directories = listDirectories(currentDir);

  if (directories.length === 0) {
    await bot.telegram.sendMessage(
      Number(chatId),
      `📁 当前目录: \`${currentDir}\`\n\n没有可访问的子目录。\n\n可发送 \`/cd <路径>\` 切换目录。`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  const keyboard = buildDirectoryKeyboard(directories, userId);
  const dirName = basename(currentDir) || currentDir;

  await bot.telegram.sendMessage(
    Number(chatId),
    `📁 当前目录: \`${dirName}\`\n\n请选择要切换到的目录：`,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    },
  );
}


export function startTypingLoop(chatId: string): () => void {
  const bot = getBot();
  const interval = setInterval(() => {
    bot.telegram.sendChatAction(Number(chatId), "typing").catch((err) => {
      log.warn(`[telegram] Failed to send typing action to ${chatId}:`, err);
    });
  }, 4000);
  return () => clearInterval(interval);
}
