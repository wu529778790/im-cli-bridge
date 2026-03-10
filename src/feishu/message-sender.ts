import { getClient } from './client.js';
import { readFileSync } from 'node:fs';
import { createLogger } from '../logger.js';
import { splitLongContent } from '../shared/utils.js';
import { MAX_FEISHU_MESSAGE_LENGTH } from '../constants.js';

const log = createLogger('FeishuSender');

export type MessageStatus = 'thinking' | 'streaming' | 'done' | 'error';

const STATUS_CONFIG: Record<MessageStatus, { icon: string; template: string; title: string }> = {
  thinking: { icon: '🔵', template: 'blue', title: '思考中' },
  streaming: { icon: '🔄', template: 'blue', title: '执行中' },
  done: { icon: '✅', template: 'green', title: '完成' },
  error: { icon: '❌', template: 'red', title: '错误' },
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
 * Create Feishu interactive card with native lark_md support
 * Feishu natively supports Markdown through the `lark_md` tag
 */
function createFeishuCard(
  title: string,
  content: string,
  status: MessageStatus,
  note?: string
): string {
  const statusConfig = STATUS_CONFIG[status];
  const elements: any[] = [];

  // Main content - use native lark_md tag
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: content || '_处理中..._',
    },
  });

  // Add note separator and hint if provided
  if (note) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**💡 ${note}**`,
      },
    });
  }

  const card: any = {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: statusConfig.template,
      title: {
        content: `${statusConfig.icon} ${title}`,
        tag: 'plain_text',
      },
    },
    elements,
  };

  return JSON.stringify(card);
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

  const cardContent = createFeishuCard(
    getToolTitle(toolId, 'thinking'),
    '_正在思考，请稍候..._\n\n💭 **准备中**',
    'thinking'
  );

  try {
    log.info(`Sending thinking message to chat ${chatId}, replyTo: ${replyToMessageId}`);
    const resp = await client.im.message.create({
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: cardContent,
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

  const icon = STATUS_CONFIG[status].icon;
  const title = `${icon} ${getToolTitle(toolId, status)}`;
  const cardContent = createFeishuCard(title, content, status, note);

  // Try to use patch API for in-place update (streaming)
  try {
    const resp = await client.im.message.patch({
      path: { message_id: messageId },
      data: {
        content: cardContent,
      },
    });

    if (resp.code === 0) {
      log.info(`Message updated in-place: ${messageId}`);
      return;
    }

    // If patch failed with validation error, fall back to delete+create
    log.warn(`Patch API failed (code: ${resp.code}, msg: ${resp.msg}), falling back to delete+create`);
  } catch (err: unknown) {
    // Log but don't throw - we'll fall back to delete+create
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.debug(`Patch API error: ${errorMsg}, falling back to delete+create`);
  }

  // Fallback: Delete old message and send new one
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

  // If content fits in one message, try patch for smooth transition
  if (parts.length === 1) {
    const cardContent = createFeishuCard(
      getToolTitle(toolId, 'done'),
      fullContent,
      'done'
    );

    // Try to use patch API for in-place update
    try {
      const resp = await client.im.message.patch({
        path: { message_id: messageId },
        data: {
          content: cardContent,
        },
      });

      if (resp.code === 0) {
        log.info(`Final message updated in-place: ${messageId}`);
        return;
      }

      log.warn(`Patch API failed (code: ${resp.code}), falling back to delete+create`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.debug(`Patch API error: ${errorMsg}, falling back to delete+create`);
    }
  }

  // Fallback: Delete old message first (for multi-part or failed patch)
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
      const partContent = i === 0 ? parts[0] : `${parts[i]}\n\n_*(续 ${i + 1}/${parts.length})*_`;
      const cardContent = createFeishuCard(
        getToolTitle(toolId, 'done'),
        partContent,
        'done'
      );

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

  const cardContent = createFeishuCard(
    '📢 open-im',
    text,
    'done'
  );

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
