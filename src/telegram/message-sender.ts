import { getBot } from './client.js';
import { createReadStream, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { createLogger } from '../logger.js';
import { splitLongContent, truncateText, preprocessMarkdownForTelegram } from '../shared/utils.js';
import { MAX_TELEGRAM_MESSAGE_LENGTH } from '../constants.js';
import { listDirectories, buildDirectoryKeyboard } from '../commands/handler.js';

const log = createLogger('TgSender');

export type MessageStatus = 'thinking' | 'streaming' | 'done' | 'error';

const STATUS_ICONS: Record<MessageStatus, string> = {
  thinking: '🔵',
  streaming: '🔵',
  done: '🟢',
  error: '🔴',
};

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  claude: 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
};

function getToolTitle(toolId: string, status: MessageStatus): string {
  const name = TOOL_DISPLAY_NAMES[toolId] ?? toolId;
  if (status === 'thinking') return `${name} - 思考中...`;
  if (status === 'error') return `${name} - 错误`;
  return name;
}

// Telegram 实际消息长度限制（4096 字符）
const TG_MAX_LENGTH = 4096;
// 预留给 header 和 note 的空间
const RESERVED_LENGTH = 150;

function formatMessage(content: string, status: MessageStatus, note?: string, toolId = 'claude'): string {
  const icon = STATUS_ICONS[status];
  const title = getToolTitle(toolId, status);

  // 在应用 Markdown 格式时，预处理内容以兼容 Telegram
  let processedContent = content;
  if (status === 'done' || status === 'error') {
    processedContent = preprocessMarkdownForTelegram(content);
  }

  // 计算可用内容长度（预留 header 和 note 空间）
  const headerLength = `${icon} ${title}\n\n`.length;
  const noteLength = note ? `\n\n─────────\n${note}`.length : 0;
  const maxContentLength = TG_MAX_LENGTH - headerLength - noteLength - RESERVED_LENGTH;

  // 确保内容长度不超过限制
  const text = truncateText(processedContent, Math.max(100, maxContentLength));
  let out = `${icon} ${title}\n\n${text}`;
  if (note) out += `\n\n─────────\n${note}`;

  // 最终安全检查：如果还是太长，强制截断
  if (out.length > TG_MAX_LENGTH) {
    const keepLen = TG_MAX_LENGTH - 50;
    const tail = text.slice(text.length - keepLen);
    const lineBreak = tail.indexOf('\n');
    const clean = lineBreak > 0 && lineBreak < 200 ? tail.slice(lineBreak + 1) : tail;
    out = `${icon} ${title}\n\n...(前文已省略)...\n${clean}`;
    if (note) out += `\n\n─────────\n${note}`;
  }

  return out;
}

function buildStopKeyboard(messageId: number) {
  return {
    inline_keyboard: [[{ text: '⏹️ 停止', callback_data: `stop_${messageId}` }]],
  };
}

export async function sendThinkingMessage(
  chatId: string,
  replyToMessageId?: string,
  toolId = 'claude'
): Promise<string> {
  const bot = getBot();
  const extra: Record<string, unknown> = {};
  if (replyToMessageId) {
    (extra as { reply_parameters?: { message_id: number } }).reply_parameters = {
      message_id: Number(replyToMessageId),
    };
  }
  // 初始消息使用纯文本，避免 Markdown 解析问题
  const msg = await bot.telegram.sendMessage(
    Number(chatId),
    formatMessage('正在思考...', 'thinking', '请稍候', toolId),
    extra
  );
  await bot.telegram.editMessageText(
    Number(chatId),
    msg.message_id,
    undefined,
    formatMessage('正在思考...', 'thinking', '请稍候', toolId),
    { reply_markup: buildStopKeyboard(msg.message_id) }
  );
  return String(msg.message_id);
}

// 检查错误是否可忽略（只忽略真正无害的错误）
function isIgnorableError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message: string }).message);
    // 只忽略 "not modified" 类错误（内容没有变化）
    return msg.includes('not modified') || msg.includes('message is not modified');
  }
  return false;
}

// 提取重试延迟时间（秒）
function extractRetryAfter(err: unknown): number | null {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message: string }).message);
    const match = msg.match(/retry after (\d+)/);
    if (match) return parseInt(match[1], 10);
  }
  if (err && typeof err === 'object' && 'parameters' in err) {
    const params = (err as { parameters: { retry_after?: number } }).parameters;
    if (params?.retry_after) return params.retry_after;
  }
  return null;
}

