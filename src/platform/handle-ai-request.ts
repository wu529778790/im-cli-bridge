/**
 * Shared handleAIRequest factory for all platform event handlers.
 *
 * Each platform (telegram, feishu, dingtalk, qq, wework, workbuddy)
 * has its own handleAIRequest function with ~80 lines of duplicated
 * code. This factory extracts the common flow:
 *
 *   1. Resolve AI command + get adapter + null check
 *   2. Resolve session
 *   3. Send "thinking" placeholder message
 *   4. Start typing indicator
 *   5. Run AI task via runAITask with platform-specific callbacks
 */

import { resolvePlatformAiCommand, type Config, type Platform } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask, type TaskRunState, type TaskAdapter } from '../shared/ai-task.js';
import { createLogger } from '../logger.js';

const log = createLogger('PlatformAI');

/**
 * Callbacks that vary per platform. The factory uses these to interact
 * with platform-specific message sending and typing indicators.
 */
export interface PlatformSender {
  /** Send the initial "thinking" placeholder. Returns the message ID (or card ID for Feishu). */
  sendThinkingMessage: (chatId: string, replyToMessageId: string | undefined, toolId: string) => Promise<string>;
  /** Send a plain text error reply (used when adapter is null or thinking message fails). */
  sendTextReply: (chatId: string, text: string) => Promise<void>;
  /** Start a typing indicator loop. Returns a stop function. */
  startTyping: (chatId: string) => () => void;
  /** Optional: send an image to the chat. */
  sendImage?: (chatId: string, imagePath: string) => Promise<void>;
}

/**
 * The runAITask callback set, minus the fields the factory fills in
 * (extraCleanup, onTaskReady, throttleMs). Platforms provide these to control
 * streaming, completion, and error behavior.
 */
export interface PlatformTaskCallbacks
  extends Omit<TaskAdapter, 'extraCleanup' | 'onTaskReady' | 'onTaskReady' | 'sendImage' | 'throttleMs'> {
  /** Called after the AI task finishes (success, error, or abort) for cleanup beyond by runningTasks.delete. */
  extraCleanup?: () => void;
}

/**
 * Configuration for the handleAIRequest factory.
 */
export interface HandleAIRequestConfig {
  /** Platform name (telegram, feishu, dingtalk, qq, wework, workbuddy). */
  platform: Platform;
  /** Application config. */
  config: Config;
  /** Session manager instance. */
  sessionManager: SessionManager;
  /** Platform-specific sender callbacks. */
  sender: PlatformSender;
  /** Throttle interval in ms for stream updates. */
  throttleMs: number;
  /** Map of running tasks (owned by the platform event handler). */
  runningTasks: Map<string, TaskRunState>;
  /** Optional: minimum content delta in chars before sending a stream update (QQ uses 80). */
  minContentDeltaChars?: number;
  /** Optional: custom taskKey builder. Default is `${userId}:${msgId}`. Feishu uses cardId. */
  taskKeyBuilder?: (userId: string, msgId: string) => string;
  /** Optional: called when thinking phase transitions to text output (Feishu CardKit). */
  onThinkingToText?: (content: string) => void;
  /** Optional: platform-specific setup before runAITask. Returns a cleanup function. */
  extraInit?: (ctx: { chatId: string; msgId: string; taskKey: string }) => (() => void) | void;
  /**
   * Optional: override runAITask callbacks. When provided, these are spread
   * over the default callbacks. Use this for platform-specific behavior
   * like Feishu's CardKit streaming or WorkBuddy's non-streaming mode.
   */
  taskCallbacks?: PlatformTaskCallbacks;
  /**
   * Optional: factory function to create callbacks with full context.
   * Called after sendThinkingMessage with access to msgId and taskKey.
   * This is useful for platforms like WeWork that need msgId for streaming.
   */
  taskCallbacksFactory?: (ctx: {
    chatId: string;
    msgId: string;
    taskKey: string;
    userId: string;
    toolId: string;
    replyToMessageId: string | undefined;
  }) => PlatformTaskCallbacks;
}

export interface HandleAIRequestParams {
  userId: string;
  chatId: string;
  prompt: string;
  workDir: string;
  convId?: string;
  replyToMessageId?: string;
  /** AbortSignal from the request queue; fires on task timeout */
  signal?: AbortSignal;
}

/**
 * Creates a platform-specific handleAIRequest function.
 *
 * The returned function implements the shared flow:
 * 1. resolvePlatformAiCommand + getAdapter + null check
 * 2. resolve session
 * 3. send "thinking" placeholder
 * 4. start typing indicator
 * 5. run AI task with platform callbacks
 */
