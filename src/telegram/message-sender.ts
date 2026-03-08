import { getBot } from './client.js';
import { createReadStream } from 'node:fs';
import { createLogger } from '../logger.js';
import { splitLongContent, truncateText } from '../shared/utils.js';
import { MAX_TELEGRAM_MESSAGE_LENGTH } from '../constants.js';

const log = createLogger('TgSender');

export type MessageStatus = 'thinking' | 'streaming' | 'done' | 'error';

const STATUS_ICONS: Record<MessageStatus, string> = {
  thinking: '🔵',
  streaming: '🔵',
  done: '🟢',
  error: '🔴',
};

const STATUS_TITLES: Record<MessageStatus, string> = {
  thinking: 'AI - 思考中...',
  streaming: 'AI',
  done: 'AI',
  error: 'AI - 错误',
};

function formatMessage(content: string, status: MessageStatus, note?: string): string {
  const icon = STATUS_ICONS[status];
  const title = STATUS_TITLES[status];
  const text = truncateText(content, MAX_TELEGRAM_MESSAGE_LENGTH);
  let out = `${icon} ${title}\n\n${text}`;
  if (note) out += `\n\n─────────\n${note}`;
  return out;
}

function buildStopKeyboard(messageId: number) {
  return {
    inline_keyboard: [[{ text: '⏹️ 停止', callback_data: `stop_${messageId}` }]],
  };
}

export async function sendThinkingMessage(chatId: string, replyToMessageId?: string): Promise<string> {
  const bot = getBot();
  const extra: Record<string, unknown> = {};
  if (replyToMessageId) {
    (extra as { reply_parameters?: { message_id: number } }).reply_parameters = {
      message_id: Number(replyToMessageId),
    };
  }
  const msg = await bot.telegram.sendMessage(
    Number(chatId),
    formatMessage('正在思考...', 'thinking', '请稍候'),
    extra
  );
  await bot.telegram.editMessageText(
    Number(chatId),
    msg.message_id,
    undefined,
    formatMessage('正在思考...', 'thinking', '请稍候'),
    { reply_markup: buildStopKeyboard(msg.message_id) }
  );
  return String(msg.message_id);
}

export async function updateMessage(
  chatId: string,
  messageId: string,
  content: string,
  status: MessageStatus,
  note?: string
): Promise<void> {
  const bot = getBot();
  const opts: Record<string, unknown> = {};
  if (status === 'thinking' || status === 'streaming') {
    opts.reply_markup = buildStopKeyboard(Number(messageId));
  }
  try {
    await bot.telegram.editMessageText(
      Number(chatId),
      Number(messageId),
      undefined,
      formatMessage(content, status, note),
      opts
    );
  } catch (err) {
    if (err && typeof err === 'object' && 'message' in err && String((err as { message: string }).message).includes('not modified')) {
      /* ignore */
    } else {
      log.error('Failed to update message:', err);
    }
  }
}

export async function sendFinalMessages(
  chatId: string,
  messageId: string,
  fullContent: string,
  note: string
): Promise<void> {
  const parts = splitLongContent(fullContent, MAX_TELEGRAM_MESSAGE_LENGTH);
  await updateMessage(chatId, messageId, parts[0], 'done', note);
  const bot = getBot();
  for (let i = 1; i < parts.length; i++) {
    try {
      await bot.telegram.sendMessage(
        Number(chatId),
        formatMessage(parts[i], 'done', `(续 ${i + 1}/${parts.length}) ${note}`)
      );
    } catch (err) {
      log.error('Failed to send continuation:', err);
    }
  }
}

export async function sendTextReply(chatId: string, text: string): Promise<void> {
  const bot = getBot();
  try {
    await bot.telegram.sendMessage(Number(chatId), text);
  } catch (err) {
    log.error('Failed to send text:', err);
  }
}

export async function sendImageReply(chatId: string, imagePath: string): Promise<void> {
  const bot = getBot();
  await bot.telegram.sendPhoto(Number(chatId), { source: createReadStream(imagePath) });
}

export function startTypingLoop(chatId: string): () => void {
  const bot = getBot();
  const interval = setInterval(() => {
    bot.telegram.sendChatAction(Number(chatId), 'typing').catch(() => {});
  }, 4000);
  return () => clearInterval(interval);
}
