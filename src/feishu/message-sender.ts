import { getClient } from './client.js';
import { readFileSync } from 'node:fs';
import { createLogger } from '../logger.js';
import { splitLongContent } from '../shared/utils.js';
import { MAX_FEISHU_MESSAGE_LENGTH } from '../constants.js';
import { buildCardV2, splitLongContent as cardSplitLongContent, truncateForStreaming } from './card-builder.js';
import { getAIToolDisplayName } from '../shared/utils.js';
import { buildMessageTitle, OPEN_IM_SYSTEM_TITLE } from '../shared/message-title.js';
import { buildTextNote } from '../shared/message-note.js';
import {
  createCard,
  enableStreaming,
  sendCardMessage,
  streamContent as cardkitStreamContent,
  updateCardFull,
  markCompleted,
  disableStreaming,
  destroySession,
} from './cardkit-manager.js';

const log = createLogger('FeishuSender');

export interface CardHandle {
  messageId: string;
  cardId: string;
}

export type MessageStatus = 'thinking' | 'streaming' | 'done' | 'error';

const STATUS_CONFIG: Record<MessageStatus, { icon: string; template: string; title: string }> = {
  thinking: { icon: '🔵', template: 'blue', title: '思考中' },
  streaming: { icon: '🔄', template: 'blue', title: '执行中' },
  done: { icon: '✅', template: 'green', title: '完成' },
  error: { icon: '❌', template: 'red', title: '错误' },
};

function getToolTitle(toolId: string, status: MessageStatus): string {
  return buildMessageTitle(toolId, status, {
    brandSuffix: true,
    statusTitles: {
      thinking: STATUS_CONFIG.thinking.title,
      streaming: STATUS_CONFIG.streaming.title,
      done: STATUS_CONFIG.done.title,
      error: STATUS_CONFIG.error.title,
    },
  });
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
        content: buildTextNote(note),
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

/** CardKit 打字机：发送思考卡片并返回 cardId + messageId */
export async function sendThinkingCard(chatId: string, toolId = 'claude'): Promise<CardHandle> {
  const initialCard = buildCardV2(
    { content: '正在启动...', status: 'processing', note: '请稍候', toolName: toolId }
  );
  const cardId = await createCard(initialCard);

  const [, messageId] = await Promise.all([
    enableStreaming(cardId),
    sendCardMessage(chatId, cardId),
  ]);

  const toolDisplayName = getAIToolDisplayName(toolId);
  const cardWithButton = buildCardV2(
    { content: `等待 ${toolDisplayName} 响应...`, status: 'processing', note: '请稍候', toolName: toolId },
    cardId
  );
  await updateCardFull(cardId, cardWithButton);
  log.debug(`Processing card created: cardId=${cardId}, messageId=${messageId}`);

  return { messageId, cardId };
}

/** CardKit 流式更新（打字机效果） */
export async function streamContentUpdate(cardId: string, content: string, note?: string): Promise<void> {
  const truncated = truncateForStreaming(content) || '...';
  const updates: Promise<void>[] = [cardkitStreamContent(cardId, 'main_content', truncated)];
  if (note) updates.push(cardkitStreamContent(cardId, 'note_area', note));
  await Promise.all(updates);
}

/** CardKit 完成：关闭流式、全量更新、溢出分片 */
export async function sendFinalCards(
  chatId: string,
  _messageId: string,
  cardId: string,
  fullContent: string,
  note: string,
  thinking?: string,
  toolId = 'claude'
): Promise<void> {
  const parts = cardSplitLongContent(fullContent);

  markCompleted(cardId);
  await disableStreaming(cardId);

  const finalCard = buildCardV2({ content: parts[0], status: 'done', note, thinking, toolName: toolId }, cardId);
  await updateCardFull(cardId, finalCard);

  const client = getClient();
  for (let i = 1; i < parts.length; i++) {
    const overflowContent = `${parts[i]}\n\n_*(续 ${i + 1}/${parts.length})*_`;
    const overflowCard = createFeishuCard(
      getToolTitle(toolId, 'done'),
      overflowContent,
      'done',
      note
    );
    await client.im.message.create({
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: overflowCard,
      },
      params: { receive_id_type: 'chat_id' },
    });
  }

  destroySession(cardId);
}

