/**
 * Shared text message flow handler for all platform event handlers.
 *
 * Every platform (telegram, feishu, dingtalk, qq, wework, workbuddy)
 * processes incoming text messages through the same steps:
 *
 *   1. Access control check → deny with error message
 *   2. setActiveChatId(platform, chatId)
 *   3. setChatUser(chatId, userId, platform)
 *   4. Command dispatch via commandHandler.dispatch()
 *   5. If not handled: empty text → return, otherwise enqueue AI request
 *   6. Handle queue-full notification (rejected / queued)
 *
 * This module extracts that flow so each platform only needs to provide
 * the platform-specific parameters and callbacks.
 */

import { setActiveChatId } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import type { Platform } from '../config.js';
import type { PlatformEventContext } from './create-event-context.js';
import type { EnqueueResult } from '../queue/request-queue.js';
import type { ClaudeRequestHandler } from '../commands/handler.js';

type HandleAIRequestFn = ClaudeRequestHandler;
import { createLogger } from '../logger.js';

const log = createLogger('TextFlow');

/**
 * Callback to send a text reply to the user.
 * Used for access-denied messages and queue status notifications.
 */
export type SendTextReplyFn = (chatId: string, text: string) => Promise<void>;

/**
 * Parameters for the shared text flow handler.
 */
export interface HandleTextFlowParams {
  /** Platform identifier (telegram, feishu, dingtalk, qq, wework, workbuddy). */
  platform: Platform;
  /** The user ID extracted from the incoming message. */
  userId: string;
  /** The chat/conversation ID. */
  chatId: string;
  /** The trimmed text content of the message. */
  text: string;
  /** The platform event context (accessControl, commandHandler, requestQueue, etc.). */
  ctx: PlatformEventContext;
  /** The platform-specific AI request handler (from createPlatformAIRequestHandler). */
  handleAIRequest: HandleAIRequestFn;
  /** Function to send a text reply back to the user. */
  sendTextReply: SendTextReplyFn;
  /** Optional: additional workDir override. If not provided, resolved from sessionManager. */
  workDir?: string;
  /** Optional: additional convId override. If not provided, resolved from sessionManager. */
  convId?: string;
  /** Optional: replyToMessageId for the AI request (e.g., Telegram message reply). */
  replyToMessageId?: string;
  /** Optional: access-denied message template. Defaults to standard Chinese message. */
  accessDeniedMessage?: (userId: string) => string;
  /** Optional: queue-full message. Defaults to standard message. */
  queueFullMessage?: string;
  /** Optional: queued message. Defaults to standard message. */
  queuedMessage?: string;
  /**
   * Optional: custom enqueue function.
   * When provided, this is called instead of the default requestQueue.enqueue flow.
   * This allows platforms like WorkBuddy to pass additional context.
   */
  customEnqueue?: (prompt: string) => Promise<EnqueueResult> | EnqueueResult;
}

/** Default access-denied message. */
function defaultAccessDeniedMessage(userId: string): string {
  return `抱歉，您没有访问权限。\n您的 ID: ${userId}`;
}

/** Default queue-full message. */
const DEFAULT_QUEUE_FULL_MESSAGE = '请求队列已满，请稍后再试。';

/** Default queued message. */
const DEFAULT_QUEUED_MESSAGE = '您的请求已排队等待。';

/**
 * Handles the full text message flow shared across all platforms.
 *
 * Steps:
 * 1. Access control check — if denied, sends error message and returns false.
 * 2. Sets active chat ID and chat-user mapping.
 * 3. Dispatches to command handler — if handled, returns true.
 * 4. If text is empty, returns true (no action needed).
 * 5. Enqueues the AI request.
 * 6. Handles queue-full notifications (rejected / queued).
 *
 * @returns true if the message was processed (handled or enqueued), false if denied.
 */
export async function handleTextFlow(params: HandleTextFlowParams): Promise<boolean> {
  const {
    platform,
    userId,
    chatId,
    text,
    ctx,
    handleAIRequest,
    sendTextReply,
    workDir: workDirOverride,
    convId: convIdOverride,
    replyToMessageId,
    accessDeniedMessage = defaultAccessDeniedMessage,
    queueFullMessage = DEFAULT_QUEUE_FULL_MESSAGE,
    queuedMessage = DEFAULT_QUEUED_MESSAGE,
    customEnqueue,
  } = params;

  // 1. Access control check
  if (!ctx.accessControl.isAllowed(userId)) {
    log.info(`[${platform}] Access denied for user: ${userId}`);
    await sendTextReply(chatId, accessDeniedMessage(userId));
    return false;
  }

  // 2. Set active chat ID
  setActiveChatId(platform, chatId);

  // 3. Set chat-user mapping
  setChatUser(chatId, userId, platform);

  // 4. Command dispatch
  try {
    // Create a wrapper that matches ClaudeRequestHandler signature
    const handleAIRequestWrapper: ClaudeRequestHandler = (
      userId,
      chatId,
      prompt,
      workDir,
      convId,
      _threadCtx,
      replyToMessageId
    ) => {
      return handleAIRequest({
        userId,
        chatId,
        prompt,
        workDir,
        convId,
        replyToMessageId,
      });
    };

    const handled = await ctx.commandHandler.dispatch(
      text,
      chatId,
      userId,
      platform,
      handleAIRequestWrapper,
    );
    if (handled) {
      return true;
    }
  } catch (err) {
    log.error(`[${platform}] Error in commandHandler.dispatch:`, err);
  }

  // 5. If text is empty, nothing to do
  if (!text) {
    return true;
  }

  // 6. Enqueue AI request
  if (customEnqueue) {
    // Platform-specific enqueue (e.g., WorkBuddy with extra context)
    const enqueueResult = await customEnqueue(text);

    if (enqueueResult === 'rejected') {
      await sendTextReply(chatId, queueFullMessage);
    } else if (enqueueResult === 'queued') {
      await sendTextReply(chatId, queuedMessage);
    }
  } else {
    // Standard enqueue flow
    const { requestQueue } = ctx;
    const workDir = workDirOverride;
    const convId = convIdOverride;

    const enqueueResult: EnqueueResult = requestQueue.enqueue(
      userId,
      convId ?? '',
      text,
      async (prompt, signal) => {
        await handleAIRequest({
          userId,
          chatId,
          prompt,
          workDir: workDir ?? '',
          convId,
          replyToMessageId,
          signal,
        });
      },
    );

    if (enqueueResult === 'rejected') {
      await sendTextReply(chatId, queueFullMessage);
    } else if (enqueueResult === 'queued') {
      await sendTextReply(chatId, queuedMessage);
    }
  }

  return true;
}