export async function updateMessage(
  chatId: string,
  messageId: string,
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = 'claude'
): Promise<void> {
  const bot = getBot();
  const opts: Record<string, unknown> = {};
  if (status === 'thinking' || status === 'streaming') {
    opts.reply_markup = buildStopKeyboard(Number(messageId));
  } else if (status === 'done' || status === 'error') {
    // 完成或错误时，显式移除停止按钮（使用空的 inline_keyboard）
    opts.reply_markup = { inline_keyboard: [] };
    // 添加日志，帮助诊断
    log.info(`Updating message to ${status} status (removing stop button) for ${chatId}:${messageId}, content length: ${content.length}`);
  }

  // 流式输出时使用纯文本，避免 Markdown 解析导致内容减少
  // 完成时也暂时使用纯文本，避免 Markdown 解析错误
  // TODO: 等待 Markdown 预处理稳定后再启用 Markdown
  const shouldParseMarkdown = false; // 暂时禁用 Markdown 解析

  let retries = 0;
  const maxRetries = 2; // 减少重试次数，但增加等待时间

  while (retries <= maxRetries) {
    try {
      await bot.telegram.editMessageText(
        Number(chatId),
        Number(messageId),
        undefined,
        formatMessage(content, status, note, toolId),
        { ...opts, parse_mode: shouldParseMarkdown ? 'Markdown' : undefined }
      );
      return;
    } catch (err) {
      if (isIgnorableError(err)) {
        // 忽略这些错误，不需要重试
        return;
      }

      const retryAfter = extractRetryAfter(err);
      if (retryAfter !== null && retries < maxRetries) {
        // 429 错误，使用 Telegram 返回的实际等待时间
        // 添加额外的缓冲时间（10%），确保不会立即再次触发限制
        const delayMs = Math.ceil(retryAfter * 1000 * 1.1);
        log.warn(`Rate limited, waiting ${delayMs}ms (${retryAfter}s + 10% buffer) before retry (${retries + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        retries++;
        continue;
      }

      // 对于非 429 错误，使用指数退避
      if (retries < maxRetries) {
        const delayMs = Math.pow(2, retries) * 1000; // 1s, 2s, 4s
        log.warn(`Temporary error, waiting ${delayMs}ms before retry (${retries + 1}/${maxRetries}):`, err);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        retries++;
        continue;
      }

      if (retries >= maxRetries) {
        log.error('Failed to update message after retries:', err);
      } else {
        log.error('Failed to update message:', err);
      }
      return;
    }
  }
}

export async function sendFinalMessages(
  chatId: string,
  messageId: string,
  fullContent: string,
  note: string,
  toolId = 'claude'
): Promise<void> {
  const parts = splitLongContent(fullContent, MAX_TELEGRAM_MESSAGE_LENGTH);
  await updateMessage(chatId, messageId, parts[0], 'done', note, toolId);
  const bot = getBot();
  for (let i = 1; i < parts.length; i++) {
    try {
      await bot.telegram.sendMessage(
        Number(chatId),
        formatMessage(parts[i], 'done', `(续 ${i + 1}/${parts.length}) ${note}`, toolId),
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      log.error('Failed to send continuation:', err);
    }
  }
}

export async function sendTextReply(chatId: string, text: string): Promise<void> {
  const bot = getBot();
  try {
    await bot.telegram.sendMessage(Number(chatId), text, { parse_mode: 'Markdown' });
  } catch (err) {
    log.error('Failed to send text:', err);
  }
}

export async function sendImageReply(chatId: string, imagePath: string): Promise<void> {
  const bot = getBot();
  await bot.telegram.sendPhoto(Number(chatId), { source: createReadStream(imagePath) });
}

/**
 * 发送目录选择界面
 */
export async function sendDirectorySelection(
  chatId: string,
  currentDir: string,
  userId: string
): Promise<void> {
  const bot = getBot();
  const directories = listDirectories(currentDir);

  if (directories.length === 0) {
    await bot.telegram.sendMessage(
      Number(chatId),
      `📁 当前目录: \`${currentDir}\`\n\n没有可访问的子目录`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const keyboard = buildDirectoryKeyboard(directories, userId);
  const dirName = basename(currentDir) || currentDir;

  await bot.telegram.sendMessage(
    Number(chatId),
    `📁 当前目录: \`${dirName}\`\n\n选择要切换到的目录：`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

export function startTypingLoop(chatId: string): () => void {
  const bot = getBot();
  const interval = setInterval(() => {
    bot.telegram.sendChatAction(Number(chatId), 'typing').catch(() => {});
  }, 4000);
  return () => clearInterval(interval);
}
