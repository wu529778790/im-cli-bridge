/**
 * WorkBuddy Event Handler - Handle WeChat KF message events from Centrifuge
 */

import { resolvePlatformAiCommand, type Config } from '../config.js';
import { AccessControl } from '../access/access-control.js';
import type { SessionManager } from '../session/session-manager.js';
import { RequestQueue } from '../queue/request-queue.js';
import { sendTextReply, sendErrorReply, sendStreamingReply } from './message-sender.js';
import { CommandHandler } from '../commands/handler.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask, type TaskRunState } from '../shared/ai-task.js';
import { WORKBUDDY_THROTTLE_MS } from '../constants.js';
import { setActiveChatId } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import { createLogger } from '../logger.js';
import { getCentrifugeClient } from './client.js';

const log = createLogger('WorkBuddyHandler');

export interface WorkBuddyEventHandlerHandle {
  stop: () => void;
  getRunningTaskCount: () => number;
  handleEvent: (chatId: string, msgId: string, content: string) => Promise<void>;
}

export function setupWorkBuddyHandlers(
  config: Config,
  sessionManager: SessionManager,
): WorkBuddyEventHandlerHandle {
  const accessControl = new AccessControl(config.workbuddyAllowedUserIds);
  const requestQueue = new RequestQueue();
  const runningTasks = new Map<string, TaskRunState>();
  const taskKeyByChatId = new Map<string, string>();

  // Base dependencies for creating per-event CommandHandler
  const baseCommandDeps = {
    config,
    sessionManager,
    requestQueue,
    getRunningTasksSize: () => runningTasks.size,
  };

  async function handleAIRequest(
    userId: string,
    chatId: string,
    msgId: string,
    prompt: string,
    workDir: string,
    convId?: string,
  ) {
    log.info(`[AI_REQUEST] userId=${userId}, chatId=${chatId}, promptLength=${prompt.length}`);

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

    const toolId = aiCommand;
    const taskKey = `${userId}:${msgId}`;

    await runAITask(
      { config, sessionManager },
      { userId, chatId, workDir, sessionId, convId, platform: 'workbuddy', taskKey },
      prompt,
      toolAdapter,
      {
        throttleMs: WORKBUDDY_THROTTLE_MS,
        minContentDeltaChars: 200,
        streamUpdate: async (content) => {
          await sendStreamingReply(null, chatId, content, msgId);
        },
        sendComplete: async (content) => {
          const client = getCentrifugeClient();
          if (client) client.setStreamingMode(false);
          await sendTextReply(null, chatId, content, msgId);
        },
        sendError: async (error) => {
          const client = getCentrifugeClient();
          if (client) client.setStreamingMode(false);
          await sendErrorReply(null, chatId, error, msgId);
        },
        extraCleanup: () => {
          runningTasks.delete(taskKey);
          if (taskKeyByChatId.get(chatId) === taskKey) {
            taskKeyByChatId.delete(chatId);
          }
        },
        onTaskReady: (state) => {
          runningTasks.set(taskKey, state);
          taskKeyByChatId.set(chatId, taskKey);
        },
        onFirstContent: () => {
          // Enable streaming mode: register channel once, then skip per-update registration
          const client = getCentrifugeClient();
          if (client) client.setStreamingMode(true);
        },
      },
    );
  }

  async function handleEvent(chatId: string, msgId: string, content: string): Promise<void> {
    log.info(`[handleEvent] chatId=${chatId}, msgId=${msgId}, content="${content.substring(0, 100)}"`);

    // Use chatId as userId for WorkBuddy (WeChat KF doesn't have separate userId)
    const userId = chatId;
    const text = content.trim();

    if (!accessControl.isAllowed(userId)) {
      log.warn(`Access denied for sender: ${userId}`);
      await sendErrorReply(null, chatId, `Access denied. Your chat ID: ${userId}`, msgId);
      return;
    }

    setActiveChatId('workbuddy', chatId);
    setChatUser(chatId, userId, 'workbuddy');

    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);

    // Create a per-event CommandHandler with sender that captures msgId for this event
    const commandHandler = new CommandHandler({
      ...baseCommandDeps,
      sender: {
        sendTextReply: async (c: string, t: string) => {
          await sendTextReply(null, c, t, msgId);
        },
      },
    });

    // Try command handler first
    try {
      const handled = await commandHandler.dispatch(text, chatId, userId, 'workbuddy', (u, c, p, w, conv, _r, m) =>
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

    const enqueueResult = requestQueue.enqueue(userId, convId, text, async (nextPrompt) => {
      log.info(`Executing AI request for: ${text}`);
      await handleAIRequest(userId, chatId, msgId, nextPrompt, workDir, convId);
    });

    if (enqueueResult === 'rejected') {
      await sendErrorReply(null, chatId, 'Request queue is full. Please try again later.', msgId);
    } else if (enqueueResult === 'queued') {
      await sendTextReply(null, chatId, 'Your request is queued.', msgId);
    }
  }

  return {
    stop: () => {},
    getRunningTaskCount: () => runningTasks.size,
    handleEvent,
  };
}
