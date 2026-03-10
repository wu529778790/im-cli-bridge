import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@larksuiteoapi/node-sdk';
import type { Config } from '../config.js';
import { AccessControl } from '../access/access-control.js';
import type { SessionManager } from '../session/session-manager.js';
import { RequestQueue } from '../queue/request-queue.js';
import {
  sendThinkingMessage,
  updateMessage,
  sendFinalMessages,
  sendTextReply,
  sendTextReplyByOpenId,
  startTypingLoop,
  sendImageReply,
  createFeishuButtonCard,
  sendModeCard,
  createFeishuModeCardReadOnly,
  delayUpdateCard,
} from './message-sender.js';
import { registerPermissionSender, resolvePermissionById } from '../hook/permission-server.js';
import { setPermissionMode } from '../permission-mode/session-mode.js';
import { MODE_LABELS } from '../permission-mode/types.js';
import { CommandHandler } from '../commands/handler.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask, type TaskRunState } from '../shared/ai-task.js';
import { startTaskCleanup } from '../shared/task-cleanup.js';
import { THROTTLE_MS, IMAGE_DIR, MAX_FEISHU_MESSAGE_LENGTH } from '../constants.js';
import { setActiveChatId } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import { splitLongContent } from '../shared/utils.js';
import { createLogger } from '../logger.js';

const log = createLogger('FeishuHandler');

async function downloadFeishuImage(client: Client, imageKey: string): Promise<string> {
  await mkdir(IMAGE_DIR, { recursive: true });

  // Get tenant access token
  const tokenResp = await client.auth.tenantAccessToken.internal({
    data: {
      app_id: client.appId,
      app_secret: client.appSecret,
    },
  });
  if (tokenResp.code !== 0 || !tokenResp.data) {
    throw new Error(`Failed to get tenant access token: ${tokenResp.msg}`);
  }
  const token = (tokenResp.data as { tenant_access_token: string }).tenant_access_token;

  // Get the image download URL using the correct API endpoint
  const resourceResp = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/images/${imageKey}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!resourceResp.ok) {
    throw new Error(`Failed to get image resource: ${resourceResp.statusText}`);
  }

  const resourceData = await resourceResp.json();
  if (resourceData.code !== 0) {
    throw new Error(`Failed to get image resource: ${resourceData.msg}`);
  }

  // Download the image
  const imageUrl = resourceData.data?.file_download_url || resourceData.data?.url;
  if (!imageUrl) {
    throw new Error('No image URL found in response');
  }

  const imgResp = await fetch(imageUrl, {
    signal: AbortSignal.timeout(30000),
  });

  if (!imgResp.ok) {
    throw new Error(`Failed to download image: ${imgResp.statusText}`);
  }

  const buffer = Buffer.from(await imgResp.arrayBuffer());
  const safeId = imageKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  const imagePath = join(IMAGE_DIR, `${Date.now()}-${safeId.slice(-8)}.jpg`);
  await writeFile(imagePath, buffer);
  return imagePath;
}

/**
 * Send permission prompt card with interactive buttons
 */
async function sendPermissionCard(
  chatId: string,
  requestId: string,
  toolName: string,
  toolInput: string
): Promise<void> {
  const { getClient } = await import('./client.js');
  const client = getClient();

  // Format tool input for display
  let formattedInput: string;
  if (toolInput.length > 300) {
    formattedInput = toolInput.slice(0, 300) + '...';
  } else {
    formattedInput = toolInput;
  }

  const content = `**工具:** \`${toolName}\`

**参数:**
\`\`\`
${formattedInput}
\`\`\`

**请求 ID:** \`${requestId.slice(-8)}\``;

  const cardContent = createFeishuButtonCard(
    '权限请求',
    content,
    [
      { label: '✅ 允许', value: `allow_${requestId}`, type: 'primary' },
      { label: '❌ 拒绝', value: `deny_${requestId}`, type: 'default' },
    ]
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
    log.info(`Permission card sent for request ${requestId}`);
  } catch (err) {
    log.error('Failed to send permission card:', err);
    throw err;
  }
}

export interface FeishuEventHandlerHandle {
  stop: () => void;
  getRunningTaskCount: () => number;
  handleEvent: (data: unknown) => Promise<void | Record<string, unknown>>;
}

