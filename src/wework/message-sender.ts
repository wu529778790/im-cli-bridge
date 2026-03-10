/**
 * WeWork (企业微信) Message Sender - Send messages to WeWork
 */

import { sendMessage, getAgentId } from './client.js';
import { createLogger } from '../logger.js';
import { splitLongContent } from '../shared/utils.js';
import { MAX_WEWORK_MESSAGE_LENGTH } from '../constants.js';
import type { MessageStatus, WeWorkSendMessageRequest } from './types.js';

const log = createLogger('WeWorkSender');

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
 * Send thinking message to WeWork
 * Returns a message ID that can be used for updates
 */
export async function sendThinkingMessage(
  chatId: string,
  _replyToMessageId: string | undefined,
  toolId = 'claude'
): Promise<string> {
  const messageId = generateMsgId();
  const title = getToolTitle(toolId, 'thinking');
  const content = formatWeWorkMessage(title, '', 'thinking');

  try {
    log.info(`Sending thinking message to user ${chatId}`);

    const request: WeWorkSendMessageRequest = {
      touser: chatId,
      msgtype: 'text',
      agentid: parseInt(getAgentId(), 10),
      text: { content },
    };

    await sendMessage(request);
    log.info(`Thinking message sent: ${messageId}`);
    return messageId;
  } catch (err) {
    log.error('Failed to send thinking message:', err);
    throw err;
  }
}

/**
 * Update existing message in WeWork
 * Note: WeWork doesn't support message editing, so we send a new message
 */
export async function updateMessage(
  chatId: string,
  _messageId: string,
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = 'claude'
): Promise<void> {
  const title = getToolTitle(toolId, status);
  const message = formatWeWorkMessage(title, content, status, note);

  try {
    const request: WeWorkSendMessageRequest = {
      touser: chatId,
      msgtype: 'text',
      agentid: parseInt(getAgentId(), 10),
      text: { content: message },
    };

    await sendMessage(request);
    log.info(`Message updated: ${status}`);
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
  _messageId: string,
  fullContent: string,
  note: string,
  toolId = 'claude'
): Promise<void> {
  const title = getToolTitle(toolId, 'done');
  const parts = splitLongContent(fullContent, MAX_WEWORK_MESSAGE_LENGTH);

  for (let i = 0; i < parts.length; i++) {
    try {
      const partContent = i === 0 ? parts[0] : `${parts[i]}\n\n_*(续 ${i + 1}/${parts.length})*_`;
      const message = formatWeWorkMessage(title, partContent, 'done', i === parts.length - 1 ? note : undefined);

      const request: WeWorkSendMessageRequest = {
        touser: chatId,
        msgtype: 'text',
        agentid: parseInt(getAgentId(), 10),
        text: { content: message },
      };

      await sendMessage(request);
      log.info(`Final message part ${i + 1}/${parts.length} sent`);
    } catch (err) {
      log.error(`Failed to send part ${i + 1}:`, err);
    }
  }
}

/**
 * Send simple text reply to WeWork
 */
export async function sendTextReply(chatId: string, text: string): Promise<void> {
  const message = formatWeWorkMessage('📢 open-im', text, 'done');

  try {
    const request: WeWorkSendMessageRequest = {
      touser: chatId,
      msgtype: 'text',
      agentid: parseInt(getAgentId(), 10),
      text: { content: message },
    };

    await sendMessage(request);
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
  toolInput: string
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
    const request: WeWorkSendMessageRequest = {
      touser: chatId,
      msgtype: 'text',
      agentid: parseInt(getAgentId(), 10),
      text: { content: message },
    };

    await sendMessage(request);
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
  currentMode: string
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
    const request: WeWorkSendMessageRequest = {
      touser: chatId,
      msgtype: 'text',
      agentid: parseInt(getAgentId(), 10),
      text: { content: message },
    };

    await sendMessage(request);
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
 * Generate unique message ID
 */
function generateMsgId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
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
export async function sendErrorMessage(chatId: string, error: string): Promise<void> {
  const message = formatWeWorkMessage('❌ 错误', error, 'error');

  try {
    const request: WeWorkSendMessageRequest = {
      touser: chatId,
      msgtype: 'text',
      agentid: parseInt(getAgentId(), 10),
      text: { content: message },
    };

    await sendMessage(request);
    log.info(`Error message sent to user ${chatId}`);
  } catch (err) {
    log.error('Failed to send error message:', err);
  }
}
