/**
 * WeChat Message Sender - Send messages to WeChat via AGP protocol
 */

import { sendAGPMessage } from './client.js';
import { createLogger } from '../logger.js';
import { splitLongContent } from '../shared/utils.js';
import { buildImageFallbackMessage } from '../channels/capabilities.js';
import type { MessageStatus } from './types.js';
import { buildMessageTitle, OPEN_IM_SYSTEM_TITLE } from '../shared/message-title.js';
import { buildTextNote } from '../shared/message-note.js';
import {
  buildModeMessage,
  buildPermissionRequestMessage,
} from '../shared/system-messages.js';

const log = createLogger('WeChatSender');

const MAX_WECHAT_MESSAGE_LENGTH = 2048;

const STATUS_CONFIG: Record<MessageStatus, { icon: string; title: string }> = {
  thinking: { icon: '🤔', title: '思考中' },
  streaming: { icon: '🔄', title: '执行中' },
  done: { icon: '✅', title: '完成' },
  error: { icon: '❌', title: '错误' },
};

function getToolTitle(toolId: string, status: MessageStatus): string {
  return buildMessageTitle(toolId, status, {
    statusTitles: {
      thinking: STATUS_CONFIG.thinking.title,
      streaming: STATUS_CONFIG.streaming.title,
      done: STATUS_CONFIG.done.title,
      error: STATUS_CONFIG.error.title,
    },
  });
}

function formatWeChatMessage(
  title: string,
  content: string,
  status: MessageStatus,
  note?: string,
): string {
  const statusConfig = STATUS_CONFIG[status];
  let message = `${statusConfig.icon} **${title}**\n\n`;

  if (content) {
    message += `${content}\n\n`;
  } else if (status === 'thinking') {
    message += `_正在思考，请稍候..._\n\n🤖 **准备中**\n\n`;
  }

  if (note) {
    message += buildTextNote(note);
  }

  return message;
}

export async function sendThinkingMessage(
  chatId: string,
  _replyToMessageId: string | undefined,
  toolId = 'claude',
): Promise<string> {
  const messageId = generateMsgId();
  const title = getToolTitle(toolId, 'thinking');
  const content = formatWeChatMessage(title, '', 'thinking');

  try {
    log.info(`Sending thinking message to chat ${chatId}`);
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

export async function updateMessage(
  chatId: string,
  _messageId: string,
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = 'claude',
): Promise<void> {
  const title = getToolTitle(toolId, status);
  const message = formatWeChatMessage(title, content, status, note);

  try {
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

export async function sendFinalMessages(
  chatId: string,
  _messageId: string,
  fullContent: string,
  note: string,
  toolId = 'claude',
): Promise<void> {
  const title = getToolTitle(toolId, 'done');
  const parts = splitLongContent(fullContent, MAX_WECHAT_MESSAGE_LENGTH);

  try {
    const firstPartNote =
      parts.length > 1 ? `内容较长，后续消息继续发送 (1/${parts.length})` : note;
    const firstMessage = formatWeChatMessage(title, parts[0], 'done', firstPartNote);

    sendAGPMessage('session.update', {
      session_id: chatId,
      updates: {
        status: 'done',
        content: firstMessage,
      },
    });
    log.info('Final message updated in-place');
  } catch (err) {
    log.error('Failed to update final message in-place:', err);
  }

  for (let i = 1; i < parts.length; i++) {
    try {
      const partContent = `${parts[i]}\n\n_*(续 ${i + 1}/${parts.length})*_`;
      const message = formatWeChatMessage(
        title,
        partContent,
        'done',
        i === parts.length - 1 ? note : undefined,
      );

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

export async function sendTextReply(chatId: string, text: string): Promise<void> {
  const message = formatWeChatMessage(OPEN_IM_SYSTEM_TITLE, text, 'done');

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

export async function sendImageReply(chatId: string, imagePath: string): Promise<void> {
  await sendTextReply(chatId, buildImageFallbackMessage('wechat', imagePath));
}


function generateMsgId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

export function startTypingLoop(_chatId: string): () => void {
  return () => {};
}

export async function sendErrorMessage(chatId: string, error: string): Promise<void> {
  const message = formatWeChatMessage('错误', error, 'error');

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