/** CardKit 错误卡片 */
export async function sendErrorCard(cardId: string, error: string): Promise<void> {
  markCompleted(cardId);
  await disableStreaming(cardId);
  try {
    const errorCard = buildCardV2({ content: `错误：${error}`, status: 'error', note: '执行失败' });
    await updateCardFull(cardId, errorCard);
  } catch (err) {
    log.error('Failed to send error card:', err);
  }
  destroySession(cardId);
}

// Track if patch API is working for this session
let patchApiWorking = true;
let patchFailCount = 0;
const MAX_PATCH_FAILURES_BEFORE_DISABLE = 3;

export async function updateMessage(
  chatId: string,
  messageId: string,
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = 'claude'
): Promise<void> {
  const client = getClient();

  const title = getToolTitle(toolId, status);
  const cardContent = createFeishuCard(title, content, status, note);

  // Try to use patch API for in-place update (streaming)
  // Only attempt patch if it has been working recently
  if (patchApiWorking) {
    const doPatch = async (): Promise<{ ok: boolean; code?: number }> => {
      const resp = await client.im.message.patch({
        path: { message_id: messageId },
        data: { content: cardContent },
      });
      if (resp.code === 0) return { ok: true };
      return { ok: false, code: resp.code };
    };

    try {
      let result = await doPatch();
      // 230020 频控：等待后重试一次
      if (!result.ok && result.code === 230020) {
        await new Promise((r) => setTimeout(r, 400));
        result = await doPatch();
      }
      if (result.ok) {
        log.debug(`✓ Patch API succeeded: ${messageId}`);
        patchFailCount = 0;
        return;
      }

      patchFailCount++;
      log.warn(`Patch API failed (code: ${result.code}) - failure ${patchFailCount}/${MAX_PATCH_FAILURES_BEFORE_DISABLE}`);
      if (patchFailCount >= MAX_PATCH_FAILURES_BEFORE_DISABLE) {
        log.warn('Patch API disabled for this session due to repeated failures');
        patchApiWorking = false;
      }
      // 流式更新时不 fallback 到 delete+create，否则会生成新消息但 caller 仍持旧 msgId，导致后续 patch 全失败并不断创建新消息
      // 直接返回，下次节流周期会重试
      return;
    } catch (err: unknown) {
      patchFailCount++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.warn(`Patch API error (${patchFailCount}/${MAX_PATCH_FAILURES_BEFORE_DISABLE}): ${errorMsg}`);
      if (patchFailCount >= MAX_PATCH_FAILURES_BEFORE_DISABLE) {
        log.warn('Patch API disabled for this session due to repeated errors');
        patchApiWorking = false;
      }
    }
  }
  // 流式更新失败时不再 fallback 到 delete+create（会生成新消息但 caller 持旧 msgId，导致重复创建）
  // 下次节流周期会重试；最终内容由 sendFinalMessages 负责
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

  // If content fits in one message and patch is working, try patch for smooth transition
  if (parts.length === 1 && patchApiWorking) {
    const cardContent = createFeishuCard(
      getToolTitle(toolId, 'done'),
      fullContent,
      'done'
    );

    try {
      const resp = await client.im.message.patch({
        path: { message_id: messageId },
        data: {
          content: cardContent,
        },
      });

      if (resp.code === 0) {
        log.info(`✓ Final message patched successfully: ${messageId}`);
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
    await client.im.message.delete({
      path: { message_id: messageId },
    });
    log.debug(`Deleted old message for final recreate: ${messageId}`);
  } catch (err) {
    log.warn('Failed to delete old message:', err);
  }

  // Send new messages (split when content exceeds limit)
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
    OPEN_IM_SYSTEM_TITLE,
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

/** 使用 open_id 发送（私聊时 context 可能只有 open_id） */
export async function sendTextReplyByOpenId(openId: string, text: string): Promise<void> {
  const client = getClient();
  const cardContent = createFeishuCard(OPEN_IM_SYSTEM_TITLE, text, 'done');
  try {
    await client.im.message.create({
      data: {
        receive_id: openId,
        msg_type: 'interactive',
        content: cardContent,
      },
      params: { receive_id_type: 'open_id' },
    });
  } catch (err) {
    log.error('Failed to send text by open_id:', err);
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
