import type { DWClientDownStream, RobotMessage } from 'dingtalk-stream';
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
  sendDirectorySelection,
} from './message-sender.js';
import { ackMessage, registerSessionWebhook } from './client.js';
import { registerPermissionSender } from '../hook/permission-server.js';
import { CommandHandler } from '../commands/handler.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask, type TaskRunState } from '../shared/ai-task.js';
import { startTaskCleanup } from '../shared/task-cleanup.js';
import { setActiveChatId, setDingTalkActiveTarget } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import { createLogger } from '../logger.js';
import type { ThreadContext } from '../shared/types.js';

const log = createLogger('DingTalkHandler');
const DINGTALK_THROTTLE_MS = 1000;

export interface DingTalkEventHandlerHandle {
  stop: () => void;
  getRunningTaskCount: () => number;
  handleEvent: (data: DWClientDownStream) => Promise<void>;
}

function parseRobotMessage(data: DWClientDownStream): RobotMessage | null {
  try {
    return JSON.parse(data.data) as RobotMessage;
  } catch (err) {
    log.error('Failed to parse DingTalk message:', err);
    return null;
  }
}

export function setupDingTalkHandlers(
  config: Config,
  sessionManager: SessionManager,
): DingTalkEventHandlerHandle {
  const accessControl = new AccessControl(config.dingtalkAllowedUserIds);
  const requestQueue = new RequestQueue();
  const runningTasks = new Map<string, TaskRunState>();
  const stopTaskCleanup = startTaskCleanup(runningTasks);

  const commandHandler = new CommandHandler({
    config,
    sessionManager,
    requestQueue,
    sender: { sendTextReply, sendModeCard, sendDirectorySelection },
    getRunningTasksSize: () => runningTasks.size,
  });

  registerPermissionSender('dingtalk', { sendTextReply, sendPermissionCard });

  async function handleAIRequest(
    userId: string,
    chatId: string,
    prompt: string,
    workDir: string,
    convId?: string,
    _threadCtx?: ThreadContext,
    replyToMessageId?: string,
  ) {
    log.info(`[AI_REQUEST] userId=${userId}, chatId=${chatId}, promptLength=${prompt.length}`);

    const toolAdapter = getAdapter(config.aiCommand);
    if (!toolAdapter) {
      await sendTextReply(chatId, `未配置 AI 工具: ${config.aiCommand}`);
      return;
    }

    const sessionId = convId
      ? sessionManager.getSessionIdForConv(userId, convId, config.aiCommand)
      : undefined;
    log.info(`[AI_REQUEST] Running ${config.aiCommand} for user ${userId}, sessionId=${sessionId ?? 'new'}`);

    const toolId = config.aiCommand;
    const msgId = await sendThinkingMessage(chatId, replyToMessageId, toolId);
    const stopTyping = startTypingLoop(chatId);
    const taskKey = `${userId}:${msgId}`;

    await runAITask(
      { config, sessionManager },
      { userId, chatId, workDir, sessionId, convId, platform: 'dingtalk', taskKey },
      prompt,
      toolAdapter,
      {
        throttleMs: DINGTALK_THROTTLE_MS,
        streamUpdate: async (content, toolNote) => {
          await updateMessage(chatId, msgId, content, 'streaming', toolNote, toolId);
        },
        sendComplete: async (content, note) => {
          await sendFinalMessages(chatId, msgId, content, note ?? '', toolId);
        },
        sendError: async (error) => {
          await sendTextReply(chatId, `错误：${error}`);
        },
        extraCleanup: () => {
          stopTyping();
          runningTasks.delete(taskKey);
        },
        onTaskReady: (state) => {
          runningTasks.set(taskKey, state);
        },
        sendImage: async (path) => {
          await sendTextReply(chatId, `图片已保存: ${path}`);
        },
      },
    );
  }

  async function handleEvent(data: DWClientDownStream): Promise<void> {
    const robotMessage = parseRobotMessage(data);
    const callbackId = data.headers.messageId;

    if (!robotMessage) {
      ackMessage(callbackId, { error: 'invalid payload' });
      return;
    }

    const chatId = robotMessage.conversationId;
    const userId = robotMessage.senderStaffId || robotMessage.senderId;
    const text = robotMessage.msgtype === 'text' ? robotMessage.text?.content?.trim() ?? '' : '';

    registerSessionWebhook(chatId, robotMessage.sessionWebhook);
    setActiveChatId('dingtalk', chatId);
    setDingTalkActiveTarget({
      chatId,
      userId,
      conversationType: robotMessage.conversationType,
      robotCode: robotMessage.robotCode,
    });
    setChatUser(chatId, userId, 'dingtalk');

    log.info(`[MSG] DingTalk message: type=${robotMessage.msgtype}, user=${userId}, chat=${chatId}`);

    if (!accessControl.isAllowed(userId)) {
      await sendTextReply(chatId, `抱歉，您没有访问权限。\n您的 ID: ${userId}`);
      ackMessage(callbackId, { denied: true });
      return;
    }

    if (robotMessage.msgtype !== 'text') {
      await sendTextReply(chatId, `暂不支持的消息类型: ${robotMessage.msgtype}`);
      ackMessage(callbackId, { ignored: robotMessage.msgtype });
      return;
    }

    if (!text) {
      ackMessage(callbackId, { ignored: 'empty text' });
      return;
    }

    try {
      const handled = await commandHandler.dispatch(text, chatId, userId, 'dingtalk', handleAIRequest);
      if (handled) {
        ackMessage(callbackId, { handled: true });
        return;
      }
    } catch (err) {
      log.error('Error in commandHandler.dispatch:', err);
    }

    const workDir = sessionManager.getWorkDir(userId);
    const convId = sessionManager.getConvId(userId);
    const enqueueResult = requestQueue.enqueue(userId, convId, text, async (prompt) => {
      await handleAIRequest(userId, chatId, prompt, workDir, convId);
    });

    if (enqueueResult === 'rejected') {
      await sendTextReply(chatId, '请求队列已满，请稍后再试。');
    } else if (enqueueResult === 'queued') {
      await sendTextReply(chatId, '您的请求已排队等待。');
    }

    ackMessage(callbackId, { queued: enqueueResult });
  }

  return {
    stop: () => stopTaskCleanup(),
    getRunningTaskCount: () => runningTasks.size,
    handleEvent,
  };
}
