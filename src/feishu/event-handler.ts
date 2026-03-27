import { Client } from '@larksuiteoapi/node-sdk';
import { resolvePlatformAiCommand, type Config } from '../config.js';
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
  sendThinkingCard,
  streamContentUpdate,
  sendFinalCards,
  sendErrorCard,
} from './message-sender.js';
import { CommandHandler } from '../commands/handler.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask, type TaskRunState } from '../shared/ai-task.js';
import { buildCardV2 } from './card-builder.js';
import { disableStreaming, updateCardFull, destroySession } from './cardkit-manager.js';
import { startTaskCleanup } from '../shared/task-cleanup.js';
import { CARDKIT_THROTTLE_MS } from '../constants.js';
import { setActiveChatId } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import { createLogger } from '../logger.js';
import { createMediaTargetPath } from '../shared/media-storage.js';
import { buildSavedMediaPrompt } from '../shared/media-analysis-prompt.js';
import { buildMediaContext } from '../shared/media-context.js';
import { buildProgressNote } from '../shared/message-note.js';

const log = createLogger('FeishuHandler');

type FeishuResourceType = 'image' | 'file' | 'media';

async function downloadFeishuMessageResource(
  client: Client,
  messageId: string,
  fileKey: string,
  type: FeishuResourceType,
  options?: { basenameHint?: string; fallbackExtension?: string },
): Promise<string> {
  const targetPath = createMediaTargetPath(options?.fallbackExtension ?? 'bin', options?.basenameHint ?? fileKey);
  const response = await client.im.messageResource.get({
    params: { type },
    path: {
      message_id: messageId,
      file_key: fileKey,
    },
  });
  await response.writeFile(targetPath);
  return targetPath;
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
    sender: { sendTextReply },
    getRunningTasksSize: () => runningTasks.size,
  });

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
    const aiCommand = resolvePlatformAiCommand(config, 'feishu');
    const toolAdapter = getAdapter(aiCommand);
    if (!toolAdapter) {
      log.error(`[handleAIRequest] No adapter found for: ${aiCommand}`);
      await sendTextReply(chatId, `未配置 AI 工具: ${aiCommand}`);
      return;
    }

    log.info(`[handleAIRequest] Adapter found, getting session...`);
    const sessionId = convId ? sessionManager.getSessionIdForConv(userId, convId, aiCommand) : undefined;
    log.info(`[handleAIRequest] Running ${aiCommand} for user ${userId}, sessionId=${sessionId ?? 'new'}`);

    const toolId = aiCommand;

    // 使用 CardKit 打字机效果（80ms 节流，约 12 次/秒，比 patch 5 QPS 更流畅）
    let cardHandle: { messageId: string; cardId: string };
    try {
      cardHandle = await sendThinkingCard(chatId, toolId);
    } catch (err) {
      log.error('Failed to send thinking card:', err);
      try {
        await sendTextReply(chatId, '启动 AI 处理失败，请重试。');
      } catch { /* ignore */ }
      return;
    }

    const { messageId: msgId, cardId } = cardHandle;
    const stopTyping = startTypingLoop(chatId);
    const taskKey = `${userId}:${cardId}`;

    let consecutiveStreamErrors = 0;
    const MAX_STREAM_ERRORS = 5;
    const streamUpdate = (content: string, toolNote?: string) => {
      if (consecutiveStreamErrors >= MAX_STREAM_ERRORS) return; // 停止尝试
      const note = buildProgressNote(toolNote);
      streamContentUpdate(cardId, content, note).then(() => {
        consecutiveStreamErrors = 0;
      }).catch((e) => {
        consecutiveStreamErrors++;
        if (consecutiveStreamErrors >= MAX_STREAM_ERRORS) {
          log.warn(`Stream update failed ${consecutiveStreamErrors} times consecutively, giving up: ${e?.message ?? e}`);
        } else {
          log.debug('Stream update failed (will retry on next update):', e?.message ?? e);
        }
      });
    };

    await runAITask(
      { config, sessionManager },
      { userId, chatId, workDir, sessionId, convId, platform: 'feishu', taskKey },
      prompt,
      toolAdapter,
      {
        throttleMs: CARDKIT_THROTTLE_MS,
        streamUpdate,
        sendComplete: async (content, note, thinkingText) => {
          await sendFinalCards(chatId, msgId, cardId, content, note ?? '', thinkingText, toolId);
        },
        sendError: async (error) => {
          await sendErrorCard(cardId, error);
        },
        extraCleanup: () => {
          stopTyping();
          runningTasks.delete(taskKey);
        },
        onTaskReady: (state) => {
          runningTasks.set(taskKey, state);
        },
        onThinkingToText: (content) => {
          const resetCard = buildCardV2({ content: content || '...', status: 'streaming', toolName: toolId }, cardId);
          updateCardFull(cardId, resetCard).catch((e) =>
            log.warn('Thinking→text transition update failed:', e?.message ?? e)
          );
        },
        sendImage: (path) => sendImageReply(chatId, path),
      }
    );
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
      operator?: { open_id?: string };
    };
    const actionValue = event?.action?.value;
    const chatId =
      event?.context?.open_chat_id ?? event?.context?.chat_id ?? event?.context?.open_id ?? '';
    const userId = event?.sender?.sender_id?.open_id ?? event?.operator?.open_id ?? '';

    log.info(`[handleCardAction] chatId=${chatId}, userId=${userId}, actionValue=${JSON.stringify(actionValue)}`);

    // 处理 CardKit 停止按钮
    type StopAction = { action?: string; card_id?: string };
    let actionData: StopAction | null = null;
    try {
      let parsed: unknown = actionValue;
      if (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
        if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      }
      actionData = parsed as StopAction;
    } catch {
      /* ignore */
    }
    if (actionData?.action === 'stop' && actionData.card_id) {
      const cardId = actionData.card_id;
      const taskKey = `${userId}:${cardId}`;
      const taskInfo = runningTasks.get(taskKey);
      if (taskInfo) {
        log.info(`User ${userId} stopped task for card ${cardId}`);
        const stoppedContent = taskInfo.latestContent || '(任务已停止，暂无输出)';
        runningTasks.delete(taskKey);
        taskInfo.settle();
        taskInfo.handle.abort();
        const stoppedCard = buildCardV2({ content: stoppedContent, status: 'done', note: '⏹️ 已停止', toolName: taskInfo.toolId });
        disableStreaming(cardId)
          .then(() => updateCardFull(cardId, stoppedCard))
          .catch((e) => log.warn('Stop card update failed:', e?.message ?? e))
          .finally(() => destroySession(cardId));
      } else {
        log.warn(`No running task found for key: ${taskKey}`);
      }
      return { toast: { type: 'success', content: '已停止' } };
    }

    log.info('[handleCardAction] Unrecognized action value');
    return { toast: { type: 'warning', content: '未知操作' } };
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
        sendTextReply(chatId, '抱歉，您没有访问权限。\n您的 ID: ' + senderId).catch((err) => {
          log.warn('[feishu] Failed to send access denied message:', err);
        });
        return;
      }

      log.info(`Access granted for sender: ${senderId}`);

      setActiveChatId('feishu', chatId);
      setChatUser(chatId, senderId, 'feishu');

      // Handle different message types
      if (msgType === 'text') {
        // 飞书 text 消息的 content.text 可能是 HTML（如 <p>...</p>），并且包含空格 / &nbsp;
        // 这里做一次轻量级清洗，保证空格和文本都被完整保留，而不是被简单截断。
        const rawText = (content.text as string) ?? '';
        let text = rawText;

        // 去掉最常见的段落标签，保留内容
        text = text.replace(/<\/?p[^>]*>/gi, '');
        // 将 <br> 转成换行
        text = text.replace(/<br\s*\/?>/gi, '\n');
        // 将 &nbsp; 等价替换为空格
        text = text.replace(/&nbsp;/gi, ' ');

        // 最后做一次首尾 trim，但不动中间的空格
        text = text.trim();

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
          sendTextReply(chatId, '请求队列已满，请稍后再试。').catch((err) => {
            log.warn('[feishu] Failed to send queue full message:', err);
          });
        } else if (enqueueResult === 'queued') {
          sendTextReply(chatId, '您的请求已排队等待。').catch((err) => {
            log.warn('[feishu] Failed to send queue waiting message:', err);
          });
        }
      } else if (msgType === 'post') {
        // Feishu rich text/post messages - extract text content
        // 支持 post.content 或 zh_cn.content，content 可能是二维数组（段落→元素）
        const post = (content as { post?: { content?: Array<unknown> }; zh_cn?: { content?: Array<unknown> } })?.post
          ?? (content as { zh_cn?: { content?: Array<unknown> } })?.zh_cn;
        const rawContent = post?.content;
        let text = '';

        function extractTextFromElement(el: unknown): string {
          if (!el || typeof el !== 'object') return '';
          const obj = el as { tag?: string; text?: string; content?: string };
          const tag = obj.tag;
          if (tag === 'text' || tag === 'plain_text') {
            return (obj.text ?? obj.content ?? '').toString();
          }
          if (tag === 'a') return (obj.text ?? obj.content ?? '').toString();
          if (tag === 'heading' || tag === 'heading1' || tag === 'heading2' || tag === 'heading3') {
            const headingText = (el as { text?: string | Array<unknown> }).text;
            if (typeof headingText === 'string') return headingText;
            if (Array.isArray(headingText)) {
              return headingText.map(extractTextFromElement).join('');
            }
          }
          return '';
        }

        if (rawContent && Array.isArray(rawContent)) {
          log.info(`[MSG] Post content structure:`, JSON.stringify(rawContent).slice(0, 500));

          for (const section of rawContent) {
            if (Array.isArray(section)) {
              // 二维数组：段落内多个元素
              for (const el of section) {
                text += extractTextFromElement(el);
              }
            } else {
              text += extractTextFromElement(section);
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
          sendTextReply(chatId, '请求队列已满，请稍后再试。').catch((err) => {
            log.warn('[feishu] Failed to send queue full message:', err);
          });
        } else if (enqueueResult === 'queued') {
          sendTextReply(chatId, '您的请求已排队等待。').catch((err) => {
            log.warn('[feishu] Failed to send queue waiting message:', err);
          });
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
            imagePath = await downloadFeishuMessageResource(c, messageId, imageKey, 'image', {
              basenameHint: imageKey.slice(-8),
              fallbackExtension: 'jpg',
            });
          } catch (err) {
            log.error('Failed to download image:', err);
            sendTextReply(chatId, '图片下载失败。').catch((err) => {
              log.warn('[feishu] Failed to send image download failed message:', err);
            });
            return;
          }

          const prompt = buildSavedMediaPrompt({
            source: 'Feishu',
            kind: 'image',
            localPath: imagePath,
            text: buildMediaContext({
              ImageKey: imageKey,
            }),
          });

          const workDir = sessionManager.getWorkDir(senderId);
          const convId = sessionManager.getConvId(senderId);
          const enqueueResult = requestQueue.enqueue(senderId, convId, prompt, async (p) => {
            await handleAIRequest(senderId, chatId, p, workDir, convId, undefined, messageId);
          });
          if (enqueueResult === 'rejected') {
            sendTextReply(chatId, 'Request queue is full. Please try again later.').catch((sendErr) => {
              log.warn('[feishu] Failed to send queue full message for image:', sendErr);
            });
          } else if (enqueueResult === 'queued') {
            sendTextReply(chatId, 'Your request is queued.').catch((sendErr) => {
              log.warn('[feishu] Failed to send queued message for image:', sendErr);
            });
          }
        } catch (err) {
          log.error('Error processing image message:', err);
        }
      } else if (msgType === 'file' || msgType === 'media') {
        const fileKey = content.file_key as string | undefined;
        if (!fileKey) {
          log.warn(`[MSG] Feishu ${msgType} message missing file_key`);
          return;
        }

        log.info(`Processing ${msgType} message from ${senderId}, file_key: ${fileKey}`);

        try {
          const { getClient } = await import('./client.js');
          const c = getClient();
          const fileName = (content.file_name as string | undefined) ?? (content.name as string | undefined);
          const duration = content.duration as number | undefined;
          const fileSize = content.file_size as number | undefined;
          const savedPath = await downloadFeishuMessageResource(c, messageId, fileKey, msgType, {
            basenameHint: fileName ?? fileKey.slice(-8),
            fallbackExtension: msgType === 'media' ? 'mp4' : 'bin',
          });

          const prompt = buildSavedMediaPrompt({
            source: 'Feishu',
            kind: msgType,
            localPath: savedPath,
            text: buildMediaContext({
              FileName: fileName,
              FileKey: fileKey,
              Duration: duration,
              Size: fileSize,
            }),
          });

          const workDir = sessionManager.getWorkDir(senderId);
          const convId = sessionManager.getConvId(senderId);
          const enqueueResult = requestQueue.enqueue(senderId, convId, prompt, async (p) => {
            await handleAIRequest(senderId, chatId, p, workDir, convId, undefined, messageId);
          });
          if (enqueueResult === 'rejected') {
            sendTextReply(chatId, 'Request queue is full. Please try again later.').catch((sendErr) => {
              log.warn(`[feishu] Failed to send queue full message for ${msgType}:`, sendErr);
            });
          } else if (enqueueResult === 'queued') {
            sendTextReply(chatId, 'Your request is queued.').catch((sendErr) => {
              log.warn(`[feishu] Failed to send queued message for ${msgType}:`, sendErr);
            });
          }
        } catch (err) {
          log.error(`Error processing ${msgType} message:`, err);
          sendTextReply(chatId, `${msgType} 资源下载失败。`).catch((sendErr) => {
            log.warn(`[feishu] Failed to send ${msgType} download failed message:`, sendErr);
          });
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
