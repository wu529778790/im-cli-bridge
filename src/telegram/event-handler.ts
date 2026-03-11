import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import { TELEGRAM_THROTTLE_MS, IMAGE_DIR } from "../constants.js";
import { setActiveChatId } from "../shared/active-chats.js";
import { setChatUser } from "../shared/chat-user-map.js";
import { setPermissionMode } from "../permission-mode/session-mode.js";
import { MODE_LABELS } from "../permission-mode/types.js";
import { createLogger } from "../logger.js";

const log = createLogger("TgHandler");

// 动态节流器类 - 根据内容长度和更新频率调整间隔
class DynamicThrottle {
  private lastUpdate = 0;
  private lastContentLength = 0;
  private consecutiveErrors = 0;
  private baseInterval = TELEGRAM_THROTTLE_MS;

  getNextDelay(contentLength: number): number {
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdate;

    // 如果最近有错误，增加延迟
    if (this.consecutiveErrors > 0) {
      const errorDelay = this.baseInterval * (1 + this.consecutiveErrors * 2);
      this.lastUpdate = now;
      return errorDelay;
    }

    // 内容增长较小时，适当增加延迟
    const contentGrowth = contentLength - this.lastContentLength;
    if (contentGrowth < 50 && timeSinceLastUpdate < 500) {
      this.lastUpdate = now;
      return 500; // 内容增长缓慢时，每 500ms 更新一次
    }

    // 内容增长较快，使用基础间隔
    this.lastUpdate = now;
    this.lastContentLength = contentLength;
    return this.baseInterval;
  }

  recordError(): void {
    this.consecutiveErrors++;
    // 重置时间，确保下次使用延迟
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
  await mkdir(IMAGE_DIR, { recursive: true });
  const fileLink = await bot.telegram.getFileLink(fileId);
  const res = await fetch(fileLink.href, {
    signal: AbortSignal.timeout(30000),
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  const safeId = fileId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const imagePath = join(IMAGE_DIR, `${Date.now()}-${safeId.slice(-8)}.jpg`);
  await writeFile(imagePath, buffer);
  return imagePath;
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
    // 在用户每次发送消息时就累加计数，确保提示能轮换显示
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

    // 创建动态节流器
    const throttle = new DynamicThrottle();

    // 不保存思考内容，只显示最终结果
    let savedThinkingText = "";
    let hasThinkingContent = false; // 始终为 false，不显示思考内容

    // 创建包装的流式更新函数（带串行化、智能跳过和防抖）
    const createStreamUpdateWrapper = () => {
      let lastUpdateTime = 0;
      let lastContentLength = 0;
      let lastContent = "";
      let pendingUpdate: ReturnType<typeof setTimeout> | null = null;
      let updateInProgress = false; // 串行化锁
      let scheduledContent: string | null = null; // 待更新内容
      let scheduledToolNote: string | undefined;

      // 流式输出时显示最后 N 个字符（增加到 1500 以提高流畅度）
      const STREAM_PREVIEW_LENGTH = 1500;

      // 执行更新（串行化）
      const performUpdate = async (
        content: string,
        toolNote?: string,
        isComplete = false,
      ) => {
        // 如果是完成更新，需要优先处理，取消待处理的更新
        if (isComplete) {
          // 清除防抖定时器
          if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }

          // 如果有更新正在进行，等待它完成
          while (updateInProgress) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          // 重置状态，确保完成更新能立即执行
          updateInProgress = false;
          scheduledContent = null;
          scheduledToolNote = undefined;
        }

        if (updateInProgress) {
          // 如果有更新正在进行，保存当前内容待更新
          scheduledContent = content;
          scheduledToolNote = toolNote;
          return;
        }

        updateInProgress = true;

        try {
          let displayContent = content;

          // 如果有思考内容，将其格式化后添加到前面
          if (hasThinkingContent && savedThinkingText) {
            // 思考内容使用引用格式，用分隔线区分
            const thinkingFormatted = `💭 思考过程：\n${savedThinkingText}`;
            const separator = "\n\n─────────\n\n";

            // 组合内容
            const combined = thinkingFormatted + separator + content;

            // 如果组合后超过预览长度，截取最后部分（但保留思考内容）
            if (combined.length > STREAM_PREVIEW_LENGTH) {
              // 如果思考内容本身就很长，截取思考内容
              const maxThinkingLength = 800;
              const truncatedThinking =
                savedThinkingText.length > maxThinkingLength
                  ? `...(已省略 ${savedThinkingText.length - maxThinkingLength} 字符)...\n\n${savedThinkingText.slice(-maxThinkingLength)}`
                  : savedThinkingText;

              displayContent = `💭 思考过程：\n${truncatedThinking}\n\n─────────\n\n`;

              // 添加输出内容的最后部分
              if (content.length > 800) {
                displayContent += `...\n\n${content.slice(-800)}`;
              } else {
                displayContent += content;
              }
            } else {
              displayContent = combined;
            }
          } else {
            // 没有思考内容，直接显示（如果超过预览长度则截取）
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
        } catch (err) {
          throttle.recordError();
        } finally {
          updateInProgress = false;

          // 如果有待更新的内容，立即更新
          if (scheduledContent !== null) {
            const nextContent = scheduledContent;
            const nextNote = scheduledToolNote;
            scheduledContent = null;
            scheduledToolNote = undefined;
            await performUpdate(nextContent, nextNote);
          }
        }
      };

      // 防抖延迟（毫秒）- 降低到 150ms 提高响应速度
      const DEBOUNCE_MS = 150;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      return (content: string, toolNote?: string) => {
        // 检测是否是思考内容，如果则跳过不显示
        if (content.startsWith("💭 **思考中...**")) {
          // 不保存思考内容，直接返回，不触发更新
          return;
        }

        const now = Date.now();
        const elapsed = now - lastUpdateTime;

        // 智能跳过：内容增长小于 30 字符且距离上次更新不足 500ms（降低阈值，提高流畅度）
        const contentGrowth = content.length - lastContentLength;
        if (contentGrowth < 30 && elapsed < 500 && lastContentLength > 0) {
          // 跳过此次更新，但更新长度记录
          lastContentLength = content.length;
          lastContent = content;
          return;
        }

        // 更新记录
        lastContentLength = content.length;
        lastContent = content;

        // 使用动态节流器计算基础延迟
        const baseDelay = throttle.getNextDelay(content.length);

        // 清除之前的防抖定时器
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        // 设置防抖定时器
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
          const note = toolNote ? "输出中...\n" + toolNote : "输出中...";
          updateMessage(
            chatId,
            msgId,
            content,
            "streaming",
            note,
            toolId,
          ).catch(() => {});
        },
        sendComplete: async (content, note) => {
          throttle.reset();
          // 完成时，直接调用 updateMessage 更新状态，绕过流式更新机制
          // 确保完成状态能够立即生效，移除停止按钮
          try {
            await sendFinalMessages(chatId, msgId, content, note, toolId);
          } catch (err) {
            log.error("Failed to send complete message:", err);
            // 如果发送失败，至少尝试更新状态
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
          // 清理思考内容
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
    let text = ctx.message.text.trim();

    if (!accessControl.isAllowed(userId)) {
      await sendTextReply(chatId, "抱歉，您没有访问权限。\n您的 ID: " + userId);
      return;
    }

    setActiveChatId("telegram", chatId);
    setChatUser(chatId, userId);

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
    setChatUser(chatId, userId);

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
