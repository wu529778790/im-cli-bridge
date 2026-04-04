import { Client } from '@larksuiteoapi/node-sdk';
import { resolvePlatformAiCommand, type Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import {
  sendTextReply,
  startTypingLoop,
  sendImageReply,
  sendThinkingCard,
  streamContentUpdate,
  sendFinalCards,
  sendErrorCard,
} from './message-sender.js';
import { buildCardV2 } from './card-builder.js';
import { disableStreaming, updateCardFull, destroySession } from './cardkit-manager.js';
import { CARDKIT_THROTTLE_MS } from '../constants.js';
import { createLogger } from '../logger.js';
import { createMediaTargetPath } from '../shared/media-storage.js';
import { buildSavedMediaPrompt } from '../shared/media-analysis-prompt.js';
import { buildMediaContext } from '../shared/media-context.js';
import { buildProgressNote } from '../shared/message-note.js';
import { createPlatformEventContext } from '../platform/create-event-context.js';
import { createPlatformAIRequestHandler, type PlatformSender } from '../platform/handle-ai-request.js';
import { handleTextFlow } from '../platform/handle-text-flow.js';
import { isPermissionError, handlePermissionError } from './permission.js';

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
  runningTasks: Map<string, import('../shared/ai-task.js').TaskRunState>;
  getRunningTaskCount: () => number;
  handleEvent: (data: unknown) => Promise<void | Record<string, unknown>>;
}

