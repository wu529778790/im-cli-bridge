import { getClient } from './client.js';
import { messageCard } from '@larksuiteoapi/node-sdk';
import { readFileSync } from 'node:fs';
import { createLogger } from '../logger.js';
import { splitLongContent } from '../shared/utils.js';
import { MAX_FEISHU_MESSAGE_LENGTH } from '../constants.js';

const log = createLogger('FeishuSender');

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

async function getTenantAccessToken(): Promise<string> {
  const client = getClient();
  const resp = await client.auth.tenantAccessToken.internal({
    data: {
      app_id: client.appId,
      app_secret: client.appSecret,
    },
  });
  if (resp.code !== 0 || !resp.data) {
    throw new Error(`Failed to get tenant access token: ${resp.msg}`);
  }
  return (resp.data as { tenant_access_token: string }).tenant_access_token;
}

export async function sendThinkingMessage(
  chatId: string,
  replyToMessageId: string | undefined,
  toolId = 'claude'
): Promise<string> {
  const client = getClient();

  // Use SDK's built-in card builder for simpler messages
  const cardContent = messageCard.defaultCard({
    title: `${STATUS_ICONS.thinking} ${getToolTitle(toolId, 'thinking')}`,
    content: '正在思考...\n\n请稍候...',
  });

  try {
    log.info(`Sending thinking message to chat ${chatId}, replyTo: ${replyToMessageId}`);
    const resp = await client.im.message.create({
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: cardContent,
        uuid: replyToMessageId,
      },
      params: { receive_id_type: 'chat_id' },
    });

    if (!resp.data || !resp.data.message_id) {
      throw new Error(`Failed to send message: ${resp.msg}`);
    }

    log.info(`Thinking message created with ID: ${resp.data.message_id}`);
    return resp.data.message_id;
  } catch (err) {
    log.error('Failed to send thinking message:', err);
    throw err;
  }
}

export async function updateMessage(
  chatId: string,
  messageId: string,
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = 'claude'
): Promise<void> {
  const client = getClient();

  // Build content with note
  let fullContent = content;
  if (note) {
    fullContent = `${content}\n\n─────────\n${note}`;
  }

  // Delete old message and send new one (Feishu update API has strict validation)
  try {
    log.info(`Deleting old message ${messageId}`);
    await client.im.message.delete({
      path: { message_id: messageId },
    });
    log.info(`Old message deleted successfully`);
  } catch (err) {
    log.warn('Failed to delete old message:', err);
  }

  // Send new message
  const icon = STATUS_ICONS[status];
  const title = getToolTitle(toolId, status);
  const cardContent = messageCard.defaultCard({
    title: `${icon} ${title}`,
    content: fullContent,
  });

  try {
    const resp = await client.im.message.create({
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: cardContent,
      },
      params: { receive_id_type: 'chat_id' },
    });
    log.info(`New message created with ID: ${resp.data?.message_id}`);
  } catch (err) {
    log.error('Failed to send new message:', err);
    throw err;
  }
}

export async function sendFinalMessages(
  chatId: string,
  messageId: string,
  fullContent: string,
  note: string,
  toolId = 'claude'
): Promise<void> {
  const client = getClient();
  const parts = splitLongContent(fullContent, MAX_FEISHU_MESSAGE_LENGTH);

  // Delete old message first
  try {
    log.info(`Deleting old message ${messageId}`);
    await client.im.message.delete({
      path: { message_id: messageId },
    });
    log.info(`Old message deleted successfully`);
  } catch (err) {
    log.warn('Failed to delete old message:', err);
  }

  // Send new messages
  for (let i = 0; i < parts.length; i++) {
    try {
      const cardContent = messageCard.defaultCard({
        title: `${STATUS_ICONS.done} ${getToolTitle(toolId, 'done')}`,
        content: i === 0 ? parts[0] : parts[i] + `\n\n(续 ${i + 1}/${parts.length})`,
      });

      await client.im.message.create({
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: cardContent,
        },
        params: { receive_id_type: 'chat_id' },
      });
    } catch (err) {
      log.error(`Failed to send part ${i + 1}:`, err);
    }
  }
}

export async function sendTextReply(chatId: string, text: string): Promise<void> {
  const client = getClient();

  // Use SDK's built-in card builder for simpler messages
  const cardContent = messageCard.defaultCard({
    title: 'open-im',
    content: text,
  });

  try {
    await client.im.message.create({
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: cardContent,
      },
      params: { receive_id_type: 'chat_id' },
    });
  } catch (err) {
    log.error('Failed to send text:', err);
  }
}

export async function sendImageReply(chatId: string, imagePath: string): Promise<void> {
  const client = getClient();

  try {
    // First, upload the image to get an image key
    const imageBuffer = readFileSync(imagePath);

    const form = new FormData();
    form.append('file', new Blob([imageBuffer]), 'image.jpg');
    form.append('image_type', 'message');

    const token = await getTenantAccessToken();
    const uploadResp = await fetch('https://open.feishu.cn/open-apis/im/v1/images', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    if (!uploadResp.ok) {
      throw new Error(`Failed to upload image: ${uploadResp.statusText}`);
    }

    const uploadData = await uploadResp.json();
    if (uploadData.code !== 0) {
      throw new Error(`Failed to upload image: ${uploadData.msg}`);
    }

    const imageKey = uploadData.data.image_key;

    // Now send the image message
    await client.im.message.create({
      data: {
        receive_id: chatId,
        msg_type: 'image',
        content: JSON.stringify({ image_key: imageKey }),
      },
      params: { receive_id_type: 'chat_id' },
    });
  } catch (err) {
    log.error('Failed to send image:', err);
  }
}

export function startTypingLoop(_chatId: string): () => void {
  // Feishu doesn't have a typing indicator like Telegram
  // Return a no-op function
  return () => {};
}