export function setupFeishuHandlers(
  config: Config,
  sessionManager: SessionManager
): FeishuEventHandlerHandle {
  const accessControl = new AccessControl(config.feishuAllowedUserIds);
  const requestQueue = new RequestQueue();
  const runningTasks = new Map<string, TaskRunState>();
  const stopTaskCleanup = startTaskCleanup(runningTasks);

  const commandHandler = new CommandHandler({
    config,
    sessionManager,
    requestQueue,
    sender: { sendTextReply, sendModeCard },
    getRunningTasksSize: () => runningTasks.size,
  });

  registerPermissionSender('feishu', { sendTextReply, sendPermissionCard });

  async function handleAIRequest(
    userId: string,
    chatId: string,
    prompt: string,
    workDir: string,
    convId?: string,
    _threadCtx?: { rootMessageId: string; threadId: string },
    replyToMessageId?: string
  ) {
    log.info(`[AI_REQUEST] userId=${userId}, chatId=${chatId}, promptLength=${prompt.length}`);
    log.info(`[AI_REQUEST] Full prompt: "${prompt}"`);
    const toolAdapter = getAdapter(config.aiCommand);
    if (!toolAdapter) {
      log.error(`[handleAIRequest] No adapter found for: ${config.aiCommand}`);
      await sendTextReply(chatId, `未配置 AI 工具: ${config.aiCommand}`);
      return;
    }

    log.info(`[handleAIRequest] Adapter found, getting session...`);
    const sessionId = convId ? sessionManager.getSessionIdForConv(userId, convId) : undefined;
    log.info(`[handleAIRequest] Running ${config.aiCommand} for user ${userId}, sessionId=${sessionId ?? 'new'}`);

    const toolId = config.aiCommand;
    let msgId: string;
    try {
      msgId = await sendThinkingMessage(chatId, replyToMessageId, toolId);
    } catch (err) {
      log.error('Failed to send thinking message:', err);
      return;
    }

    const stopTyping = startTypingLoop(chatId);
    const taskKey = `${userId}:${msgId}`;

    await runAITask(
      { config, sessionManager },
      { userId, chatId, workDir, sessionId, convId, platform: 'feishu', taskKey },
      prompt,
      toolAdapter,
      {
        throttleMs: THROTTLE_MS,
        streamUpdate: async (content, toolNote) => {
          const note = toolNote ? '输出中...\n' + toolNote : '输出中...';
          try {
            await updateMessage(chatId, msgId, content, 'streaming', note, toolId);
          } catch (err) {
            log.debug('Stream update failed (will retry on next update):', err);
          }
        },
        sendComplete: async (content, note) => {
          // Use sendFinalMessages to handle the final result
          await sendFinalMessages(chatId, msgId, content, note ?? '', toolId);
        },
        sendError: async (error) => {
          await updateMessage(chatId, msgId, `错误：${error}`, 'error', '执行失败', toolId);
        },
        extraCleanup: () => {
          stopTyping();
          runningTasks.delete(taskKey);
        },
        onTaskReady: (state) => {
          runningTasks.set(taskKey, state);
        },
        sendImage: (path) => sendImageReply(chatId, path),
      }
    );
  }

  /**
   * Parse permission button value from card action (兼容多种格式)
   */
  function parsePermissionActionValue(raw: unknown): { decision: 'allow' | 'deny'; requestId: string } | null {
    if (!raw) return null;
    let buttonValue: string | undefined;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as { action?: string; value?: string };
        if (parsed.action === 'permission' && parsed.value) buttonValue = parsed.value;
        else if (raw.startsWith('allow_') || raw.startsWith('deny_')) buttonValue = raw;
      } catch {
        if (raw.startsWith('allow_') || raw.startsWith('deny_')) buttonValue = raw;
      }
    } else if (typeof raw === 'object' && raw !== null) {
      const obj = raw as { action?: string; value?: string };
      if (obj.action === 'permission' && obj.value) buttonValue = obj.value;
    }
    if (!buttonValue) return null;
    if (buttonValue.startsWith('allow_')) {
      return { decision: 'allow', requestId: buttonValue.slice(6) };
    }
    if (buttonValue.startsWith('deny_')) {
      return { decision: 'deny', requestId: buttonValue.slice(5) };
    }
    return null;
  }

  /**
   * 解析 action value（兼容对象、JSON 字符串）
   */
  function parseActionValue(raw: unknown): { action?: string; value?: string } | null {
    if (!raw) return null;
    let obj: { action?: string; value?: string } | null = null;
    if (typeof raw === 'string') {
      try {
        obj = JSON.parse(raw) as { action?: string; value?: string };
      } catch {
        return null;
      }
    } else if (typeof raw === 'object' && raw !== null) {
      obj = raw as { action?: string; value?: string };
    }
    return obj?.action && obj?.value ? obj : null;
  }

  /**
   * 从卡片回调事件中提取延时更新 token（格式 c-xxxx）
   * 飞书文档：从卡片交互返回内容获取，用于延时更新接口
   */
  function extractCardToken(data: unknown): string | null {
    const raw = data as Record<string, unknown>;
    const event = (raw?.event ?? raw) as Record<string, unknown>;
    const action = event?.action as Record<string, unknown> | undefined;
    const context = event?.context as Record<string, unknown> | undefined;
    const candidates = [
      event?.token,
      event?.open_api_token,
      raw?.token,
      action?.token,
      context?.token,
    ].filter((t): t is string => typeof t === 'string' && t.startsWith('c-'));
    const token = candidates[0] ?? null;
    if (!token) {
      log.debug('[extractCardToken] No token found, event keys:', Object.keys(event ?? {}));
    }
    return token;
  }

  /**
   * Handle card button click (card.action.trigger) - 需在 3 秒内返回响应
   * 同步只返回 toast，避免 200672；用延时更新 API 异步替换为只读卡片，防止二次点击
   */
  async function handleCardAction(
    data: unknown
  ): Promise<{ toast?: { type: string; content: string }; card?: Record<string, unknown> } | void> {
    // 兼容 SDK 可能嵌套的 event 结构
    const wrapped = data as { event?: Record<string, unknown> };
    const event = (wrapped?.event ?? data) as {
      action?: { value?: unknown };
      context?: { open_chat_id?: string; chat_id?: string; open_id?: string };
      sender?: { sender_id?: { open_id?: string } };
    };
    const actionValue = event?.action?.value;
    const chatId =
      event?.context?.open_chat_id ?? event?.context?.chat_id ?? event?.context?.open_id ?? '';
    const userId = event?.sender?.sender_id?.open_id ?? '';

    log.info(`[handleCardAction] chatId=${chatId}, userId=${userId}, actionValue=${JSON.stringify(actionValue)}`);

    // 处理 mode 按钮（兼容 value 为对象或 JSON 字符串）
    const modeAv = parseActionValue(actionValue);
    if (modeAv?.action === 'mode' && modeAv.value) {
      const mode = modeAv.value as 'ask' | 'accept-edits' | 'plan' | 'yolo';
      if (['ask', 'accept-edits', 'plan', 'yolo'].includes(mode)) {
        setPermissionMode(userId, mode);
        const toastContent = `✅ 已切换为 ${MODE_LABELS[mode]}`;
        const label = MODE_LABELS[mode];
        // 异步发送文本回复，不阻塞 3 秒内返回
        const sendReply = (): Promise<void> | void => {
          if (chatId) return sendTextReply(chatId, toastContent);
          if (userId) return sendTextReplyByOpenId(userId, toastContent);
          log.warn('[handleCardAction] No chatId/userId, cannot send text reply');
        };
        const p = sendReply();
        if (p) p.catch((e) => log.warn('[handleCardAction] Send reply failed:', e));
        // 同步只返回 toast，避免 200672（同步返回 card 格式易出错）
        const cardToken = extractCardToken(data);
        const readOnlyCard = createFeishuModeCardReadOnly(label);
        if (cardToken && userId) {
          // 延时更新：异步替换为只读卡片，防止二次点击
          delayUpdateCard(cardToken, readOnlyCard, [userId]).catch((e) =>
            log.warn('[handleCardAction] delayUpdateCard failed:', e)
          );
        } else if (!cardToken) {
          log.debug('[handleCardAction] No card token in event, cannot delay-update card');
        }
        return { toast: { type: 'success', content: toastContent } };
      }
    }

    const parsed = parsePermissionActionValue(actionValue);
    if (!parsed) {
      log.info('[handleCardAction] Unrecognized action value, returning default toast');
      return { toast: { type: 'warning', content: '未知操作' } };
    }

    const { decision, requestId } = parsed;
    log.info(`[handleCardAction] Permission button: ${decision} for ${requestId}, chatId=${chatId}`);

    const resolved = resolvePermissionById(requestId, decision);
    const toastContent = resolved
      ? decision === 'allow'
        ? '✅ 权限已允许'
        : '❌ 权限已拒绝'
      : '⚠️ 权限请求已过期或不存在';

    const sendPermReply = (): Promise<void> | void => {
      if (chatId) return sendTextReply(chatId, toastContent);
      if (userId) return sendTextReplyByOpenId(userId, toastContent);
    };
    const permP = sendPermReply();
    if (permP) permP.catch((err) => log.warn('Failed to send permission reply:', err));

    return { toast: { type: resolved ? 'success' : 'warning', content: toastContent } };
  }

  async function handleEvent(data: unknown): Promise<void | Record<string, unknown>> {
    log.info('[handleEvent] Called with data:', JSON.stringify(data).slice(0, 800));

    try {
      const raw = data as Record<string, unknown>;
      const event = (raw?.event ?? raw) as {
        event_type?: string;
        type?: string;
        action?: { action_id?: string; value?: unknown };
        message?: {
          chat_id?: string;
          message_id?: string;
          message_type?: string;
          content?: string;
          chat_type?: string;
        };
        sender?: { sender_id?: { open_id?: string } };
        context?: { open_chat_id?: string; chat_id?: string; open_id?: string };
      };

      const eventType = event?.event_type ?? event?.type;
      log.info('Feishu event type:', eventType);

      // 1. 卡片按钮点击 (card.action.trigger) - 需快速返回响应
      if (eventType === 'card.action.trigger') {
        const result = await handleCardAction(data);
        return result ?? { toast: { type: 'success', content: '已处理' } };
      }

      // 2. 消息接收 (im.message.receive_v1)
      if (eventType === 'im.message.receive_v1') {
        log.info('[handleEvent] Processing im.message.receive_v1 event');

        // 兼容：部分场景下卡片点击可能通过 im.message 携带 action
        if (event?.action?.value) {
          const parsed = parsePermissionActionValue(event.action.value);
          if (parsed) {
            const { decision, requestId } = parsed;
            const chatId = event.message?.chat_id ?? '';
            log.info(`[handleEvent] Permission (via msg): ${decision} for ${requestId}`);
            const resolved = resolvePermissionById(requestId, decision);
            if (resolved) {
              await sendTextReply(chatId, decision === 'allow' ? '✅ 权限已允许' : '❌ 权限已拒绝');
            } else {
              await sendTextReply(chatId, '⚠️ 权限请求已过期或不存在');
            }
            return;
          }
        }

      const message = event?.message;
      if (!message) {
        log.warn('No message data in event');
        return;
      }

      const chatId = message.chat_id ?? '';
      const messageId = message.message_id ?? '';
      const msgType = message.message_type;
      const contentStr = message.content ?? '{}';
      log.info(`[handleEvent] Parsed: chatId=${chatId}, msgType=${msgType}`);

      log.info(`Message: chatId=${chatId}, messageId=${messageId}, msgType=${msgType}`);

      // Parse message content
      let content: Record<string, unknown>;
      try {
        content = JSON.parse(contentStr);
        log.info(`Parsed content:`, JSON.stringify(content).slice(0, 200));
      } catch (err) {
        log.error('Failed to parse message content:', err);
        return;
      }

      // Get user ID
      const senderId = event?.sender?.sender_id?.open_id ?? '';
      if (!senderId) {
        log.warn('No sender ID in event');
        return;
      }

      log.info(`Sender ID: ${senderId}`);

      // Access control check
      if (!accessControl.isAllowed(senderId)) {
        log.warn(`Access denied for sender: ${senderId}`);
        sendTextReply(chatId, '抱歉，您没有访问权限。\n您的 ID: ' + senderId).catch(() => {});
        return;
      }

      log.info(`Access granted for sender: ${senderId}`);

      setActiveChatId('feishu', chatId);
      setChatUser(chatId, senderId);

      // Handle different message types
      if (msgType === 'text') {
        const text = (content.text as string)?.trim() ?? '';

        log.info(`[MSG] Type=text, User=${senderId}, Length=${text.length}, Content="${text}"`);
        log.info(`[MSG] Full content keys:`, Object.keys(content).join(', '));

        // Handle commands
        try {
          const handled = await commandHandler.dispatch(text, chatId, senderId, 'feishu', handleAIRequest);
          if (handled) {
            log.info(`Command handled for message: ${text}`);
            return;
          }
        } catch (err) {
          log.error('Error in commandHandler.dispatch:', err);
        }

        // Handle AI request
        log.info(`Enqueueing AI request for: ${text}`);
        const workDir = sessionManager.getWorkDir(senderId);
        const convId = sessionManager.getConvId(senderId);
        const enqueueResult = requestQueue.enqueue(senderId, convId, text, async (prompt) => {
          log.info(`Executing AI request for: ${prompt}`);
          await handleAIRequest(senderId, chatId, prompt, workDir, convId, undefined, messageId);
        });

        if (enqueueResult === 'rejected') {
          sendTextReply(chatId, '请求队列已满，请稍后再试。').catch(() => {});
        } else if (enqueueResult === 'queued') {
          sendTextReply(chatId, '您的请求已排队等待。').catch(() => {});
        }
      } else if (msgType === 'post') {
        // Feishu rich text/post messages - extract text content
        const post = (content as { post?: { content?: Array<unknown> } })?.post;
        let text = '';

        if (post?.content && Array.isArray(post.content)) {
          // Log full structure for debugging
          log.info(`[MSG] Post content structure:`, JSON.stringify(post.content).slice(0, 500));

          // Extract text from rich text structure
          for (const section of post.content) {
            if (!section || typeof section !== 'object') continue;

            const tag = (section as { tag?: string })?.tag;

            // Handle different content types
            if (tag === 'text' || tag === 'plain_text') {
              const t = (section as { text?: string })?.text ?? '';
              text += t;
            } else if (tag === 'heading' || tag === 'heading1' || tag === 'heading2' || tag === 'heading3') {
              // Handle headings - might be nested structure
              const headingText = (section as { text?: string | Array<unknown> })?.text;
              if (typeof headingText === 'string') {
                text += headingText;
              } else if (Array.isArray(headingText)) {
                // Nested text elements in heading
                for (const item of headingText) {
                  if (item && typeof item === 'object' && 'text' in item) {
                    text += (item as { text?: string }).text ?? '';
                  }
                }
              }
            } else {
              // Log unhandled tags for debugging
              log.info(`[MSG] Unhandled post tag: ${tag}, section:`, JSON.stringify(section).slice(0, 200));
            }
          }
        }

        text = text.trim();
        log.info(`[MSG] Type=post, User=${senderId}, Length=${text.length}, Content="${text}"`);

        if (!text) {
          log.warn('[MSG] Post message has no extractable text content');
          return;
        }

        // Handle commands
        try {
          const handled = await commandHandler.dispatch(text, chatId, senderId, 'feishu', handleAIRequest);
          if (handled) {
            log.info(`Command handled for post message: ${text}`);
            return;
          }
        } catch (err) {
          log.error('Error in commandHandler.dispatch for post:', err);
        }

        // Handle AI request
        log.info(`Enqueueing AI request for post message: ${text}`);
        const workDir = sessionManager.getWorkDir(senderId);
        const convId = sessionManager.getConvId(senderId);
        const enqueueResult = requestQueue.enqueue(senderId, convId, text, async (prompt) => {
          log.info(`Executing AI request for post: ${prompt}`);
          await handleAIRequest(senderId, chatId, prompt, workDir, convId, undefined, messageId);
        });

        if (enqueueResult === 'rejected') {
          sendTextReply(chatId, '请求队列已满，请稍后再试。').catch(() => {});
        } else if (enqueueResult === 'queued') {
          sendTextReply(chatId, '您的请求已排队等待。').catch(() => {});
        }
      } else if (msgType === 'image') {
        const imageKey = content.image_key as string;
        if (!imageKey) return;

        log.info(`Processing image message from ${senderId}, image_key: ${imageKey}`);

        try {
          const { getClient } = await import('./client.js');
          const c = getClient();

          let imagePath: string;
          try {
            imagePath = await downloadFeishuImage(c, imageKey);
          } catch (err) {
            log.error('Failed to download image:', err);
            sendTextReply(chatId, '图片下载失败。').catch(() => {});
            return;
          }

          const prompt = `用户发送了一张图片，已保存到 ${imagePath}。请用 Read 工具查看并分析。`;

          const workDir = sessionManager.getWorkDir(senderId);
          const convId = sessionManager.getConvId(senderId);
          requestQueue.enqueue(senderId, convId, prompt, async (p) => {
            await handleAIRequest(senderId, chatId, p, workDir, convId, undefined, messageId);
          });
        } catch (err) {
          log.error('Error processing image message:', err);
        }
      } else {
        log.warn(`[MSG] Unsupported message type: ${msgType}, senderId=${senderId}`);
        log.info(`[MSG] Content structure:`, JSON.stringify(content).slice(0, 500));
      }
    }
    } catch (err) {
      log.error('[handleEvent] Error processing event:', err);
    }
  }

  return {
    stop: () => stopTaskCleanup(),
    getRunningTaskCount: () => runningTasks.size,
    handleEvent,
  };
}
