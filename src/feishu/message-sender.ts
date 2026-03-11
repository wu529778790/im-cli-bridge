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

/**
 * Create Feishu card with action buttons
 * Used for permission prompts and other interactive requests
 */
export function createFeishuButtonCard(
  title: string,
  content: string,
  buttons: Array<{ label: string; value: string; type?: 'primary' | 'default' }>
): string {
  const elements: any[] = [];

  // Main content
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: content,
    },
  });

  // Add separator
  elements.push({ tag: 'hr' });

  // Add action buttons
  const actionGroups: any[] = [];

  // Split buttons into rows (max 4 buttons per row in Feishu)
  for (let i = 0; i < buttons.length; i += 4) {
    const row = buttons.slice(i, i + 4).map((btn) => ({
      tag: 'button',
      text: {
        tag: 'plain_text',
        content: btn.label,
      },
      type: btn.type || 'default',
      value: {
        action: 'permission',
        value: btn.value,
      },
    }));

    actionGroups.push({
      tag: 'action',
      actions: row,
    });
  }

  elements.push(...actionGroups);

  const card: any = {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: 'blue',
      title: {
        content: `🔐 ${title}`,
        tag: 'plain_text',
      },
    },
    elements,
  };

  return JSON.stringify(card);
}

/** 只读模式卡片（无按钮，用于回调后替换原卡片防止二次点击） */
export function createFeishuModeCardReadOnly(currentMode: string): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'green',
      title: { content: '🔐 权限模式', tag: 'plain_text' },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**当前模式:** ${currentMode}\n\n✅ 已切换成功，发送 \`/mode\` 可再次切换。`,
        },
      },
    ],
  };
}

/**
 * 延时更新消息卡片（POST /open-apis/im/v1/cards/update）
 * 用于在卡片回调 3 秒内无法完成时，异步替换卡片为只读版本，防止二次点击
 * @param token 从卡片交互事件中获取的 token（格式 c-xxxx）
 * @param card 卡片内容 { config, header, elements }
 * @param openIds 非共享卡片需指定更新的用户 open_id 列表
 */
export async function delayUpdateCard(
  token: string,
  card: Record<string, unknown>,
  openIds?: string[]
): Promise<void> {
  const accessToken = await getTenantAccessToken();
  // 非共享卡片需在 card 内指定 open_ids
  const cardBody = { ...card };
  if (openIds && openIds.length > 0) {
    (cardBody as Record<string, unknown>).open_ids = openIds;
  }
  const body = { token, card: cardBody };
  const resp = await fetch('https://open.feishu.cn/open-apis/interactive/v1/card/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await resp.json()) as { code?: number; msg?: string };
  if (data.code !== 0) {
    log.warn(`[delayUpdateCard] Failed: code=${data.code}, msg=${data.msg}`);
    return;
  }
  log.info('[delayUpdateCard] Card updated successfully');
}

/**
 * Create mode switch card with action type for card callback
 */
function createFeishuModeCard(
  currentMode: string,
  buttons: Array<{ label: string; value: string; type?: 'primary' | 'default' }>
): string {
  const elements: any[] = [];
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**当前模式:** ${currentMode}\n\n点击下方按钮切换模式：\n\n_💡 若点击报错：开放平台 → 事件与回调 → 切到「回调」Tab → 添加「卡片回传交互」。或直接用 \`/mode ask\` 等命令切换。_`,
    },
  });
  elements.push({ tag: 'hr' });
  for (let i = 0; i < buttons.length; i += 4) {
    const row = buttons.slice(i, i + 4).map((btn) => ({
      tag: 'button',
      text: { tag: 'plain_text', content: btn.label },
      type: btn.type || 'default',
      value: { action: 'mode', value: btn.value },
    }));
    elements.push({ tag: 'action', actions: row });
  }
  const card: any = {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: { content: '🔐 权限模式', tag: 'plain_text' },
    },
    elements,
  };
  return JSON.stringify(card);
}

export async function sendModeCard(
  chatId: string,
  _userId: string,
  currentMode: string
): Promise<void> {
  const { getClient } = await import('./client.js');
  const { MODE_LABELS } = await import('../permission-mode/types.js');
  const client = getClient();
  const MODE_BTNS = [
    { label: MODE_LABELS.ask, value: 'ask', type: 'default' as const },
    { label: MODE_LABELS['accept-edits'], value: 'accept-edits', type: 'default' as const },
    { label: MODE_LABELS.plan, value: 'plan', type: 'default' as const },
    { label: MODE_LABELS.yolo, value: 'yolo', type: 'default' as const },
  ];
  const currentLabel = MODE_BTNS.find((b) => b.value === currentMode)?.label ?? currentMode;
  const cardContent = createFeishuModeCard(currentLabel, MODE_BTNS);
  await client.im.message.create({
    data: {
      receive_id: chatId,
      msg_type: 'interactive',
      content: cardContent,
    },
    params: { receive_id_type: 'chat_id' },
  });
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

/** 使用 open_id 发送（私聊时 context 可能只有 open_id） */
export async function sendTextReplyByOpenId(openId: string, text: string): Promise<void> {
  const client = getClient();
  const cardContent = createFeishuCard('📢 open-im', text, 'done');
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
