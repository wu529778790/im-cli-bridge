/**
 * WorkBuddy Event Handler - Handle WeChat KF message events from Centrifuge
 */

import type { Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import { sendTextReply, sendErrorReply } from './message-sender.js';
import { startTaskCleanup } from '../shared/task-cleanup.js';
import { WORKBUDDY_THROTTLE_MS } from '../constants.js';
import { setActiveChatId } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import { createLogger } from '../logger.js';
import { createPlatformEventContext } from '../platform/create-event-context.js';
import { createPlatformAIRequestHandler, type PlatformSender, type PlatformTaskCallbacks } from '../platform/handle-ai-request.js';

const log = createLogger('WorkBuddyHandler');

export interface WorkBuddyEventHandlerHandle {
  stop: () => void;
  runningTasks: Map<string, import('../shared/ai-task.js').TaskRunState>;
  getRunningTaskCount: () => number;
  handleEvent: (chatId: string, msgId: string, content: string) => Promise<void>;
}

export function setupWorkBuddyHandlers(
  config: Config,
  sessionManager: SessionManager,
): WorkBuddyEventHandlerHandle {
  // WorkBuddy-specific: taskKeyByChatId map for tracking
  const taskKeyByChatId = new Map<string, string>();

  // Create shared platform event context
  const ctx = createPlatformEventContext({
    platform: 'workbuddy',
    allowedUserIds: config.workbuddyAllowedUserIds,
    config,
    sessionManager,
    sender: {
      sendTextReply: async (chatId, text) => {
        // WorkBuddy needs msgId for all replies, we'll handle this per-event
        await sendTextReply(null, chatId, text, '');
      },
    },
  });

  // Start task cleanup
  const stopTaskCleanup = startTaskCleanup(ctx.runningTasks);

  // WorkBuddy-specific sender callbacks (no thinking message needed)
  const platformSender: PlatformSender = {
    sendThinkingMessage: async (_chatId, _replyToMessageId, _toolId) => {
      // WorkBuddy uses incoming msgId as thinking message ID
      // This is a no-op since we'll use the incoming msgId
      return 'workbuddy_no_thinking';
    },
    sendTextReply: async (_chatId, text) => {
      // WorkBuddy-specific reply (needs msgId captured per event)
      await sendTextReply(null, _chatId, text, '');
    },
    startTyping: (_chatId) => {
      // WorkBuddy doesn't support typing indicators
      return () => {};
    },
  };

  // WorkBuddy-specific callbacks (log-only streaming, no real updates)
  const workBuddyTaskCallbacks: PlatformTaskCallbacks = {
    streamUpdate: async (content) => {
      // WorkBuddy doesn't support streaming updates via Centrifuge
      log.debug(`Stream update (not sent): ${content.substring(0, 50)}...`);
    },
    sendComplete: async (_content) => {
      // Will be handled per-event with correct msgId
    },
    sendError: async (_error) => {
      // Will be handled per-event with correct msgId
    },
    extraCleanup: () => {
      // Clean up taskKeyByChatId on completion
    },
  };

  // WorkBuddy-specific init to capture msgId for task tracking
  const extraInit = ({ chatId, taskKey }: { chatId: string; msgId: string; taskKey: string }) => {
    taskKeyByChatId.set(chatId, taskKey);
    return () => {
      if (taskKeyByChatId.get(chatId) === taskKey) {
        taskKeyByChatId.delete(chatId);
      }
    };
  };

  // Create platform-specific AI request handler
  // Note: WorkBuddy uses a different handleAIRequest signature with msgId
  // We'll need to wrap the standard handler
  createPlatformAIRequestHandler({
    platform: 'workbuddy',
    config,
    sessionManager,
    sender: platformSender,
    throttleMs: WORKBUDDY_THROTTLE_MS,
    runningTasks: ctx.runningTasks,
    taskCallbacks: workBuddyTaskCallbacks,
    extraInit,
  });

  // WorkBuddy-specific wrapper that captures msgId
  async function handleAIRequest(
    userId: string,
    chatId: string,
    msgId: string,
    prompt: string,
    workDir: string,
    convId?: string,
    signal?: AbortSignal,
  ) {
    log.info(`[AI_REQUEST] userId=${userId}, chatId=${chatId}, msgId=${msgId}, promptLength=${prompt.length}`);

    // WorkBuddy uses incoming msgId as taskKey (no thinking message needed)
    const taskKey = `${userId}:${msgId}`;

    // Directly run AI task (WorkBuddy doesn't use the standard flow)
    const { resolvePlatformAiCommand } = await import('../config.js');
    const { getAdapter } = await import('../adapters/registry.js');
    const { runAITask } = await import('../shared/ai-task.js');

    const aiCommand = resolvePlatformAiCommand(config, 'workbuddy');
    const toolAdapter = getAdapter(aiCommand);
    if (!toolAdapter) {
      log.error(`[handleAIRequest] No adapter found for: ${aiCommand}`);
      await sendErrorReply(null, chatId, `AI tool is not configured: ${aiCommand}`, msgId);
      return;
    }

    const sessionId = convId
      ? sessionManager.getSessionIdForConv(userId, convId, aiCommand)
      : undefined;
    log.info(`[handleAIRequest] Running ${aiCommand} for user ${userId}, sessionId=${sessionId ?? 'new'}`);

    // Set up task tracking key mapping
    taskKeyByChatId.set(chatId, taskKey);

    await runAITask(
      { config, sessionManager },
      { userId, chatId, workDir, sessionId, convId, platform: 'workbuddy', taskKey, signal },
      prompt,
      toolAdapter,
      {
        throttleMs: WORKBUDDY_THROTTLE_MS,
        streamUpdate: async (content) => {
          log.debug(`Stream update (not sent): ${content.substring(0, 50)}...`);
        },
        sendComplete: async (content) => {
          await sendTextReply(null, chatId, content, msgId);
        },
        sendError: async (error) => {
          await sendErrorReply(null, chatId, error, msgId);
        },
        extraCleanup: () => {
          ctx.runningTasks.delete(taskKey);
          if (taskKeyByChatId.get(chatId) === taskKey) {
            taskKeyByChatId.delete(chatId);
          }
        },
        onTaskReady: (state) => {
          ctx.runningTasks.set(taskKey, state);
          taskKeyByChatId.set(chatId, taskKey);
        },
      },
      );
  }

  async function handleEvent(chatId: string, msgId: string, content: string): Promise<void> {
    log.info(`[handleEvent] chatId=${chatId}, msgId=${msgId}, content="${content.substring(0, 100)}"`);

    // Use chatId as userId for WorkBuddy (WeChat KF doesn't have separate userId)
    const userId = chatId;
    const text = content.trim();

    // Access control check
    if (!ctx.accessControl.isAllowed(userId)) {
      log.warn(`Access denied for sender: ${userId}`);
      await sendErrorReply(null, chatId, `抱歉，您没有访问权限。\n您的 ID: ${userId}`, msgId);
      return;
    }

    setActiveChatId('workbuddy', chatId);
    setChatUser(chatId, userId, 'workbuddy');

    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);

    // Create a per-event sender that captures msgId
    const eventSender = {
      sendTextReply: async (c: string, t: string) => {
        await sendTextReply(null, c, t, msgId);
      },
    };

    // Create a per-event CommandHandler with msgId-capturing sender
    const { CommandHandler } = await import('../commands/handler.js');
    const commandHandler = new CommandHandler({
      config,
      sessionManager,
      requestQueue: ctx.requestQueue,
      sender: eventSender,
      getRunningTasksSize: () => ctx.runningTasks.size,
    });

    // Try command handler first
    try {
      const handled = await commandHandler.dispatch(text, chatId, userId, 'workbuddy', (u, c, p, w, conv, _r, _m) =>
        handleAIRequest(u, c, msgId, p, w, conv)
      );
      if (handled) {
        log.info(`Command handled for message: ${text}`);
        return;
      }
    } catch (err) {
      log.error('Error in commandHandler.dispatch:', err);
    }

    // No command, proceed with AI request
    if (!text) {
      return;
    }

    const enqueueResult = ctx.requestQueue.enqueue(userId, convId, text, async (nextPrompt, signal) => {
      log.info(`Executing AI request for: ${nextPrompt}`);
      await handleAIRequest(userId, chatId, msgId, nextPrompt, workDir, convId, signal);
    });

    if (enqueueResult === 'rejected') {
      await sendErrorReply(null, chatId, '请求队列已满，请稍后再试。', msgId);
    } else if (enqueueResult === 'queued') {
      await sendTextReply(null, chatId, '您的请求已排队等待。', msgId);
    }
  }

  return {
    stop: () => stopTaskCleanup(),
    runningTasks: ctx.runningTasks,
    getRunningTaskCount: () => ctx.runningTasks.size,
    handleEvent,
  };
}
