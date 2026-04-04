/**
 * 共享 AI 任务执行层，支持多 ToolAdapter。
 */

import type { Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import type { ToolAdapter } from '../adapters/tool-adapter.interface.js';
import type { ParsedResult } from '../adapters/tool-adapter.interface.js';
import { resolvePlatformAiCommand, type Platform } from '../config.js';
import {
  formatToolStats,
  formatToolCallNotification,
  getContextWarning,
  getAIToolDisplayName,
} from './utils.js';
import { createLogger } from '../logger.js';

const log = createLogger('AITask');

export interface TaskDeps {
  config: Config;
  sessionManager: SessionManager;
}

export interface TaskContext {
  userId: string;
  chatId: string;
  workDir: string;
  sessionId: string | undefined;
  convId?: string;
  threadId?: string;
  platform: string;
  taskKey: string;
  /** AbortSignal from the request queue; fires on task timeout to abort the running SDK session */
  signal?: AbortSignal;
}

export interface TaskAdapter {
  streamUpdate(content: string, toolNote?: string): void;
  sendComplete(content: string, note: string, thinkingText?: string): Promise<void>;
  sendError(error: string): Promise<void>;
  onThinkingToText?(content: string): void;
  extraCleanup?(): void;
  throttleMs: number;
  /** 块级流式：仅当内容增长超过此字符数时才更新，减少 patch 次数。 */
  minContentDeltaChars?: number;
  onTaskReady(state: TaskRunState): void;
  onFirstContent?(): void;
  sendImage?(imagePath: string): Promise<void>;
}

export interface TaskRunState {
  handle: { abort: () => void };
  latestContent: string;
  settle: () => void;
  startedAt: number;
  /** AI 工具标识，用于动态显示工具名称。 */
  toolId: string;
}

function isUsageLimitError(error: string): boolean {
  return /usage limit/i.test(error) || /try again at\s+\d{1,2}:\d{2}\s*(AM|PM)/i.test(error);
}

function buildCompletionNote(
  result: ParsedResult,
  sessionManager: SessionManager,
  ctx: TaskContext
): string {
  const toolInfo = formatToolStats(result.toolStats, result.numTurns);
  const parts: string[] = [];
  parts.push(`耗时 ${(result.durationMs / 1000).toFixed(1)}s`);
  if (toolInfo) parts.push(toolInfo);
  if (result.model) parts.push(result.model);

  const currentTurns = ctx.threadId
    ? sessionManager.addTurnsForThread(ctx.userId, ctx.threadId, 0)
    : sessionManager.addTurns(ctx.userId, 0);
  const ctxWarning = getContextWarning(currentTurns);
  if (ctxWarning) parts.push(ctxWarning);

  return parts.join(' | ');
}

export function runAITask(
  deps: TaskDeps,
  ctx: TaskContext,
  prompt: string,
  toolAdapter: ToolAdapter,
  platformAdapter: TaskAdapter
): Promise<void> {
  const { config, sessionManager } = deps;
  return new Promise((resolve) => {
    let lastUpdateTime = 0;
    let lastSentContentLength = 0;
    let pendingUpdate: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let firstContentLogged = false;
    let wasThinking = false;
    let thinkingText = '';
    let currentSessionId = ctx.sessionId;
    let hadSessionInvalid = false;
    let activeHandle: { abort: () => void } | null = null;
    const toolLines: string[] = [];
    const minDelta = platformAdapter.minContentDeltaChars ?? 0;

    const cleanup = () => {
      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
        pendingUpdate = null;
      }
      platformAdapter.extraCleanup?.();
    };

    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    // Declared before assignment so closures can capture it; object is assigned below
    // eslint-disable-next-line prefer-const -- assigned once after closures are defined
    let taskState: TaskRunState;

    const throttledUpdate = (content: string, force = false) => {
      taskState.latestContent = content;
      const now = Date.now();
      const elapsed = now - lastUpdateTime;
      const contentDelta = content.length - lastSentContentLength;
      const shouldUpdateByTime = elapsed >= platformAdapter.throttleMs;
      const shouldUpdateByContent = minDelta > 0 && contentDelta >= minDelta;

      if (force || shouldUpdateByTime || shouldUpdateByContent) {
        lastUpdateTime = now;
        lastSentContentLength = content.length;
        if (pendingUpdate) {
          clearTimeout(pendingUpdate);
          pendingUpdate = null;
        }
        const toolNote = toolLines.length > 0 ? toolLines.slice(-3).join('\n') : undefined;
        platformAdapter.streamUpdate(content, toolNote);
      } else if (!pendingUpdate) {
        pendingUpdate = setTimeout(() => {
          pendingUpdate = null;
          lastUpdateTime = Date.now();
          lastSentContentLength = taskState.latestContent.length;
          const toolNote = toolLines.length > 0 ? toolLines.slice(-3).join('\n') : undefined;
          platformAdapter.streamUpdate(taskState.latestContent, toolNote);
        }, platformAdapter.throttleMs - elapsed);
      }
    };

    // 使用 aiCommand 而不是 toolAdapter.toolId，确保 sessionId 的存储和查询使用相同的 key
    const aiCommand = resolvePlatformAiCommand(config, ctx.platform as Platform);
    const toolId = toolAdapter.toolId as 'claude' | 'codex' | 'codebuddy';

    const startRun = () => {
      log.info(`[AITask] Starting: userId=${ctx.userId}, initialSessionId=${currentSessionId ?? 'new'}, prompt="${prompt.slice(0, 50)}..."`);

      activeHandle = toolAdapter.run(
        prompt,
        currentSessionId,
        ctx.workDir,
        {
        onSessionId: (id) => {
          log.info(`[AITask] SessionId callback: old=${currentSessionId ?? 'none'}, new=${id}, aiCommand=${aiCommand}, userId=${ctx.userId}`);
          currentSessionId = id;
          // 使用 aiCommand 而不是 toolId，确保与查询时使用相同的 key
          if (ctx.threadId) sessionManager.setSessionIdForThread(ctx.userId, ctx.threadId, aiCommand, id);
          else if (ctx.convId) sessionManager.setSessionIdForConv(ctx.userId, ctx.convId, aiCommand, id);
          else log.info(`[AITask] No threadId or convId, sessionId not persisted to storage`);
        },
        onSessionInvalid: () => {
          hadSessionInvalid = true;
          if (ctx.convId) sessionManager.clearSessionForConv(ctx.userId, ctx.convId, aiCommand);
          const ok = sessionManager.newSession(ctx.userId);
          log.info(
            `[AITask] Session invalid for user ${ctx.userId}, aiCommand=${aiCommand}; auto /new applied, ok=${ok}`
          );
        },
        onThinking: (t) => {
          if (!firstContentLogged) {
            firstContentLogged = true;
            platformAdapter.onFirstContent?.();
          }
          wasThinking = true;
          thinkingText = t;
          throttledUpdate(`💭 **${getAIToolDisplayName(toolId)} 思考中...**\n\n${t}`);
        },
        onText: (accumulated) => {
          if (!firstContentLogged) {
            firstContentLogged = true;
            platformAdapter.onFirstContent?.();
          }
          if (wasThinking && platformAdapter.onThinkingToText) {
            wasThinking = false;
            if (pendingUpdate) {
              clearTimeout(pendingUpdate);
              pendingUpdate = null;
            }
            lastUpdateTime = Date.now();
            taskState.latestContent = accumulated;
            platformAdapter.onThinkingToText(accumulated);
            return;
          }
          wasThinking = false;
          throttledUpdate(accumulated);
        },
        onToolUse: (toolName, toolInput) => {
          const notification = formatToolCallNotification(toolName, toolInput);
          toolLines.push(notification);
          if (toolLines.length > 5) toolLines.shift();
          throttledUpdate(taskState.latestContent, true);
        },
        onComplete: async (result) => {
          if (settled) return;
          settled = true;
          if (pendingUpdate) {
            clearTimeout(pendingUpdate);
            pendingUpdate = null;
          }
          const note = buildCompletionNote(result, sessionManager, ctx);
          const output =
            result.accumulated ||
            result.result ||
            taskState.latestContent ||
            '(无输出)';
          if (!result.accumulated && !result.result && taskState.latestContent) {
            log.warn(
              `Empty AI output from adapter but had streamed content (${taskState.latestContent.length} chars), using latestContent. platform=${ctx.platform}, taskKey=${ctx.taskKey}`
            );
          } else if (!output || output === '(无输出)') {
            log.warn(
              `Empty AI output for user ${ctx.userId}, platform=${ctx.platform}, taskKey=${ctx.taskKey}`
            );
          }
          const sendCompleteWithRetry = async (attempt = 1): Promise<void> => {
            const maxAttempts = 2;
            try {
              await platformAdapter.sendComplete(output, note, thinkingText || undefined);
            } catch (err) {
              log.error(`Failed to send complete (attempt ${attempt}/${maxAttempts}):`, err);
              if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, 2000));
                return sendCompleteWithRetry(attempt + 1);
              }
              try {
                await platformAdapter.sendError(
                  '回复发送失败（网络异常），请重试。若多次出现可检查本机网络或稍后再试。'
                );
              } catch (sendErr) {
                log.error('Failed to send error fallback:', sendErr);
              }
            }
          };
          try {
            await sendCompleteWithRetry();
          } finally {
            cleanup();
            resolve();
          }
        },
        onError: async (error) => {
          if (settled) return;
          if (pendingUpdate) {
            clearTimeout(pendingUpdate);
            pendingUpdate = null;
          }
          settled = true;
          log.error(`Task error for user ${ctx.userId}: ${error}`);
          if (aiCommand !== 'claude' && !isUsageLimitError(error)) {
            if (ctx.convId) sessionManager.clearSessionForConv(ctx.userId, ctx.convId, aiCommand);
            else sessionManager.clearActiveToolSession(ctx.userId, aiCommand);
            log.info(`Session reset for user ${ctx.userId} due to ${aiCommand} task error`);
          } else if (aiCommand === 'codex' && isUsageLimitError(error)) {
            log.info(`Keeping codex session for user ${ctx.userId} after usage limit error`);
          }
          const friendlyError = hadSessionInvalid
            ? '当前 Claude 会话已失效，已自动执行 /new 重置会话，请重新发送刚才的问题。'
            : error;
          try {
            await platformAdapter.sendError(friendlyError);
          } catch (err) {
            log.error('Failed to send error:', err);
          }
          cleanup();
          resolve();
        },
        },
        {
          model: sessionManager.getModel(ctx.userId, ctx.threadId) ?? config.claudeModel,
          chatId: ctx.chatId,
          // 默认跳过权限确认，保持全自动执行（可通过 config 或环境变量关闭）
          skipPermissions: config.skipPermissions ?? true,
          ...(aiCommand === 'codex' && config.codexProxy ? { proxy: config.codexProxy } : {}),
        }
      );
      return activeHandle;
    };

    taskState = {
      handle: {
        abort: () => {
          activeHandle?.abort();
          cleanup();
          settle();
        },
      },
      latestContent: '',
      settle,
      startedAt: Date.now(),
      toolId: aiCommand,
    };
    try {
      startRun();
    } catch (err) {
      if (!settled) {
        settled = true;
        cleanup();
        log.error(`[AITask] Synchronous error in startRun: ${err}`);
        platformAdapter.sendError(
          `内部错误：${err instanceof Error ? err.message : String(err)}`
        ).catch(() => { /* ignore */ });
        resolve();
      }
      return;
    }
    platformAdapter.onTaskReady(taskState);

    // Wire queue abort signal to the running task's abort handle
    if (ctx.signal) {
      if (ctx.signal.aborted) {
        taskState.handle.abort();
      } else {
        ctx.signal.addEventListener('abort', () => taskState.handle.abort(), { once: true });
      }
    }
  });
}
