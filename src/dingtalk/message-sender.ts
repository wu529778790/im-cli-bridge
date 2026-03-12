import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { sendText, sendProactiveText } from './client.js';
import { createLogger } from '../logger.js';
import { splitLongContent, getAIToolDisplayName } from '../shared/utils.js';
import { listDirectories, buildDirectoryKeyboard } from '../commands/handler.js';
import { MAX_WEWORK_MESSAGE_LENGTH } from '../constants.js';
import type { ThreadContext } from '../shared/types.js';
import type { DingTalkActiveTarget } from '../shared/active-chats.js';

const log = createLogger('DingTalkSender');

export type MessageStatus = 'thinking' | 'streaming' | 'done' | 'error';

const STATUS_ICONS: Record<MessageStatus, string> = {
  thinking: '🔵',
  streaming: '🔄',
  done: '✅',
  error: '❌',
};

function generateMessageId(): string {
  return `${Date.now()}-${randomBytes(6).toString('hex')}`;
}

function formatMessage(
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = 'claude',
): string {
  const icon = STATUS_ICONS[status];
  const toolName = getAIToolDisplayName(toolId);
  const title =
    status === 'thinking'
      ? `${toolName} - 思考中`
      : status === 'streaming'
        ? `${toolName} - 执行中`
        : status === 'error'
          ? `${toolName} - 错误`
          : toolName;

  let text = `${icon} ${title}\n\n${content}`;
  if (note) text += `\n\n─────────\n${note}`;
  return text;
}

async function sendTextWithRetry(chatId: string, text: string, retries = 1): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await sendText(chatId, text);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        log.warn(`DingTalk send failed, retrying (${attempt + 1}/${retries}):`, err);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }
  throw lastError;
}

export async function sendThinkingMessage(
  chatId: string,
  _replyToMessageId?: string,
  toolId = 'claude',
): Promise<string> {
  // 钉钉 sessionWebhook 回复不支持像 Telegram/飞书那样稳定编辑原消息。
  // 为避免 “thinking -> streaming -> final” 连发多条，这里只生成一个本地 messageId，
  // 实际消息延迟到 sendFinalMessages/sendTextReply 阶段再发送。
  void chatId;
  void toolId;
  return generateMessageId();
}

export async function updateMessage(
  chatId: string,
  messageId: string,
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = 'claude',
): Promise<void> {
  // 钉钉第一版不发送中间更新，避免用户看到多条状态消息。
  void chatId;
  void messageId;
  void content;
  void status;
  void note;
  void toolId;
}

export async function sendFinalMessages(
  chatId: string,
  messageId: string,
  fullContent: string,
  note: string,
  toolId = 'claude',
): Promise<void> {
  void messageId;
  const parts = splitLongContent(fullContent, MAX_WEWORK_MESSAGE_LENGTH);
  for (let i = 0; i < parts.length; i++) {
    const partNote =
      parts.length > 1
        ? `${i === parts.length - 1 ? note + '\n' : ''}(续 ${i + 1}/${parts.length})`.trim()
        : note;
    await sendTextWithRetry(chatId, formatMessage(parts[i], 'done', partNote, toolId));
  }
}

export async function sendTextReply(
  chatId: string,
  text: string,
  _threadCtx?: ThreadContext | string,
): Promise<void> {
  await sendTextWithRetry(chatId, text);
  log.info(`Text reply sent to DingTalk chat ${chatId}`);
}

export async function sendProactiveTextReply(
  target: string | DingTalkActiveTarget,
  text: string,
): Promise<void> {
  await sendProactiveText(target, text);
  const targetId = typeof target === 'string' ? target : target.chatId;
  log.info(`Proactive text sent to DingTalk chat ${targetId}`);
}

export async function sendPermissionCard(
  chatId: string,
  requestId: string,
  toolName: string,
  toolInput: string,
): Promise<void> {
  const message = `🔐 权限请求

工具: ${toolName}

参数:
${toolInput.length > 300 ? toolInput.slice(0, 300) + '...' : toolInput}

请回复以下命令进行操作:
/allow - 允许
/deny - 拒绝

请求 ID: ${requestId.slice(-8)}`;
  await sendTextWithRetry(chatId, message);
}

export async function sendModeCard(
  chatId: string,
  _userId: string,
  currentMode: string,
): Promise<void> {
  const { MODE_LABELS } = await import('../permission-mode/types.js');
  const message = `🔐 权限模式

当前模式: ${MODE_LABELS[currentMode as keyof typeof MODE_LABELS] || currentMode}

发送命令切换模式:
/mode ask - 每次询问
/mode accept-edits - 自动批准编辑
/mode plan - 仅分析
/mode yolo - 跳过所有权限`;
  await sendTextWithRetry(chatId, message);
}

export async function sendDirectorySelection(
  chatId: string,
  currentDir: string,
  userId: string,
): Promise<void> {
  const directories = listDirectories(currentDir);
  const dirName = basename(currentDir) || currentDir;
  if (directories.length === 0) {
    await sendTextWithRetry(chatId, `📁 当前目录: ${dirName}\n\n没有可访问的子目录`);
    return;
  }
  const keyboard = buildDirectoryKeyboard(directories, userId);
  const entries = keyboard.inline_keyboard
    .flat()
    .map((item) => item.text)
    .join('\n');
  await sendTextWithRetry(chatId, `📁 当前目录: ${dirName}\n\n可用目录:\n${entries}\n\n请使用 /cd <路径> 切换目录`);
}

export function startTypingLoop(_chatId: string): () => void {
  return () => {};
}
