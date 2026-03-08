import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
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
  sendImageReply,
} from './message-sender.js';
import { registerPermissionSender, resolvePermissionById } from '../hook/permission-server.js';
import { CommandHandler } from '../commands/handler.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask, type TaskRunState } from '../shared/ai-task.js';
import { startTaskCleanup } from '../shared/task-cleanup.js';
import { MessageDedup } from '../shared/message-dedup.js';
import { THROTTLE_MS, IMAGE_DIR } from '../constants.js';
import { setActiveChatId } from '../shared/active-chats.js';
import { createLogger } from '../logger.js';

const log = createLogger('TgHandler');

async function downloadTelegramPhoto(bot: Telegraf, fileId: string): Promise<string> {
  await mkdir(IMAGE_DIR, { recursive: true });
  const fileLink = await bot.telegram.getFileLink(fileId);
  const res = await fetch(fileLink.href, { signal: AbortSignal.timeout(30000) });
  const buffer = Buffer.from(await res.arrayBuffer());
  const safeId = fileId.replace(/[^a-zA-Z0-9_-]/g, '_');
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
  sessionManager: SessionManager
): TelegramEventHandlerHandle {
  const accessControl = new AccessControl(config.allowedUserIds);
  const requestQueue = new RequestQueue();
  const userCosts = new Map<string, { totalCost: number; totalDurationMs: number; requestCount: number }>();
  const runningTasks = new Map<string, TaskRunState>();
  const stopTaskCleanup = startTaskCleanup(runningTasks);
  const dedup = new MessageDedup();

  const commandHandler = new CommandHandler({
    config,
    sessionManager,
    requestQueue,
    sender: { sendTextReply },
    userCosts,
    getRunningTasksSize: () => runningTasks.size,
  });

  registerPermissionSender('telegram', {});

  async function handleAIRequest(
    userId: string,
    chatId: string,
    prompt: string,
    workDir: string,
    convId?: string,
    _threadCtx?: { rootMessageId: string; threadId: string },
    replyToMessageId?: string
  ) {
    const toolAdapter = getAdapter(config.aiCommand);
    if (!toolAdapter) {
      await sendTextReply(chatId, `未配置 AI 工具: ${config.aiCommand}`);
      return;
    }

    const sessionId = convId ? sessionManager.getSessionIdForConv(userId, convId) : undefined;
    log.info(`Running ${config.aiCommand} for user ${userId}, sessionId=${sessionId ?? 'new'}`);

    let msgId: string;
    try {
      msgId = await sendThinkingMessage(chatId, replyToMessageId);
    } catch (err) {
      log.error('Failed to send thinking message:', err);
      return;
    }

    const stopTyping = startTypingLoop(chatId);
    const taskKey = `${userId}:${msgId}`;

    await runAITask(
      { config, sessionManager, userCosts },
      { userId, chatId, workDir, sessionId, convId, platform: 'telegram', taskKey },
      prompt,
      toolAdapter,
      {
        throttleMs: THROTTLE_MS,
        streamUpdate: (content, toolNote) => {
          const note = toolNote ? '输出中...\n' + toolNote : '输出中...';
          updateMessage(chatId, msgId, content, 'streaming', note).catch(() => {});
        },
        sendComplete: async (content, note) => {
          await sendFinalMessages(chatId, msgId, content, note);
        },
        sendError: async (error) => {
          await updateMessage(chatId, msgId, `错误：${error}`, 'error', '执行失败');
        },
        extraCleanup: () => {
          stopTyping();
          runningTasks.delete(taskKey);
        },
        onTaskReady: (state) => {
          runningTasks.set(taskKey, state);
        },
        sendImage: (path) => sendImageReply(chatId, path),
      }
    );
  }

  bot.on('callback_query', async (ctx) => {
    const query = ctx.callbackQuery;
    if (!('data' in query)) return;
    const userId = String(ctx.from?.id ?? '');
    const data = query.data as string;

    if (data.startsWith('stop_')) {
      const messageId = data.replace('stop_', '');
      const taskKey = `${userId}:${messageId}`;
      const taskInfo = runningTasks.get(taskKey);
      if (taskInfo) {
        runningTasks.delete(taskKey);
        taskInfo.settle();
        taskInfo.handle.abort();
        const chatId = String(ctx.chat?.id ?? '');
        await updateMessage(chatId, messageId, taskInfo.latestContent || '已停止', 'error', '⏹️ 已停止');
        await ctx.answerCbQuery('已停止执行');
      } else {
        await ctx.answerCbQuery('任务已完成或不存在');
      }
    } else if (data.startsWith('perm_allow_') || data.startsWith('perm_deny_')) {
      const isAllow = data.startsWith('perm_allow_');
      const requestId = data.replace(/^perm_(allow|deny)_/, '');
      const decision = isAllow ? 'allow' : 'deny';
      resolvePermissionById(requestId, decision);
      await ctx.answerCbQuery(isAllow ? '✅ 已允许' : '❌ 已拒绝');
    }
  });

  bot.on(message('text'), async (ctx) => {
    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from!.id);
    const messageId = String(ctx.message.message_id);
    let text = ctx.message.text.trim();

    if (dedup.isDuplicate(`${chatId}:${messageId}`)) return;

    if (!accessControl.isAllowed(userId)) {
      await sendTextReply(chatId, '抱歉，您没有访问权限。\n您的 ID: ' + userId);
      return;
    }

    setActiveChatId('telegram', chatId);

    if (await commandHandler.dispatch(text, chatId, userId, 'telegram', handleAIRequest)) {
      return;
    }

    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);
    const enqueueResult = requestQueue.enqueue(userId, convId, text, async (prompt) => {
      await handleAIRequest(userId, chatId, prompt, workDir, convId, undefined, messageId);
    });

    if (enqueueResult === 'rejected') {
      await sendTextReply(chatId, '请求队列已满，请稍后再试。');
    } else if (enqueueResult === 'queued') {
      await sendTextReply(chatId, '您的请求已排队等待。');
    }
  });

  bot.on(message('photo'), async (ctx) => {
    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from!.id);
    const caption = ctx.message.caption?.trim() || '';

    if (dedup.isDuplicate(`${chatId}:${ctx.message.message_id}`)) return;
    if (!accessControl.isAllowed(userId)) return;

    setActiveChatId('telegram', chatId);

    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    let imagePath: string;
    try {
      imagePath = await downloadTelegramPhoto(bot, largest.file_id);
    } catch (err) {
      log.error('Failed to download photo:', err);
      await sendTextReply(chatId, '图片下载失败。');
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