export function setupFeishuHandlers(
  config: Config,
  sessionManager: SessionManager
): FeishuEventHandlerHandle {
  // Create shared platform event context
  const ctx = createPlatformEventContext({
    platform: 'feishu',
    allowedUserIds: config.feishuAllowedUserIds,
    config,
    sessionManager,
    sender: { sendTextReply },
  });

  // Feishu-specific streaming state for error recovery
  let consecutiveStreamErrors = 0;
  const MAX_STREAM_ERRORS = 5;

  // Feishu uses cardId as task key (not msgId)
  const taskKeyBuilder = (userId: string, msgId: string) => `${userId}:${msgId}`;

  // Feishu-specific sender callbacks
  const platformSender: PlatformSender = {
    sendThinkingMessage: async (chatId, replyToMessageId, toolId) => {
      const MAX_SEND_RETRIES = 3;
      for (let attempt = 1; attempt <= MAX_SEND_RETRIES; attempt++) {
        try {
          const cardHandle = await sendThinkingCard(chatId, toolId);
          // Feishu returns { messageId, cardId }, use cardId as message ID for task tracking
          return cardHandle.cardId;
        } catch (err) {
          const isRetryable = err && typeof err === 'object' && 'code' in err &&
            ((err as {code?: string}).code === 'ETIMEDOUT' || (err as {code?: string}).code === 'ECONNRESET' || (err as {code?: string}).code === 'ECONNREFUSED');
          if (isRetryable && attempt < MAX_SEND_RETRIES) {
            log.warn(`sendThinkingCard attempt ${attempt}/${MAX_SEND_RETRIES} failed (${(err as {code?: string}).code}), retrying...`);
            await new Promise((r) => setTimeout(r, 1000 * attempt));
            continue;
          }
          log.error(`Failed to send thinking card after ${attempt} attempts:`, err);
          // 检测权限错误并输出友好提示
          if (isPermissionError(err)) {
            handlePermissionError(err, chatId);
          }
          throw err;
        }
      }
      throw new Error('Failed to send thinking card after retries');
    },
    sendTextReply: async (chatId, text) => {
      await sendTextReply(chatId, text);
    },
    startTyping: (chatId) => startTypingLoop(chatId),
    sendImage: async (chatId, imagePath) => {
      await sendImageReply(chatId, imagePath);
    },
  };

  // Create platform-specific AI request handler
  const handleAIRequest = createPlatformAIRequestHandler({
    platform: 'feishu',
    config,
    sessionManager,
    sender: platformSender,
    throttleMs: CARDKIT_THROTTLE_MS,
    runningTasks: ctx.runningTasks,
    taskKeyBuilder,
    onThinkingToText: (content) => {
      // CardKit: transition from thinking to text
      const cardId = ''; // Will be extracted from taskKey
      const resetCard = buildCardV2({ content: content || '...', status: 'streaming', toolName: resolvePlatformAiCommand(config, 'feishu') }, cardId);
      updateCardFull(cardId, resetCard).catch((e) =>
        log.warn('Thinking→text transition update failed:', e?.message ?? e)
      );
    },
    taskCallbacksFactory: ({ chatId, msgId: cardId, toolId }) => ({
      streamUpdate: async (content, toolNote) => {
        if (consecutiveStreamErrors >= MAX_STREAM_ERRORS) return;
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
      },
      sendComplete: async (content, note, thinkingText) => {
        await sendFinalCards(chatId, '', cardId, content, note ?? '', thinkingText, toolId);
      },
      sendError: async (error) => {
        await sendErrorCard(cardId, error);
      },
    }),
  });

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
    } catch (err) {
      log.debug('Failed to parse card action data:', err);
    }
    if (actionData?.action === 'stop' && actionData.card_id) {
      const cardId = actionData.card_id;
      const taskKey = `${userId}:${cardId}`;
      const taskInfo = ctx.runningTasks.get(taskKey);
      if (taskInfo) {
        log.info(`User ${userId} stopped task for card ${cardId}`);
        const stoppedContent = taskInfo.latestContent || '(任务已停止，暂无输出)';
        ctx.runningTasks.delete(taskKey);
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
    log.debug('[handleEvent] Called with data:', JSON.stringify(data).slice(0, 800));

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

        // Use shared text flow for text/post messages
        if (msgType === 'text' || msgType === 'post') {
          let text = '';

          if (msgType === 'text') {
            // 飞书 text 消息的 content.text 可能是 HTML（如 <p>...</p>），并且包含空格 / &nbsp;
            // 这里做一次轻量级清洗，保证空格和文本都被完整保留，而不是被简单截断。
            const rawText = (content.text as string) ?? '';
            text = rawText;

            // 去掉最常见的段落标签，保留内容
            text = text.replace(/<\/?p[^>]*>/gi, '');
            // 将 <br> 转成换行
            text = text.replace(/<br\s*\/?>/gi, '\n');
            // 将 &nbsp; 等价替换为空格
            text = text.replace(/&nbsp;/gi, ' ');

            // 最后做一次首尾 trim，但不动中间的空格
            text = text.trim();

            log.info(`[MSG] Type=text, User=${senderId}, Length=${text.length}, Content="${text}"`);
          } else if (msgType === 'post') {
            // Feishu rich text/post messages - extract text content
            // 支持 post.content 或 zh_cn.content，content 可能是二维数组（段落→元素）
            const post = (content as { post?: { content?: Array<unknown> }; zh_cn?: { content?: Array<unknown> } })?.post
              ?? (content as { zh_cn?: { content?: Array<unknown> } })?.zh_cn;
            const rawContent = post?.content;

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
          }

          if (!text) {
            log.warn(`[MSG] ${msgType} message has no extractable text content`);
            return;
          }

          // Use shared text flow
          await handleTextFlow({
            platform: 'feishu',
            userId: senderId,
            chatId,
            text,
            ctx,
            handleAIRequest,
            sendTextReply,
            replyToMessageId: messageId,
            workDir: sessionManager.getWorkDir(senderId),
            convId: sessionManager.getConvId(senderId),
          });
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

            const work = sessionManager.getWorkDir(senderId);
            const convId = sessionManager.getConvId(senderId);
            const enqueueResult = ctx.requestQueue.enqueue(senderId, convId, prompt, async (p, signal) => {
              await handleAIRequest({ userId: senderId, chatId, prompt: p, workDir: work, convId, replyToMessageId: messageId, signal });
            });
            if (enqueueResult === 'rejected') {
              sendTextReply(chatId, '请求队列已满，请稍后再试。').catch((sendErr) => {
                log.warn('[feishu] Failed to send queue full message for image:', sendErr);
              });
            } else if (enqueueResult === 'queued') {
              sendTextReply(chatId, '您的请求已排队等待。').catch((sendErr) => {
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
            const enqueueResult = ctx.requestQueue.enqueue(senderId, convId, prompt, async (p, signal) => {
              await handleAIRequest({ userId: senderId, chatId, prompt: p, workDir, convId, replyToMessageId: messageId, signal });
            });
            if (enqueueResult === 'rejected') {
              sendTextReply(chatId, '请求队列已满，请稍后再试。').catch((sendErr) => {
                log.warn(`[feishu] Failed to send queue full message for ${msgType}:`, sendErr);
              });
            } else if (enqueueResult === 'queued') {
              sendTextReply(chatId, '您的请求已排队等待。').catch((sendErr) => {
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
    stop: () => {},
    runningTasks: ctx.runningTasks,
    getRunningTaskCount: () => ctx.runningTasks.size,
    handleEvent,
  };
}
