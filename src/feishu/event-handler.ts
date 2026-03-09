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
} from './message-sender.js';
import { registerPermissionSender, resolvePermissionById } from '../hook/permission-server.js';
import { CommandHandler } from '../commands/handler.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask, type TaskRunState } from '../shared/ai-task.js';
import { startTaskCleanup } from '../shared/task-cleanup.js';
import { MessageDedup } from '../shared/message-dedup.js';
import { THROTTLE_MS, IMAGE_DIR } from '../constants.js';
import { setActiveChatId } from '../shared/active-chats.js';
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

  // Get the image download URL
  const resourceResp = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages/${imageKey}/resources`,
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

export interface FeishuEventHandlerHandle {
  stop: () => void;
  getRunningTaskCount: () => number;
  handleEvent: (data: unknown) => void;
}

export function setupFeishuHandlers(
  config: Config,
  sessionManager: SessionManager
): FeishuEventHandlerHandle {
  const accessControl = new AccessControl(config.allowedUserIds);
  const requestQueue = new RequestQueue();
  const userCosts = new Map<string, { totalCost: number; totalDurationMs: number; requestCount: number }>();
  const runningTasks = new Map<string, TaskRunState>();
  const stopTaskCleanup = startTaskCleanup(runningTasks);
  const dedup = new MessageDedup();

  const commandHandler = new CommandHandler({
    config,
    sessionManager,
    requestQueue,
    sender: { sendTextReply },
    userCosts,
    getRunningTasksSize: () => runningTasks.size,
  });

  registerPermissionSender('feishu', {});

  async function handleAIRequest(
    userId: string,
    chatId: string,
    prompt: string,
    workDir: string,
    convId?: string,
    _threadCtx?: { rootMessageId: string; threadId: string },
    replyToMessageId?: string
  ) {
    const toolAdapter = getAdapter(config.aiCommand);
    if (!toolAdapter) {
      await sendTextReply(chatId, `未配置 AI 工具: ${config.aiCommand}`);
      return;
    }

    const sessionId = convId ? sessionManager.getSessionIdForConv(userId, convId) : undefined;
    log.info(`Running ${config.aiCommand} for user ${userId}, sessionId=${sessionId ?? 'new'}`);

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
      { config, sessionManager, userCosts },
      { userId, chatId, workDir, sessionId, convId, platform: 'feishu', taskKey },
      prompt,
      toolAdapter,
      {
        throttleMs: THROTTLE_MS,
        streamUpdate: (content, toolNote) => {
          // TODO: Message update is currently broken for Feishu
          // Skipping streaming updates for now - final result will be sent as new message
          const note = toolNote ? '输出中...\n' + toolNote : '输出中...';
          log.debug('Skipping stream update for Feishu:', note);
          // updateMessage(chatId, msgId, content, 'streaming', note, toolId).catch(() => {});
        },
        sendComplete: async (content, note) => {
          // For Feishu, send the final result as a new message instead of updating
          // This is because message.update API has strict validation requirements
          await sendTextReply(chatId, content);
        },
        sendError: async (error) => {
          await sendTextReply(chatId, `错误：${error}`);
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

  function handleEvent(data: unknown): void {
    log.info('Feishu handleEvent called, data:', JSON.stringify(data).slice(0, 500));

    // Parse the event data
    // Feishu event structure (long connection mode):
    // {
    //   "event_type": "im.message.receive_v1",
    //   "event_id": "...",
    //   "tenant_key": "...",
    //   "app_id": "...",
    //   "message": { "chat_id": "...", "content": "...", ... },
    //   "sender": { "sender_id": { "open_id": "..." } }
    // }
    const event = data as {
      event_type?: string;
      message?: {
        chat_id?: string;
        message_id?: string;
        msg_type?: string;
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
      const message = event?.message;
      if (!message) return;

      const chatId = message.chat_id ?? '';
      const messageId = message.message_id ?? '';
      const msgType = message.message_type;
      const contentStr = message.content ?? '{}';

      // Parse message content
      let content: Record<string, unknown>;
      try {
        content = JSON.parse(contentStr);
      } catch {
        return;
      }

      // Get user ID
      const senderId = event?.sender?.sender_id?.open_id ?? '';
      if (!senderId) return;

      // Dedup check
      if (dedup.isDuplicate(`${chatId}:${messageId}`)) return;

      // Access control check
      if (!accessControl.isAllowed(senderId)) {
        sendTextReply(chatId, '抱歉，您没有访问权限。\n您的 ID: ' + senderId).catch(() => {});
        return;
      }

      setActiveChatId('feishu', chatId);

      // Handle different message types
      if (msgType === 'text') {
        const text = (content.text as string)?.trim() ?? '';

        // Handle commands
        commandHandler.dispatch(text, chatId, senderId, 'feishu', handleAIRequest).then((handled) => {
          if (handled) return;

          // Handle AI request
          const workDir = sessionManager.getWorkDir(senderId);
          const convId = sessionManager.getConvId(senderId);
          const enqueueResult = requestQueue.enqueue(senderId, convId, text, async (prompt) => {
            await handleAIRequest(senderId, chatId, prompt, workDir, convId, undefined, messageId);
          });

          if (enqueueResult === 'rejected') {
            sendTextReply(chatId, '请求队列已满，请稍后再试。').catch(() => {});
          } else if (enqueueResult === 'queued') {
            sendTextReply(chatId, '您的请求已排队等待。').catch(() => {});
          }
        });
      } else if (msgType === 'image') {
        const imageKey = content.image_key as string;
        if (!imageKey) return;

        const client = (async () => (await import('./client.js')).getClient())();

        client.then(async (c) => {
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
        });
      }
    }
  }

  return {
    stop: () => stopTaskCleanup(),
    getRunningTaskCount: () => runningTasks.size,
    handleEvent,
  };
}
