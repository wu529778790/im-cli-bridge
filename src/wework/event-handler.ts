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
} from './message-sender.js';
import { registerPermissionSender, resolvePermissionById } from '../hook/permission-server.js';
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
import type { WeWorkCallbackEvent } from './types.js';

const log = createLogger('WeWorkHandler');

export interface WeWorkEventHandlerHandle {
  stop: () => void;
  getRunningTaskCount: () => number;
  handleEvent: (data: WeWorkCallbackEvent) => Promise<void>;
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
    replyToMessageId?: string
  ) {
    log.info(`[AI_REQUEST] userId=${userId}, chatId=${chatId}, promptLength=${prompt.length}`);

    const toolAdapter = getAdapter(config.aiCommand);
    if (!toolAdapter) {
      log.error(`[handleAIRequest] No adapter found for: ${config.aiCommand}`);
      await sendTextReply(chatId, `未配置 AI 工具: ${config.aiCommand}`);
      return;
    }

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
      { userId, chatId, workDir, sessionId, convId, platform: 'wework', taskKey },
      prompt,
      toolAdapter,
      {
        throttleMs: WEWORK_THROTTLE_MS,
        streamUpdate: async (content, toolNote) => {
          const note = toolNote ? '输出中...\n' + toolNote : '输出中...';
          try {
            await updateMessage(chatId, msgId, content, 'streaming', note, toolId);
          } catch (err) {
            log.debug('Stream update failed:', err);
          }
        },
        sendComplete: async (content, note) => {
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
        sendImage: async (path) => {
          // WeWork image handling
          await sendTextReply(chatId, `图片已保存: ${path}`);
        },
      }
    );
  }

  /**
   * Handle incoming WeWork callback event
   */
  async function handleEvent(data: WeWorkCallbackEvent): Promise<void> {
    log.info('[handleEvent] Called with data:', JSON.stringify(data).slice(0, 800));

    try {
      const msgType = data.MsgType;
      const fromUser = data.FromUserName;
      const toUser = data.ToUserName;
      const agentId = data.AgentID;

      log.info(`WeWork event: msgType=${msgType}, from=${fromUser}, to=${toUser}, agent=${agentId}`);

      // Access control check
      if (!accessControl.isAllowed(fromUser)) {
        log.warn(`Access denied for sender: ${fromUser}`);
        await sendTextReply(fromUser, `抱歉，您没有访问权限。\n您的 ID: ${fromUser}`);
        return;
      }

      log.info(`Access granted for sender: ${fromUser}`);

      setActiveChatId('wework', fromUser);
      setChatUser(fromUser, fromUser);

      // Handle text messages
      if (msgType === 'text') {
        const text = data.Content?.trim() ?? data.Text?.Content?.trim() ?? '';

        log.info(`[MSG] Type=text, User=${fromUser}, Length=${text.length}, Content="${text}"`);

        // Handle commands
        try {
          const handled = await commandHandler.dispatch(text, fromUser, fromUser, 'wework', handleAIRequest);
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
          await handleAIRequest(fromUser, fromUser, prompt, workDir, convId);
        });

        if (enqueueResult === 'rejected') {
          await sendTextReply(fromUser, '请求队列已满，请稍后再试。');
        } else if (enqueueResult === 'queued') {
          await sendTextReply(fromUser, '您的请求已排队等待。');
        }
      }
      // Handle image messages
      else if (msgType === 'image') {
        const mediaId = data.Image?.MediaId ?? data.MediaId;

        if (!mediaId) {
          log.warn('[MSG] Image message has no media_id');
          return;
        }

        log.info(`Processing image message from ${fromUser}, media_id: ${mediaId}`);

        // TODO: Implement image download from WeWork
        const prompt = `用户发送了一张图片（media_id: ${mediaId}）。请分析图片内容。`;

        const workDir = sessionManager.getWorkDir(fromUser);
        const convId = sessionManager.getConvId(fromUser);
        requestQueue.enqueue(fromUser, convId, prompt, async (p) => {
          await handleAIRequest(fromUser, fromUser, p, workDir, convId);
        });
      }
      // Handle file messages
      else if (msgType === 'file') {
        const mediaId = data.File?.MediaId ?? data.MediaId;
        const title = data.File?.Title ?? '未知文件';

        if (!mediaId) {
          log.warn('[MSG] File message has no media_id');
          return;
        }

        log.info(`Processing file message from ${fromUser}, media_id: ${mediaId}, title: ${title}`);

        // TODO: Implement file download from WeWork
        const prompt = `用户发送了一个文件：${title}（media_id: ${mediaId}）。请分析文件内容。`;

        const workDir = sessionManager.getWorkDir(fromUser);
        const convId = sessionManager.getConvId(fromUser);
        requestQueue.enqueue(fromUser, convId, prompt, async (p) => {
          await handleAIRequest(fromUser, fromUser, p, workDir, convId);
        });
      }
      // Handle voice messages
      else if (msgType === 'voice') {
        log.info(`[MSG] Voice message from ${fromUser} - not supported`);
        await sendTextReply(fromUser, '语音消息暂不支持');
      }
      // Handle video messages
      else if (msgType === 'video') {
        log.info(`[MSG] Video message from ${fromUser} - not supported`);
        await sendTextReply(fromUser, '视频消息暂不支持');
      }
      // Handle events
      else if (msgType === 'event') {
        const event = data.Event;

        if (event === 'subscribe') {
          log.info(`User ${fromUser} subscribed to the app`);
          await sendTextReply(fromUser, '欢迎使用 open-im！发送 /help 查看可用命令。');
        } else if (event === 'unsubscribe') {
          log.info(`User ${fromUser} unsubscribed from the app`);
        } else if (event === 'enter_agent') {
          log.info(`User ${fromUser} entered agent scope`);
        } else if (event === 'exit_agent') {
          log.info(`User ${fromUser} left agent scope`);
        } else if (event === 'click') {
          // Menu button click
          const eventKey = data.EventKey;
          log.info(`Menu button clicked: ${eventKey}`);

          // Handle menu buttons for mode switching
          if (eventKey?.startsWith('mode_')) {
            const mode = eventKey.replace('mode_', '') as 'ask' | 'accept-edits' | 'plan' | 'yolo';
            if (['ask', 'accept-edits', 'plan', 'yolo'].includes(mode)) {
              setPermissionMode(fromUser, mode);
              await sendTextReply(fromUser, `✅ 已切换为 ${MODE_LABELS[mode]}`);
            }
          }
        } else {
          log.info(`Unhandled event: ${event}`);
        }
      }
      // Unsupported message type
      else {
        log.warn(`[MSG] Unsupported message type: ${msgType}, fromUser=${fromUser}`);
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
