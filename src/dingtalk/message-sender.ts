import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { sendText, sendProactiveText } from './client.js';
import { createLogger } from '../logger.js';
import { splitLongContent, getAIToolDisplayName } from '../shared/utils.js';
import { listDirectories, buildDirectoryKeyboard } from '../commands/handler.js';
import { MAX_WEWORK_MESSAGE_LENGTH } from '../constants.js';
import type { ThreadContext } from '../shared/types.js';

const log = createLogger('DingTalkSender');

export type MessageStatus = 'thinking' | 'streaming' | 'done' | 'error';

const STATUS_ICONS: Record<MessageStatus, string> = {
  thinking: '🔵',
  streaming: '🔄',
  done: '✅',
  error: '❌',
};

const streamingMessages = new Set<string>();

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

export async function sendThinkingMessage(
  chatId: string,
  _replyToMessageId?: string,
  toolId = 'claude',
): Promise<string> {
  const messageId = generateMessageId();
  streamingMessages.add(messageId);
  await sendText(chatId, formatMessage('正在思考，请稍候...', 'thinking', '处理中', toolId));
  return messageId;
}

export async function updateMessage(
  chatId: string,
  messageId: string,
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = 'claude',
): Promise<void> {
  // 钉钉普通机器人回复不支持像 Telegram 那样编辑原消息。
  // 第一版仅在首次进入 streaming 阶段时补一条状态消息，避免高频刷屏。
  if (status !== 'streaming' || !streamingMessages.has(messageId)) return;
  streamingMessages.delete(messageId);
  await sendText(chatId, formatMessage(content || '正在输出...', 'streaming', note, toolId));
}

export async function sendFinalMessages(
  chatId: string,
  messageId: string,
  fullContent: string,
  note: string,
  toolId = 'claude',
): Promise<void> {
  streamingMessages.delete(messageId);
  const parts = splitLongContent(fullContent, MAX_WEWORK_MESSAGE_LENGTH);
  for (let i = 0; i < parts.length; i++) {
    const partNote =
      parts.length > 1
        ? `${i === parts.length - 1 ? note + '\n' : ''}(续 ${i + 1}/${parts.length})`.trim()
        : note;
    await sendText(chatId, formatMessage(parts[i], 'done', partNote, toolId));
  }
}

export async function sendTextReply(
  chatId: string,
  text: string,
  _threadCtx?: ThreadContext | string,
): Promise<void> {
  await sendText(chatId, text);
  log.info(`Text reply sent to DingTalk chat ${chatId}`);
}

export async function sendProactiveTextReply(chatId: string, text: string): Promise<void> {
  await sendProactiveText(chatId, text);
  log.info(`Proactive text sent to DingTalk chat ${chatId}`);
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
  await sendText(chatId, message);
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
  await sendText(chatId, message);
}

export async function sendDirectorySelection(
  chatId: string,
  currentDir: string,
  userId: string,
): Promise<void> {
  const directories = listDirectories(currentDir);
  const dirName = basename(currentDir) || currentDir;
  if (directories.length === 0) {
    await sendText(chatId, `📁 当前目录: ${dirName}\n\n没有可访问的子目录`);
    return;
  }
  const keyboard = buildDirectoryKeyboard(directories, userId);
  const entries = keyboard.inline_keyboard
    .flat()
    .map((item) => item.text)
    .join('\n');
  await sendText(chatId, `📁 当前目录: ${dirName}\n\n可用目录:\n${entries}\n\n请使用 /cd <路径> 切换目录`);
}

export function startTypingLoop(_chatId: string): () => void {
  return () => {};
}
