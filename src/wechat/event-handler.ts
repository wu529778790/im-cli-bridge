/**
 * WeChat Event Handler - Handle WeChat message events from AGP WebSocket
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
import { WECHAT_THROTTLE_MS } from '../constants.js';
import { setActiveChatId } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import { createLogger } from '../logger.js';
import type { AGPEnvelope, SessionPromptPayload } from './types.js';

const log = createLogger('WeChatHandler');

export interface WeChatEventHandlerHandle {
  stop: () => void;
  getRunningTaskCount: () => number;
  handleEvent: (data: unknown) => Promise<void>;
}

export function setupWeChatHandlers(
  config: Config,
  sessionManager: SessionManager
): WeChatEventHandlerHandle {
  const accessControl = new AccessControl(config.wechatAllowedUserIds);
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

  registerPermissionSender('wechat', { sendTextReply, sendPermissionCard });

  async function handleAIRequest(
    userId: string,
    chatId: string,
    prompt: string,
    workDir: string,
    convId?: string,
    threadCtx?: { rootMessageId: string; threadId: string },
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
      { userId, chatId, workDir, sessionId, convId, platform: 'wechat', taskKey },
      prompt,
      toolAdapter,
      {
        throttleMs: WECHAT_THROTTLE_MS,
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
          // WeChat doesn't have native image support like Feishu
          // Send text message with image path
          await sendTextReply(chatId, `图片已保存: ${path}`);
        },
      }
    );
  }

  /**
   * Handle incoming AGP WebSocket message
   */
  async function handleEvent(data: unknown): Promise<void> {
    log.info('[handleEvent] Called with data:', JSON.stringify(data).slice(0, 800));

    try {
      const envelope = data as AGPEnvelope<SessionPromptPayload>;

      if (!envelope.method || !envelope.payload) {
        log.warn('Invalid AGP envelope: missing method or payload');
        return;
      }

      // Handle different AGP methods
      switch (envelope.method) {
        case 'session.prompt':
          await handleSessionPrompt(envelope);
          break;

        case 'session.cancel':
          await handleSessionCancel(envelope);
          break;

        case 'session.update':
          await handleSessionUpdate(envelope);
          break;

        case 'ping':
          log.debug('Received ping, no action needed');
          break;

        default:
          log.warn('Unknown AGP method:', envelope.method);
      }
    } catch (err) {
      log.error('[handleEvent] Error processing event:', err);
    }
  }

  /**
   * Handle session.prompt - user message / command
   */
  async function handleSessionPrompt(envelope: AGPEnvelope<SessionPromptPayload>): Promise<void> {
    const payload = envelope.payload;
    const userId = envelope.user_id ?? envelope.guid ?? 'unknown';
    const chatId = payload.session_id;
    const text = payload.content?.trim() ?? '';

    log.info(`[SESSION_PROMPT] userId=${userId}, chatId=${chatId}, text="${text}"`);

    // Access control check
    if (!accessControl.isAllowed(userId)) {
      log.warn(`Access denied for sender: ${userId}`);
      await sendTextReply(chatId, `抱歉，您没有访问权限。\n您的 ID: ${userId}`);
      return;
    }

    log.info(`Access granted for sender: ${userId}`);

    setActiveChatId('wechat', chatId);
    setChatUser(chatId, userId);

    // Handle commands
    try {
      const handled = await commandHandler.dispatch(text, chatId, userId, 'wechat', handleAIRequest);
      if (handled) {
        log.info(`Command handled for message: ${text}`);
        return;
      }
    } catch (err) {
      log.error('Error in commandHandler.dispatch:', err);
    }

    // Handle AI request
    log.info(`Enqueueing AI request for: ${text}`);
    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);
    const enqueueResult = requestQueue.enqueue(userId, convId, text, async (prompt) => {
      log.info(`Executing AI request for: ${prompt}`);
      await handleAIRequest(userId, chatId, prompt, workDir, convId);
    });

    if (enqueueResult === 'rejected') {
      await sendTextReply(chatId, '请求队列已满，请稍后再试。');
    } else if (enqueueResult === 'queued') {
      await sendTextReply(chatId, '您的请求已排队等待。');
    }
  }

  /**
   * Handle session.cancel - user cancellation
   */
  async function handleSessionCancel(envelope: AGPEnvelope): Promise<void> {
    const payload = envelope.payload as { session_id: string; reason?: string };
    const chatId = payload.session_id;
    log.info(`[SESSION_CANCEL] chatId=${chatId}, reason=${payload.reason ?? 'none'}`);

    // Find and cancel running task for this chat
    for (const [key, state] of runningTasks.entries()) {
      if (key.startsWith(chatId)) {
        log.info(`Cancelling task: ${key}`);
        if (state.handle) {
          state.handle.abort();
        }
        runningTasks.delete(key);
        await sendTextReply(chatId, '任务已取消');
        return;
      }
    }

    await sendTextReply(chatId, '没有找到正在运行的任务');
  }

  /**
   * Handle session.update - session state update
   */
  async function handleSessionUpdate(envelope: AGPEnvelope): Promise<void> {
    const payload = envelope.payload as { session_id: string; updates: Record<string, unknown> };
    const chatId = payload.session_id;
    const updates = payload.updates;

    log.info(`[SESSION_UPDATE] chatId=${chatId}, updates=`, JSON.stringify(updates));

    // Handle permission responses from user
    if (updates.type === 'permission_response') {
      const { requestId, decision } = updates as { requestId: string; decision: 'allow' | 'deny' };
      log.info(`Permission response: ${decision} for ${requestId}`);

      const resolved = resolvePermissionById(requestId, decision);
      const message = resolved
        ? decision === 'allow' ? '✅ 权限已允许' : '❌ 权限已拒绝'
        : '⚠️ 权限请求已过期或不存在';

      await sendTextReply(chatId, message);
    }

    // Handle mode switch
    if (updates.type === 'mode_switch') {
      const { mode } = updates as { mode: string };
      const validMode = mode as 'ask' | 'accept-edits' | 'plan' | 'yolo';

      if (['ask', 'accept-edits', 'plan', 'yolo'].includes(validMode)) {
        setPermissionMode(chatId, validMode);
        await sendTextReply(chatId, `✅ 已切换为 ${MODE_LABELS[validMode]}`);
      } else {
        await sendTextReply(chatId, `❌ 无效的模式: ${mode}`);
      }
    }
  }

  return {
    stop: () => stopTaskCleanup(),
    getRunningTaskCount: () => runningTasks.size,
    handleEvent,
  };
}
