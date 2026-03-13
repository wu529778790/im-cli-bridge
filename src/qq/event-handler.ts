import type { Config } from "../config.js";
import { AccessControl } from "../access/access-control.js";
import type { SessionManager } from "../session/session-manager.js";
import { RequestQueue } from "../queue/request-queue.js";
import {
  sendThinkingMessage,
  updateMessage,
  sendFinalMessages,
  sendErrorMessage,
  sendTextReply,
  sendModeKeyboard,
  sendDirectorySelection,
  startTypingLoop,
} from "./message-sender.js";
import { registerPermissionSender } from "../hook/permission-server.js";
import { CommandHandler } from "../commands/handler.js";
import { getAdapter } from "../adapters/registry.js";
import { runAITask, type TaskRunState } from "../shared/ai-task.js";
import { startTaskCleanup } from "../shared/task-cleanup.js";
import { setActiveChatId } from "../shared/active-chats.js";
import { setChatUser } from "../shared/chat-user-map.js";
import { createLogger } from "../logger.js";
import type { ThreadContext } from "../shared/types.js";
import type { QQMessageEvent } from "./types.js";

const log = createLogger("QQHandler");
const QQ_THROTTLE_MS = 1200;

function toChatId(event: QQMessageEvent): string {
  if (event.type === "group") {
    return `group:${event.groupOpenid}`;
  }
  if (event.type === "channel") {
    return `channel:${event.channelId}`;
  }
  return `private:${event.userOpenid}`;
}

export interface QQEventHandlerHandle {
  stop: () => void;
  getRunningTaskCount: () => number;
  handleEvent: (event: QQMessageEvent) => Promise<void>;
}

export function setupQQHandlers(
  config: Config,
  sessionManager: SessionManager,
): QQEventHandlerHandle {
  const accessControl = new AccessControl(config.qqAllowedUserIds);
  const requestQueue = new RequestQueue();
  const runningTasks = new Map<string, TaskRunState>();
  const stopTaskCleanup = startTaskCleanup(runningTasks);

  const commandHandler = new CommandHandler({
    config,
    sessionManager,
    requestQueue,
    sender: { sendTextReply, sendModeKeyboard, sendDirectorySelection },
    getRunningTasksSize: () => runningTasks.size,
  });

  registerPermissionSender("qq", { sendTextReply });

  async function handleAIRequest(
    userId: string,
    chatId: string,
    prompt: string,
    workDir: string,
    convId?: string,
    _threadCtx?: ThreadContext,
    replyToMessageId?: string,
  ) {
    const toolAdapter = getAdapter(config.aiCommand);
    if (!toolAdapter) {
      await sendTextReply(chatId, `AI tool is not configured: ${config.aiCommand}`);
      return;
    }

    const sessionId = convId
      ? sessionManager.getSessionIdForConv(userId, convId, config.aiCommand)
      : undefined;
    const toolId = config.aiCommand;
    const msgId = await sendThinkingMessage(chatId, replyToMessageId, toolId);
    const stopTyping = startTypingLoop();
    const taskKey = `${userId}:${msgId}`;

    await runAITask(
      { config, sessionManager },
      { userId, chatId, workDir, sessionId, convId, platform: "qq", taskKey },
      prompt,
      toolAdapter,
      {
        throttleMs: QQ_THROTTLE_MS,
        streamUpdate: async (content, toolNote) => {
          await updateMessage(chatId, msgId, content, "streaming", toolNote, toolId);
        },
        sendComplete: async (content, note) => {
          await sendFinalMessages(chatId, msgId, content, note ?? "", toolId);
        },
        sendError: async (error) => {
          await sendErrorMessage(chatId, msgId, error, toolId);
        },
        extraCleanup: () => {
          stopTyping();
          runningTasks.delete(taskKey);
        },
        onTaskReady: (state) => {
          runningTasks.set(taskKey, state);
        },
        sendImage: async (path) => {
          await sendTextReply(chatId, `Image saved: ${path}`);
        },
      },
    );
  }

  async function handleEvent(event: QQMessageEvent): Promise<void> {
    const userId = event.userOpenid;
    const chatId = toChatId(event);
    const text = event.content?.trim() ?? "";

    if (!accessControl.isAllowed(userId)) {
      await sendTextReply(chatId, `Access denied. Your QQ user ID: ${userId}`);
      return;
    }

    if (!text) return;

    setActiveChatId("qq", chatId);
    setChatUser(chatId, userId, "qq");

    const handled = await commandHandler.dispatch(text, chatId, userId, "qq", handleAIRequest);
    if (handled) return;

    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);
    const enqueueResult = requestQueue.enqueue(userId, convId, text, async (prompt) => {
      await handleAIRequest(userId, chatId, prompt, workDir, convId, undefined, event.id);
    });

    if (enqueueResult === "rejected") {
      await sendTextReply(chatId, "Request queue is full. Please try again later.");
    } else if (enqueueResult === "queued") {
      await sendTextReply(chatId, "Your request is queued.");
    }

    log.info(`QQ message handled: user=${userId}, chat=${chatId}, status=${enqueueResult}`);
  }

  return {
    stop: () => stopTaskCleanup(),
    getRunningTaskCount: () => runningTasks.size,
    handleEvent,
  };
}