export function createPlatformAIRequestHandler(
  deps: HandleAIRequestConfig,
): (params: HandleAIRequestParams) => Promise<void> {
  const {
    platform,
    config,
    sessionManager,
    sender,
    throttleMs,
    runningTasks,
    minContentDeltaChars,
    taskKeyBuilder,
    onThinkingToText,
    extraInit,
    taskCallbacks,
    taskCallbacksFactory,
  } = deps;

  async function handleAIRequest(params: HandleAIRequestParams): Promise<void> {
    const { userId, chatId, prompt, workDir, convId, replyToMessageId, signal } = params;

    log.info(`[${platform}] AI request: userId=${userId}, chatId=${chatId}, promptLength=${prompt.length}`);

    // 1. Resolve AI command and adapter
    const aiCommand = resolvePlatformAiCommand(config, platform);
    const toolAdapter = getAdapter(aiCommand);
    if (!toolAdapter) {
      log.error(`[${platform}] No adapter found for: ${aiCommand}`);
      await sender.sendTextReply(chatId, `未配置 AI 工具: ${aiCommand}`);
      return;
    }

    // 2. Resolve session
    const sessionId = convId
      ? sessionManager.getSessionIdForConv(userId, convId, aiCommand)
      : undefined;
    log.info(`[${platform}] Running ${aiCommand} for user ${userId}, sessionId=${sessionId ?? 'new'}`);

    // 3. Send "thinking" placeholder
    const toolId = aiCommand;
    let msgId: string;
    try {
      msgId = await sender.sendThinkingMessage(chatId, replyToMessageId, toolId);
    } catch (err) {
      log.error(`[${platform}] Failed to send thinking message:`, err);
      try {
        await sender.sendTextReply(chatId, '启动 AI 处理失败，请重试。');
      } catch (fallbackErr) {
        log.warn(`[${platform}] Failed to send startup error reply:`, fallbackErr);
      }
      return;
    }

    // 4. Start typing indicator
    const stopTyping = sender.startTyping(chatId);

    // Build taskKey (default: userId:msgId, Feishu uses userId:cardId)
    const taskKey = taskKeyBuilder ? taskKeyBuilder(userId, msgId) : `${userId}:${msgId}`;

    // 5. Platform-specific init (returns cleanup fn)
    let initCleanup: (() => void) | undefined;
    if (extraInit) {
      const result = extraInit({ chatId, msgId, taskKey });
      if (result) initCleanup = result;
    }

    // 6. Build task callbacks
    const defaultCallbacks: TaskAdapter = {
      throttleMs,
      ...(minContentDeltaChars != null ? { minContentDeltaChars } : {}),
      streamUpdate: async (_content: string, _toolNote?: string) => {
        // Default no-op; platforms override via taskCallbacks or taskCallbacksFactory
      },
      sendComplete: async (_content: string, _note?: string) => {
        // Default no-op; platforms override via taskCallbacks or taskCallbacksFactory
      },
      sendError: async (_error: string) => {
        // Default no-op; platforms override via taskCallbacks or taskCallbacksFactory
      },
      onTaskReady: (state: TaskRunState) => {
        runningTasks.set(taskKey, state);
      },
      extraCleanup: () => {
        stopTyping();
        initCleanup?.();
        runningTasks.delete(taskKey);
      },
    };

    // Merge in platform callbacks (if provided)
    let mergedCallbacks: TaskAdapter = { ...defaultCallbacks };

    // Use taskCallbacksFactory if provided (has full context access)
    if (taskCallbacksFactory) {
      const factoryCallbacks = taskCallbacksFactory({
        chatId,
        msgId,
        taskKey,
        userId,
        toolId,
        replyToMessageId,
      });
      if (factoryCallbacks.streamUpdate) {
        mergedCallbacks.streamUpdate = factoryCallbacks.streamUpdate;
      }
      if (factoryCallbacks.sendComplete) {
        mergedCallbacks.sendComplete = factoryCallbacks.sendComplete;
      }
      if (factoryCallbacks.sendError) {
        mergedCallbacks.sendError = factoryCallbacks.sendError;
      }
      if (factoryCallbacks.onFirstContent) {
        mergedCallbacks.onFirstContent = factoryCallbacks.onFirstContent;
      }
    } else if (taskCallbacks) {
      // Fall back to static taskCallbacks
      if (taskCallbacks.streamUpdate) {
        mergedCallbacks.streamUpdate = taskCallbacks.streamUpdate;
      }
      if (taskCallbacks.sendComplete) {
        mergedCallbacks.sendComplete = taskCallbacks.sendComplete;
      }
      if (taskCallbacks.sendError) {
        mergedCallbacks.sendError = taskCallbacks.sendError;
      }
      if (taskCallbacks.onFirstContent) {
        mergedCallbacks.onFirstContent = taskCallbacks.onFirstContent;
      }
    }

    if (onThinkingToText) {
      mergedCallbacks.onThinkingToText = onThinkingToText;
    }
    if (sender.sendImage) {
      mergedCallbacks.sendImage = (imagePath: string) => sender.sendImage!(chatId, imagePath);
    }

    // Wrap extraCleanup to also call the platform's extraCleanup
    const platformExtraCleanup = taskCallbacks?.extraCleanup ?? taskCallbacksFactory?.({ chatId, msgId, taskKey, userId, toolId, replyToMessageId }).extraCleanup;
    const originalExtraCleanup = mergedCallbacks.extraCleanup!;
    mergedCallbacks.extraCleanup = () => {
      originalExtraCleanup();
      platformExtraCleanup?.();
    };

    // 7. Run AI task
    try {
      await runAITask(
        { config, sessionManager },
        {
          userId,
          chatId,
          workDir,
          sessionId,
          convId,
          platform,
          taskKey,
          signal,
        },
        prompt,
        toolAdapter,
        mergedCallbacks,
      );
    } catch (err) {
      log.error(`[${platform}] runAITask threw:`, err);
      // Ensure cleanup happens even if runAITask throws synchronously
      mergedCallbacks.extraCleanup?.();
    }
  }

  return handleAIRequest;
}
