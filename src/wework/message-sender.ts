/**
 * WeWork (企业微信) Message Sender - Send messages to WeWork
 * 通过 WebSocket aibot_respond_msg 发送，需透传 req_id
 */

import { sendText, sendStream, sendMessage } from './client.js';
import { createLogger } from '../logger.js';
import { splitLongContent } from '../shared/utils.js';
import { MAX_WEWORK_MESSAGE_LENGTH } from '../constants.js';
import { randomBytes } from 'node:crypto';

const log = createLogger('WeWorkSender');

/** 当前同步处理中的 req_id（仅用于 commandHandler 等同步调用） */
let currentReqId: string | null = null;

export function setCurrentReqId(reqId: string | null): void {
  currentReqId = reqId;
}

function getReqId(explicitReqId?: string): string {
  const id = explicitReqId ?? currentReqId;
  if (!id) {
    log.warn('No req_id - cannot send WeWork reply');
    return '';
  }
  return id;
}

type MessageStatus = 'thinking' | 'streaming' | 'done' | 'error';

const STATUS_CONFIG: Record<MessageStatus, { icon: string; title: string }> = {
  thinking: { icon: '🔵', title: '思考中' },
  streaming: { icon: '🔄', title: '执行中' },
  done: { icon: '✅', title: '完成' },
  error: { icon: '❌', title: '错误' },
};

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
};

function getToolTitle(toolId: string, status: MessageStatus): string {
  const name = TOOL_DISPLAY_NAMES[toolId] ?? toolId;
  const statusText = STATUS_CONFIG[status].title;
  return status === 'done' ? name : `${name} - ${statusText}`;
}

/**
 * Generate unique request ID
 */
function generateReqId(): string {
  return `${Date.now()}-${randomBytes(8).toString('hex')}`;
}

/**
 * Generate unique stream ID for WeWork streaming responses
 */
function generateStreamId(): string {
  return `${Date.now()}-${randomBytes(8).toString('hex')}`;
}

/**
 * Format message for WeWork (markdown-like format)
 */
function formatWeWorkMessage(
  title: string,
  content: string,
  status: MessageStatus,
  note?: string
): string {
  const statusConfig = STATUS_CONFIG[status];
  let message = `${statusConfig.icon} **${title}**\n\n`;

  if (content) {
    message += `${content}\n\n`;
  } else if (status === 'thinking') {
    message += `_正在思考，请稍候..._\n\n💭 **准备中**\n\n`;
  }

  if (note) {
    message += `---\n\n💡 **${note}**`;
  }

  return message;
}

/**
 * Local tracking for stream states
 * WeWork doesn't support message editing, so we track stream IDs locally
 */
const streamStates = new Map<string, { content: string; chatId: string }>();

/**
 * Send thinking message to WeWork
 * Returns a stream ID that can be used for updates
 * @param reqId - 消息回调的 req_id，用于 WebSocket 回复
 */
export async function sendThinkingMessage(
  chatId: string,
  _replyToMessageId: string | undefined,
  toolId = 'claude',
  reqId?: string
): Promise<string> {
  const streamId = generateStreamId();
  const title = getToolTitle(toolId, 'thinking');
  const content = formatWeWorkMessage(title, '', 'thinking');

  try {
    log.info(`Sending thinking message to user ${chatId}, streamId=${streamId}`);

    // Store initial stream state
    streamStates.set(streamId, { content: '', chatId });

    // Send initial stream message (not finished)
    sendStream(getReqId(reqId), streamId, content, false);

    log.info(`Thinking message sent: ${streamId}`);
    return streamId;
  } catch (err) {
    log.error('Failed to send thinking message:', err);
    throw err;
  }
}

/**
 * Update existing message in WeWork
 * Note: WeWork doesn't support message editing, so we send new stream messages
 */
export async function updateMessage(
  chatId: string,
  streamId: string,
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = 'claude',
  reqId?: string
): Promise<void> {
  const title = getToolTitle(toolId, status);
  const message = formatWeWorkMessage(title, content, status, note);

  try {
    // Update stream state
    streamStates.set(streamId, { content, chatId });

    // Send stream update (not finished yet)
    sendStream(getReqId(reqId), streamId, message, false);

    log.info(`Message updated: ${status}, streamId=${streamId}`);
  } catch (err) {
    log.error('Failed to update message:', err);
    throw err;
  }
}

/**
 * Send final messages to WeWork (handle long content)
 */
