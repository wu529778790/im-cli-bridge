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
  startTypingLoop,
  sendImageReply,
  createFeishuButtonCard,
} from './message-sender.js';
import { registerPermissionSender, resolvePermissionById } from '../hook/permission-server.js';
import { CommandHandler } from '../commands/handler.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask, type TaskRunState } from '../shared/ai-task.js';
import { startTaskCleanup } from '../shared/task-cleanup.js';
import { THROTTLE_MS, IMAGE_DIR, MAX_FEISHU_MESSAGE_LENGTH } from '../constants.js';
import { setActiveChatId } from '../shared/active-chats.js';
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
  handleEvent: (data: unknown) => Promise<void>;
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
    sender: { sendTextReply },
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

  async function handleEvent(data: unknown): Promise<void> {
    log.info('[handleEvent] Called with data:', JSON.stringify(data).slice(0, 500));

    try {
      log.info('[handleEvent] Starting processing');
      // Parse the event data
    // Feishu event structure (long connection mode):
    // {
    //   "event_type": "im.message.receive_v1",
    //   "event_id": "...",
    //   "tenant_key": "...",
    //   "app_id": "...",
    //   "message": { "chat_id": "...", "content": "...", ... },
    //   "sender": { "sender_id": { "open_id": "..." } }
    //   "action": {  // For card button clicks
    //     "action_id": "...",
    //     "value": { "action": "permission", "value": "allow_xxx" }
    //   }
    // }
    const event = data as {
      event_type?: string;
      action?: {
        action_id?: string;
        value?: Record<string, unknown>;
      };
      message?: {
        chat_id?: string;
        message_id?: string;
        message_type?: string;
        content?: string;
        chat_type?: string;
      };
      sender?: {
        sender_id?: {
          open_id?: string;
        };
      };
    };

    const eventType = event?.event_type;
    log.info('Feishu event type:', eventType);

    // Handle message received events
    if (eventType === 'im.message.receive_v1') {
      log.info('[handleEvent] Processing im.message.receive_v1 event');

      // Check if this is a card button click event
      // For interactive cards, the action is in a different location
      if (event?.action) {
        const action = event.action as {
          action_id?: string;
          value?: Record<string, unknown>;
        };
        log.info('[handleEvent] Card action detected:', action);

        if (action?.value) {
          const actionValue = action.value as { action?: string; value?: string };
          if (actionValue.action === 'permission' && actionValue.value) {
            const buttonValue = actionValue.value;
            let decision: 'allow' | 'deny' | null = null;
            let requestId: string | null = null;

            if (buttonValue.startsWith('allow_')) {
              decision = 'allow';
              requestId = buttonValue.slice(6);
            } else if (buttonValue.startsWith('deny_')) {
              decision = 'deny';
              requestId = buttonValue.slice(5);
            }

            if (decision && requestId) {
              log.info(`[handleEvent] Permission button clicked: ${decision} for ${requestId}`);
              const resolved = resolvePermissionById(requestId, decision);
              const chatId = event.message?.chat_id ?? '';
              if (resolved) {
                await sendTextReply(chatId, decision === 'allow' ? '✅ 权限已允许' : '❌ 权限已拒绝');
              } else {
                await sendTextReply(chatId, '⚠️ 权限请求已过期或不存在');
              }
              return;
            }
          }
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
