/**
 * WeChat Message Sender - Send messages to WeChat via AGP protocol
 */

import { sendAGPMessage } from './client.js';
import { createLogger } from '../logger.js';
import { splitLongContent, getAIToolDisplayName } from '../shared/utils.js';
import { buildImageFallbackMessage } from '../channels/capabilities.js';
import type { MessageStatus } from './types.js';

const log = createLogger('WeChatSender');

const MAX_WECHAT_MESSAGE_LENGTH = 2048;

const STATUS_CONFIG: Record<MessageStatus, { icon: string; title: string }> = {
  thinking: { icon: '🔵', title: '思考中' },
  streaming: { icon: '🔄', title: '执行中' },
  done: { icon: '✅', title: '完成' },
  error: { icon: '❌', title: '错误' },
};

function getToolTitle(toolId: string, status: MessageStatus): string {
  const name = getAIToolDisplayName(toolId);
  const statusText = STATUS_CONFIG[status].title;
  return status === 'done' ? name : `${name} - ${statusText}`;
}

/**
 * Format message for WeChat (simple text format for AGP)
 */
function formatWeChatMessage(
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
 * Send thinking message to WeChat
 */
export async function sendThinkingMessage(
  chatId: string,
  _replyToMessageId: string | undefined,
  toolId = 'claude'
): Promise<string> {
  const messageId = generateMsgId();
  const title = getToolTitle(toolId, 'thinking');
  const content = formatWeChatMessage(title, '', 'thinking');

  try {
    log.info(`Sending thinking message to chat ${chatId}`);

    // Send session.prompt with thinking content
    sendAGPMessage('session.prompt', {
      session_id: chatId,
      content,
      options: { stream: false },
    });

    log.info(`Thinking message sent: ${messageId}`);
    return messageId;
  } catch (err) {
    log.error('Failed to send thinking message:', err);
    throw err;
  }
}

/**
 * Update existing message in WeChat
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
  const message = formatWeChatMessage(title, content, status, note);

  try {
    // Send session.update with new content
    sendAGPMessage('session.update', {
      session_id: chatId,
      updates: {
        status,
        content: message,
      },
    });

    log.info(`Message updated: ${status}`);
  } catch (err) {
    log.error('Failed to update message:', err);
    throw err;
  }
}

/**
 * Send final messages to WeChat (handle long content)
 */
export async function sendFinalMessages(
  chatId: string,
  _messageId: string,
  fullContent: string,
  note: string,
  toolId = 'claude'
): Promise<void> {
  const title = getToolTitle(toolId, 'done');
  const parts = splitLongContent(fullContent, MAX_WECHAT_MESSAGE_LENGTH);

  for (let i = 0; i < parts.length; i++) {
    try {
      const partContent = i === 0 ? parts[0] : `${parts[i]}\n\n_*(续 ${i + 1}/${parts.length})*_`;
      const message = formatWeChatMessage(title, partContent, 'done', i === parts.length - 1 ? note : undefined);

      // Send session.promptResponse with final content
      sendAGPMessage('session.promptResponse', {
        session_id: chatId,
        content: message,
        status: 'success',
        metadata: { part: i + 1, total: parts.length },
      });

      log.info(`Final message part ${i + 1}/${parts.length} sent`);
    } catch (err) {
      log.error(`Failed to send part ${i + 1}:`, err);
    }
  }
}

/**
 * Send simple text reply to WeChat
 */
export async function sendTextReply(chatId: string, text: string): Promise<void> {
  const message = formatWeChatMessage('📢 open-im', text, 'done');

  try {
    sendAGPMessage('session.promptResponse', {
      session_id: chatId,
      content: message,
      status: 'success',
    });

    log.info(`Text reply sent to chat ${chatId}`);
  } catch (err) {
    log.error('Failed to send text reply:', err);
  }
}

/**
 * Send permission card with action buttons (for permission prompts)
 */
export async function sendImageReply(chatId: string, imagePath: string): Promise<void> {
  await sendTextReply(chatId, buildImageFallbackMessage('wechat', imagePath));
}

/**
 * Send permission card with action buttons (for permission prompts)
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
${toolInput}
\`\`\`

请回复以下命令进行操作:
• \`/allow\` - 允许
• \`/deny\` - 拒绝

**请求 ID:** \`${requestId}\``;

  try {
    sendAGPMessage('session.promptResponse', {
      session_id: chatId,
      content: message,
      status: 'success',
      metadata: { type: 'permission', requestId },
    });

    log.info(`Permission card sent to chat ${chatId}`);
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
  const message = `🔐 **权限模式**

**当前模式:** \`${currentMode}\`

点击下方按钮或发送命令切换模式:
• \`/mode ask\` - 每次询问
• \`/mode accept-edits\` - 自动批准编辑
• \`/mode plan\` - 仅分析
• \`/mode yolo\` - 跳过所有权限`;

  try {
    sendAGPMessage('session.promptResponse', {
      session_id: chatId,
      content: message,
      status: 'success',
      metadata: { type: 'mode_switch' },
    });

    log.info(`Mode card sent to chat ${chatId}`);
  } catch (err) {
    log.error('Failed to send mode card:', err);
  }
}

/**
 * Generate unique message ID
 */
function generateMsgId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Start typing indicator (WeChat may not support this, return no-op)
 */
export function startTypingLoop(_chatId: string): () => void {
  // WeChat doesn't have a typing indicator like Telegram
  // Return a no-op function
  return () => {};
}

/**
 * Send error message
 */
export async function sendErrorMessage(chatId: string, error: string): Promise<void> {
  const message = formatWeChatMessage('❌ 错误', error, 'error');

  try {
    sendAGPMessage('session.promptResponse', {
      session_id: chatId,
      content: message,
      status: 'error',
      metadata: { type: 'error' },
    });

    log.info(`Error message sent to chat ${chatId}`);
  } catch (err) {
    log.error('Failed to send error message:', err);
  }
}