export async function sendFinalMessages(
  chatId: string,
  streamId: string,
  fullContent: string,
  note: string,
  toolId = 'claude',
  reqId?: string
): Promise<void> {
  const title = getToolTitle(toolId, 'done');
  const parts = splitLongContent(fullContent, MAX_WEWORK_MESSAGE_LENGTH);

  // Send final stream message to finish the stream
  const finalMessage = formatWeWorkMessage(title, parts[0], 'done', parts.length > 1 ? `内容较长，已分段发送 (1/${parts.length})` : note);

  try {
    sendStream(getReqId(reqId), streamId, finalMessage, true);
    log.info(`Final stream message sent, streamId=${streamId}`);

    // Clean up stream state
    streamStates.delete(streamId);

    // Send remaining parts as separate messages
    for (let i = 1; i < parts.length; i++) {
      try {
        const partContent = `${parts[i]}\n\n_*(续 ${i + 1}/${parts.length})*_`;
        const partMessage = formatWeWorkMessage(title, partContent, 'done', i === parts.length - 1 ? note : undefined);

        sendText(getReqId(reqId), partMessage);
        log.info(`Final message part ${i + 1}/${parts.length} sent`);
      } catch (err) {
        log.error(`Failed to send part ${i + 1}:`, err);
      }
    }
  } catch (err) {
    log.error('Failed to send final messages:', err);
  }
}

/**
 * Send simple text reply to WeWork
 * @param threadCtxOrReqId - 兼容 MessageSender 的 threadCtx；若为 string 则作为 reqId 使用
 */
export async function sendTextReply(
  chatId: string,
  text: string,
  threadCtxOrReqId?: import('../shared/types.js').ThreadContext | string
): Promise<void> {
  const message = formatWeWorkMessage('📢 open-im', text, 'done');
  const reqId = typeof threadCtxOrReqId === 'string' ? threadCtxOrReqId : undefined;

  try {
    sendText(getReqId(reqId), message);
    log.info(`Text reply sent to user ${chatId}`);
  } catch (err) {
    log.error('Failed to send text reply:', err);
  }
}

/**
 * Send permission card with action buttons (for permission prompts)
 * Note: WeWork doesn't support interactive cards, so we send text with instructions
 */
export async function sendPermissionCard(
  chatId: string,
  requestId: string,
  toolName: string,
  toolInput: string,
  reqId?: string
): Promise<void> {
  const message = `🔐 **权限请求**

**工具:** \`${toolName}\`

**参数:**
\`\`\`
${toolInput.length > 300 ? toolInput.slice(0, 300) + '...' : toolInput}
\`\`\`

请回复以下命令进行操作:
• \`/allow\` - 允许
• \`/deny\` - 拒绝

**请求 ID:** \`${requestId.slice(-8)}\``;

  try {
    sendText(getReqId(reqId), message);
    log.info(`Permission card sent to user ${chatId}`);
  } catch (err) {
    log.error('Failed to send permission card:', err);
  }
}

/**
 * Send mode switch card
 */
export async function sendModeCard(
  chatId: string,
  _userId: string,
  currentMode: string,
  reqId?: string
): Promise<void> {
  const { MODE_LABELS } = await import('../permission-mode/types.js');
  const message = `🔐 **权限模式**

**当前模式:** \`${MODE_LABELS[currentMode as keyof typeof MODE_LABELS] || currentMode}\`

发送命令切换模式:
• \`/mode ask\` - 每次询问
• \`/mode accept-edits\` - 自动批准编辑
• \`/mode plan\` - 仅分析
• \`/mode yolo\` - 跳过所有权限`;

  try {
    sendText(getReqId(reqId), message);
    log.info(`Mode card sent to user ${chatId}`);
  } catch (err) {
    log.error('Failed to send mode card:', err);
  }
}

/**
 * Send image reply
 * Note: WeWork requires media_id for image messages
 */
export async function sendImageReply(chatId: string, imagePath: string): Promise<void> {
  // For now, send text with image path
  // TODO: Implement media upload and send with media_id
  await sendTextReply(chatId, `图片已保存: ${imagePath}`);
}

/**
 * Send directory selection (not supported in WeWork, use text instead)
 */
export async function sendDirectorySelection(
  chatId: string,
  currentDir: string,
  _userId: string
): Promise<void> {
  await sendTextReply(chatId, `📁 当前目录: \`${currentDir}\`\n\n请使用 \`/cd <目录>\` 命令切换目录`);
}

/**
 * Start typing indicator (WeWork doesn't support this)
 */
export function startTypingLoop(_chatId: string): () => void {
  // WeWork doesn't have a typing indicator like Telegram
  // Return a no-op function
  return () => {};
}

/**
 * Send error message
 */
export async function sendErrorMessage(chatId: string, error: string, reqId?: string): Promise<void> {
  const message = formatWeWorkMessage('❌ 错误', error, 'error');

  try {
    sendText(getReqId(reqId), message);
    log.info(`Error message sent to user ${chatId}`);
  } catch (err) {
    log.error('Failed to send error message:', err);
  }
}
