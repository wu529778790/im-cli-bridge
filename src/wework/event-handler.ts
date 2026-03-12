/**
 * WeWork (企业微信) Event Handler - Handle WeWork message events
 */

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
  sendPermissionCard,
  sendModeCard,
  setCurrentReqId,
} from './message-sender.js';
import { registerPermissionSender } from '../hook/permission-server.js';
import { setPermissionMode } from '../permission-mode/session-mode.js';
import { MODE_LABELS } from '../permission-mode/types.js';
import { CommandHandler } from '../commands/handler.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask, type TaskRunState } from '../shared/ai-task.js';
import { startTaskCleanup } from '../shared/task-cleanup.js';
import { WEWORK_THROTTLE_MS } from '../constants.js';
import { setActiveChatId } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import { createLogger } from '../logger.js';
import type { ThreadContext } from '../shared/types.js';
import type { WeWorkCallbackMessage } from './types.js';

const log = createLogger('WeWorkHandler');

export interface WeWorkEventHandlerHandle {
  stop: () => void;
  getRunningTaskCount: () => number;
  handleEvent: (data: WeWorkCallbackMessage) => Promise<void>;
}

export function setupWeWorkHandlers(
  config: Config,
  sessionManager: SessionManager
): WeWorkEventHandlerHandle {
  const accessControl = new AccessControl(config.weworkAllowedUserIds);
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

  registerPermissionSender('wework', { sendTextReply, sendPermissionCard });

  async function handleAIRequest(
    userId: string,
    chatId: string,
    prompt: string,
    workDir: string,
    convId?: string,
    _threadCtx?: { rootMessageId: string; threadId: string },
    replyToMessageId?: string,
    reqId?: string
  ) {
    log.info(`[AI_REQUEST] userId=${userId}, chatId=${chatId}, promptLength=${prompt.length}`);
    if (reqId) setCurrentReqId(reqId);

    try {
    const toolAdapter = getAdapter(config.aiCommand);
    if (!toolAdapter) {
      log.error(`[handleAIRequest] No adapter found for: ${config.aiCommand}`);
      await sendTextReply(chatId, `未配置 AI 工具: ${config.aiCommand}`, reqId);
      return;
    }

    const sessionId = convId ? sessionManager.getSessionIdForConv(userId, convId, config.aiCommand) : undefined;
    log.info(`[handleAIRequest] Running ${config.aiCommand} for user ${userId}, sessionId=${sessionId ?? 'new'}`);

    const toolId = config.aiCommand;
    let msgId: string;
    try {
      msgId = await sendThinkingMessage(chatId, replyToMessageId, toolId, reqId);
    } catch (err) {
      log.error('Failed to send thinking message:', err);
      return;
    }

    const stopTyping = startTypingLoop(chatId);
    const taskKey = `${userId}:${msgId}`;

    await runAITask(
      { config, sessionManager },
      { userId, chatId, workDir, sessionId, convId, platform: 'wework', taskKey },
      prompt,
      toolAdapter,
      {
        throttleMs: WEWORK_THROTTLE_MS,
        streamUpdate: async (content, toolNote) => {
          const note = toolNote ? '输出中...\n' + toolNote : '输出中...';
          try {
            await updateMessage(chatId, msgId, content, 'streaming', note, toolId, reqId);
          } catch (err) {
            log.debug('Stream update failed:', err);
          }
        },
        sendComplete: async (content, note) => {
          await sendFinalMessages(chatId, msgId, content, note ?? '', toolId, reqId);
        },
        sendError: async (error) => {
          await updateMessage(chatId, msgId, `错误：${error}`, 'error', '执行失败', toolId, reqId);
        },
        extraCleanup: () => {
          stopTyping();
          runningTasks.delete(taskKey);
        },
        onTaskReady: (state) => {
          runningTasks.set(taskKey, state);
        },
        sendImage: async (path) => {
          // WeWork image handling
          await sendTextReply(chatId, `图片已保存: ${path}`, reqId);
        },
      }
    );
    } finally {
      setCurrentReqId(null);
    }
  }

  /**
   * Extract text content from WeWork message body
   */
  function extractTextContent(data: WeWorkCallbackMessage): string {
    const body = data.body;

    // Direct text message
    if (body.msgtype === 'text' && body.text?.content) {
      return body.text.content.trim();
    }

    // Mixed message (text + images)
    if (body.msgtype === 'mixed' && body.mixed?.msg_item) {
      const textItems = body.mixed.msg_item
        .filter(item => item.msgtype === 'text' && item.text?.content)
        .map(item => item.text!.content)
        .join('\n');
      return textItems;
    }

    return '';
  }

  /**
   * Extract image content from WeWork message body
   */
  function extractImageContent(data: WeWorkCallbackMessage): { url?: string; base64?: string } | null {
    const body = data.body;

    // Direct image message
    if (body.msgtype === 'image' && body.image) {
      return {
        url: body.image.url,
        base64: body.image.base64,
      };
    }

    // Mixed message with images
    if (body.msgtype === 'mixed' && body.mixed?.msg_item) {
      const firstImage = body.mixed.msg_item.find(item => item.msgtype === 'image' && item.image);
      if (firstImage?.image) {
        return {
          url: firstImage.image.url,
          base64: firstImage.image.base64,
        };
      }
    }

    return null;
  }

  /**
   * Handle incoming WeWork callback event
   */
  async function handleEvent(data: WeWorkCallbackMessage): Promise<void> {
    log.info('[handleEvent] Called with data:', JSON.stringify(data).slice(0, 800));

    const reqId = data.headers?.req_id ?? '';
    setCurrentReqId(reqId);

    try {
      const body = data.body;
      const msgType = body.msgtype;
      const fromUser = body.from.userid;
      // 单聊时 chatid 可能不返回，用 userid 作为会话标识
      const chatId = body.chatid ?? fromUser;
      const chatType = body.chattype;

      log.info(`WeWork event: msgType=${msgType}, from=${fromUser}, chatId=${chatId}, chatType=${chatType}`);

      // Access control check
      if (!accessControl.isAllowed(fromUser)) {
        log.warn(`Access denied for sender: ${fromUser}`);
        await sendTextReply(fromUser, `抱歉，您没有访问权限。\n您的 ID: ${fromUser}`, reqId);
        return;
      }

      log.info(`Access granted for sender: ${fromUser}`);

      setActiveChatId('wework', fromUser);
      setChatUser(fromUser, fromUser, 'wework');

      // Handle text messages
      if (msgType === 'text' || msgType === 'mixed') {
        const text = extractTextContent(data);

        if (!text) {
          log.debug('[MSG] No text content found in message');
          return;
        }

        log.info(`[MSG] Type=${msgType}, User=${fromUser}, Length=${text.length}, Content="${text}"`);

        // Handle commands (sync, uses setCurrentReqId)
        try {
          const handleAIRequestWithReqId = (u: string, c: string, p: string, w: string, conv?: string, tc?: ThreadContext, replyTo?: string) =>
            handleAIRequest(u, c, p, w, conv, tc, replyTo, reqId);
          const handled = await commandHandler.dispatch(text, fromUser, fromUser, 'wework', handleAIRequestWithReqId);
          if (handled) {
            log.info(`Command handled for message: ${text}`);
            return;
          }
        } catch (err) {
          log.error('Error in commandHandler.dispatch:', err);
        }

        // Handle AI request
        log.info(`Enqueueing AI request for: ${text}`);
        const workDir = sessionManager.getWorkDir(fromUser);
        const convId = sessionManager.getConvId(fromUser);
        const enqueueResult = requestQueue.enqueue(fromUser, convId, text, async (prompt) => {
          log.info(`Executing AI request for: ${prompt}`);
          await handleAIRequest(fromUser, fromUser, prompt, workDir, convId, undefined, undefined, reqId);
        });

        if (enqueueResult === 'rejected') {
          await sendTextReply(fromUser, '请求队列已满，请稍后再试。', reqId);
        } else if (enqueueResult === 'queued') {
          await sendTextReply(fromUser, '您的请求已排队等待。', reqId);
        }
      }
      // Handle image messages
      else if (msgType === 'image') {
        const imageData = extractImageContent(data);

        if (!imageData) {
          log.warn('[MSG] Image message has no content');
          return;
        }

        const imageDesc = imageData.url ? `URL: ${imageData.url}` : `Base64数据 (${imageData.base64?.length || 0} 字符)`;
        log.info(`Processing image message from ${fromUser}, ${imageDesc}`);

        // TODO: Implement image analysis
        const prompt = `用户发送了一张图片。请分析图片内容。`;

        const workDir = sessionManager.getWorkDir(fromUser);
        const convId = sessionManager.getConvId(fromUser);
        requestQueue.enqueue(fromUser, convId, prompt, async (p) => {
          await handleAIRequest(fromUser, fromUser, p, workDir, convId, undefined, undefined, reqId);
        });
      }
      // Handle file messages
      else if (msgType === 'file') {
        log.info(`[MSG] File message from ${fromUser} - not supported`);
        await sendTextReply(fromUser, '文件消息暂不支持', reqId);
      }
      // Handle voice messages
      else if (msgType === 'voice') {
        log.info(`[MSG] Voice message from ${fromUser} - not supported`);
        await sendTextReply(fromUser, '语音消息暂不支持', reqId);
      }
      // Handle video messages
      else if (msgType === 'video') {
        log.info(`[MSG] Video message from ${fromUser} - not supported`);
        await sendTextReply(fromUser, '视频消息暂不支持', reqId);
      }
      // Handle stream messages (WebSocket streaming response)
      else if (msgType === 'stream') {
        log.debug(`[MSG] Stream message from ${fromUser}, streamId=${body.stream?.id}`);
        // Stream messages are typically responses, not requests
        // We can ignore them or handle them if needed
      }
      // Unsupported message type
      else {
        log.warn(`[MSG] Unsupported message type: ${msgType}, fromUser=${fromUser}`);
      }
    } catch (err) {
      log.error('[handleEvent] Error processing event:', err);
    } finally {
      setCurrentReqId(null);
    }
  }

  return {
    stop: () => stopTaskCleanup(),
    getRunningTaskCount: () => runningTasks.size,
    handleEvent,
  };
}
