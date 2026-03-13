import type { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import type { Config } from "../config.js";
import { AccessControl } from "../access/access-control.js";
import type { SessionManager } from "../session/session-manager.js";
import { RequestQueue } from "../queue/request-queue.js";
import {
  sendThinkingMessage,
  updateMessage,
  sendFinalMessages,
  sendTextReply,
  startTypingLoop,
  sendImageReply,
  sendModeKeyboard,
  sendDirectorySelection,
} from "./message-sender.js";
import {
  registerPermissionSender,
  resolvePermissionById,
} from "../hook/permission-server.js";
import { CommandHandler } from "../commands/handler.js";
import { getAdapter } from "../adapters/registry.js";
import { runAITask, type TaskRunState } from "../shared/ai-task.js";
import { startTaskCleanup } from "../shared/task-cleanup.js";
import { TELEGRAM_THROTTLE_MS } from "../constants.js";
import { setActiveChatId } from "../shared/active-chats.js";
import { setChatUser } from "../shared/chat-user-map.js";
import { setPermissionMode } from "../permission-mode/session-mode.js";
import { MODE_LABELS } from "../permission-mode/types.js";
import { createLogger } from "../logger.js";
import { downloadMediaFromUrl } from "../shared/media-storage.js";

const log = createLogger("TgHandler");

class DynamicThrottle {
  private lastUpdate = 0;
  private lastContentLength = 0;
  private consecutiveErrors = 0;
  private baseInterval = TELEGRAM_THROTTLE_MS;

  getNextDelay(contentLength: number): number {
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdate;

    if (this.consecutiveErrors > 0) {
      const errorDelay = this.baseInterval * (1 + this.consecutiveErrors * 2);
      this.lastUpdate = now;
      return errorDelay;
    }

    const contentGrowth = contentLength - this.lastContentLength;
    if (contentGrowth < 50 && timeSinceLastUpdate < 500) {
      this.lastUpdate = now;
      return 500;
    }

    this.lastUpdate = now;
    this.lastContentLength = contentLength;
    return this.baseInterval;
  }

  recordError(): void {
    this.consecutiveErrors++;
    this.lastUpdate = Date.now();
  }

  recordSuccess(): void {
    this.consecutiveErrors = 0;
  }

  reset(): void {
    this.lastUpdate = 0;
    this.lastContentLength = 0;
    this.consecutiveErrors = 0;
  }
}

async function downloadTelegramPhoto(
  bot: Telegraf,
  fileId: string,
): Promise<string> {
  const fileLink = await bot.telegram.getFileLink(fileId);
  const safeId = fileId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return downloadMediaFromUrl(fileLink.href, {
    basenameHint: safeId.slice(-8),
    fallbackExtension: "jpg",
  });
}

export interface TelegramEventHandlerHandle {
  stop: () => void;
  getRunningTaskCount: () => number;
}

export function setupTelegramHandlers(
  bot: Telegraf,
  config: Config,
  sessionManager: SessionManager,
): TelegramEventHandlerHandle {
  const accessControl = new AccessControl(config.telegramAllowedUserIds);
  const requestQueue = new RequestQueue();
  const runningTasks = new Map<string, TaskRunState>();
  const stopTaskCleanup = startTaskCleanup(runningTasks);

  const commandHandler = new CommandHandler({
    config,
    sessionManager,
    requestQueue,
    sender: { sendTextReply, sendDirectorySelection, sendModeKeyboard },
    getRunningTasksSize: () => runningTasks.size,
  });

  registerPermissionSender("telegram", { sendTextReply });

  async function handleAIRequest(
    userId: string,
    chatId: string,
    prompt: string,
    workDir: string,
    convId?: string,
    _threadCtx?: { rootMessageId: string; threadId: string },
    replyToMessageId?: string,
  ) {
    const currentTurns = sessionManager.addTurns(userId, 1);
    log.info(`User request: total turns = ${currentTurns} for user ${userId}`);

    const toolAdapter = getAdapter(config.aiCommand);
    if (!toolAdapter) {
      await sendTextReply(chatId, `未配置 AI 工具: ${config.aiCommand}`);
      return;
    }

    const sessionId = convId
      ? sessionManager.getSessionIdForConv(userId, convId, config.aiCommand)
      : undefined;
    log.info(
      `Running ${config.aiCommand} for user ${userId}, sessionId=${sessionId ?? "new"}`,
    );

    const toolId = config.aiCommand;
    let msgId: string;
    try {
      msgId = await sendThinkingMessage(chatId, replyToMessageId, toolId);
    } catch (err) {
      log.error("Failed to send thinking message:", err);
      return;
    }

    const stopTyping = startTypingLoop(chatId);
    const taskKey = `${userId}:${msgId}`;
    const throttle = new DynamicThrottle();

    let savedThinkingText = "";
    let hasThinkingContent = false;

    const createStreamUpdateWrapper = () => {
      let lastUpdateTime = 0;
      let lastContentLength = 0;
      let pendingUpdate: ReturnType<typeof setTimeout> | null = null;
      let updateInProgress = false;
      let scheduledContent: string | null = null;
      let scheduledToolNote: string | undefined;
      const STREAM_PREVIEW_LENGTH = 1500;
      const DEBOUNCE_MS = 150;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      const performUpdate = async (
        content: string,
        toolNote?: string,
        isComplete = false,
      ) => {
        if (isComplete) {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
          while (updateInProgress) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          updateInProgress = false;
          scheduledContent = null;
          scheduledToolNote = undefined;
        }

        if (updateInProgress) {
          scheduledContent = content;
          scheduledToolNote = toolNote;
          return;
        }

        updateInProgress = true;

        try {
          let displayContent = content;

          if (hasThinkingContent && savedThinkingText) {
            const thinkingFormatted = `💭 思考过程：\n${savedThinkingText}`;
            const separator = "\n\n─────────\n\n";
            const combined = thinkingFormatted + separator + content;

            if (combined.length > STREAM_PREVIEW_LENGTH) {
              const maxThinkingLength = 800;
              const truncatedThinking =
                savedThinkingText.length > maxThinkingLength
                  ? `...(已省略 ${savedThinkingText.length - maxThinkingLength} 字符)...\n\n${savedThinkingText.slice(-maxThinkingLength)}`
                  : savedThinkingText;

              displayContent = `💭 思考过程：\n${truncatedThinking}\n\n─────────\n\n`;
              if (content.length > 800) {
                displayContent += `...\n\n${content.slice(-800)}`;
              } else {
                displayContent += content;
              }
            } else {
              displayContent = combined;
            }
          } else {
            displayContent =
              content.length > STREAM_PREVIEW_LENGTH
                ? `...\n\n${content.slice(-STREAM_PREVIEW_LENGTH)}`
                : content;
          }

          const note = toolNote ? "输出中...\n" + toolNote : "输出中...";
          await updateMessage(
            chatId,
            msgId,
            displayContent,
            "streaming",
            note,
            toolId,
          );
          throttle.recordSuccess();
          lastUpdateTime = Date.now();
        } catch {
          throttle.recordError();
        } finally {
          updateInProgress = false;
          if (scheduledContent !== null) {
            const nextContent = scheduledContent;
            const nextNote = scheduledToolNote;
            scheduledContent = null;
            scheduledToolNote = undefined;
            await performUpdate(nextContent, nextNote);
          }
        }
      };

      return (content: string, toolNote?: string) => {
        if (content.startsWith("💭 **思考中...**")) {
          return;
        }

        const now = Date.now();
        const elapsed = now - lastUpdateTime;
        const contentGrowth = content.length - lastContentLength;
        if (contentGrowth < 30 && elapsed < 500 && lastContentLength > 0) {
          lastContentLength = content.length;
          return;
        }

        lastContentLength = content.length;
        const baseDelay = throttle.getNextDelay(content.length);

        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(
          () => {
            debounceTimer = null;
            performUpdate(content, toolNote);
          },
          Math.max(DEBOUNCE_MS, baseDelay),
        );
      };
    };

    const streamUpdateWrapper = createStreamUpdateWrapper();

    await runAITask(
      { config, sessionManager },
      {
        userId,
        chatId,
        workDir,
        sessionId,
        convId,
        platform: "telegram",
        taskKey,
      },
      prompt,
      toolAdapter,
      {
        throttleMs: TELEGRAM_THROTTLE_MS,
        streamUpdate: (content, toolNote) => {
          streamUpdateWrapper(content, toolNote);
        },
        sendComplete: async (content, note) => {
          throttle.reset();
          try {
            await sendFinalMessages(chatId, msgId, content, note, toolId);
          } catch (err) {
            log.error("Failed to send complete message:", err);
            await updateMessage(chatId, msgId, content, "done", note, toolId);
          }
        },
        sendError: async (error) => {
          throttle.reset();
          await updateMessage(
            chatId,
            msgId,
            `错误：${error}`,
            "error",
            "执行失败",
            toolId,
          );
        },
        extraCleanup: () => {
          throttle.reset();
          savedThinkingText = "";
          hasThinkingContent = false;
          stopTyping();
          runningTasks.delete(taskKey);
        },
        onTaskReady: (state) => {
          runningTasks.set(taskKey, state);
        },
        sendImage: (path) => sendImageReply(chatId, path),
      },
    );
  }

  bot.on("callback_query", async (ctx) => {
    const query = ctx.callbackQuery;
    if (!("data" in query)) return;
    const userId = String(ctx.from?.id ?? "");
    const data = query.data as string;

    if (data.startsWith("stop_")) {
      const messageId = data.replace("stop_", "");
      const taskKey = `${userId}:${messageId}`;
      const taskInfo = runningTasks.get(taskKey);
      if (taskInfo) {
        runningTasks.delete(taskKey);
        taskInfo.settle();
        taskInfo.handle.abort();
        const chatId = String(ctx.chat?.id ?? "");
        await updateMessage(
          chatId,
          messageId,
          taskInfo.latestContent || "已停止",
          "error",
          "⏹️ 已停止",
          config.aiCommand,
        );
        await ctx.answerCbQuery("已停止执行");
      } else {
        await ctx.answerCbQuery("任务已完成或不存在");
      }
    } else if (
      data.startsWith("perm_allow_") ||
      data.startsWith("perm_deny_")
    ) {
      const isAllow = data.startsWith("perm_allow_");
      const requestId = data.replace(/^perm_(allow|deny)_/, "");
      const decision = isAllow ? "allow" : "deny";
      resolvePermissionById(requestId, decision);
      await ctx.answerCbQuery(isAllow ? "✅ 已允许" : "❌ 已拒绝");
    } else if (data.startsWith("mode:")) {
      const parts = data.split(":");
      if (parts.length >= 3 && parts[1] === userId) {
        const mode = parts[2] as "ask" | "accept-edits" | "plan" | "yolo";
        if (["ask", "accept-edits", "plan", "yolo"].includes(mode)) {
          setPermissionMode(userId, mode);
          await ctx.answerCbQuery(`✅ 已切换为 ${MODE_LABELS[mode]}`);
        }
      }
    }
  });

  bot.on(message("text"), async (ctx) => {
    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from!.id);
    const messageId = String(ctx.message.message_id);
    const text = ctx.message.text.trim();

    if (!accessControl.isAllowed(userId)) {
      await sendTextReply(chatId, "抱歉，您没有访问权限。\n您的 ID: " + userId);
      return;
    }

    setActiveChatId("telegram", chatId);
    setChatUser(chatId, userId, "telegram");

    if (
      await commandHandler.dispatch(
        text,
        chatId,
        userId,
        "telegram",
        handleAIRequest,
      )
    ) {
      return;
    }

    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);
    const enqueueResult = requestQueue.enqueue(
      userId,
      convId,
      text,
      async (prompt) => {
        await handleAIRequest(
          userId,
          chatId,
          prompt,
          workDir,
          convId,
          undefined,
          messageId,
        );
      },
    );

    if (enqueueResult === "rejected") {
      await sendTextReply(chatId, "请求队列已满，请稍后再试。");
    } else if (enqueueResult === "queued") {
      await sendTextReply(chatId, "您的请求已排队等待。");
    }
  });

  bot.on(message("photo"), async (ctx) => {
    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from!.id);
    const caption = ctx.message.caption?.trim() || "";

    if (!accessControl.isAllowed(userId)) return;

    setActiveChatId("telegram", chatId);
    setChatUser(chatId, userId, "telegram");

    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    let imagePath: string;
    try {
      imagePath = await downloadTelegramPhoto(bot, largest.file_id);
    } catch (err) {
      log.error("Failed to download photo:", err);
      await sendTextReply(chatId, "图片下载失败。");
      return;
    }

    const prompt = caption
      ? `用户发送了一张图片（附言：${caption}），已保存到 ${imagePath}。请用 Read 工具查看并分析。`
      : `用户发送了一张图片，已保存到 ${imagePath}。请用 Read 工具查看并分析。`;

    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);
    requestQueue.enqueue(userId, convId, prompt, async (p) => {
      await handleAIRequest(userId, chatId, p, workDir, convId);
    });
  });

  return {
    stop: () => stopTaskCleanup(),
    getRunningTaskCount: () => runningTasks.size,
  };
}
