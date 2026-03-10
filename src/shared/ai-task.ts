/**
 * 共享 AI 任务执行层 - 支持多 ToolAdapter
 */

import type { Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import type { ToolAdapter } from '../adapters/tool-adapter.interface.js';
import type { ParsedResult } from '../adapters/tool-adapter.interface.js';
import {
  formatToolStats,
  formatToolCallNotification,
  getContextWarning,
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
}

export interface TaskAdapter {
  streamUpdate(content: string, toolNote?: string): void;
  sendComplete(content: string, note: string, thinkingText?: string): Promise<void>;
  sendError(error: string): Promise<void>;
  onThinkingToText?(content: string): void;
  extraCleanup?(): void;
  throttleMs: number;
  onTaskReady(state: TaskRunState): void;
  onFirstContent?(): void;
  sendImage?(imagePath: string): Promise<void>;
}

export interface TaskRunState {
  handle: { abort: () => void };
  latestContent: string;
  settle: () => void;
  startedAt: number;
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

  // 获取当前的总轮数（不再累加，因为已经在请求开始时累加了）
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
    let pendingUpdate: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let firstContentLogged = false;
    let wasThinking = false;
    let thinkingText = '';
    const toolLines: string[] = [];
    const startTime = Date.now();

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

    let taskState: TaskRunState;

    const throttledUpdate = (content: string) => {
      taskState.latestContent = content;
      const now = Date.now();
      const elapsed = now - lastUpdateTime;

      if (elapsed >= platformAdapter.throttleMs) {
        lastUpdateTime = now;
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
          const toolNote = toolLines.length > 0 ? toolLines.slice(-3).join('\n') : undefined;
          platformAdapter.streamUpdate(taskState.latestContent, toolNote);
        }, platformAdapter.throttleMs - elapsed);
      }
    };

    const handle = toolAdapter.run(
      prompt,
      ctx.sessionId,
      ctx.workDir,
      {
        onSessionId: (id) => {
          if (ctx.threadId) sessionManager.setSessionIdForThread(ctx.userId, ctx.threadId, id);
          else if (ctx.convId) sessionManager.setSessionIdForConv(ctx.userId, ctx.convId, id);
        },
        onThinking: (t) => {
          if (!firstContentLogged) {
            firstContentLogged = true;
            platformAdapter.onFirstContent?.();
          }
          wasThinking = true;
          thinkingText = t;
          throttledUpdate(`💭 **思考中...**\n\n${t}`);
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
          throttledUpdate(taskState.latestContent);
        },
        onComplete: async (result) => {
          if (settled) return;
          settled = true;
          if (pendingUpdate) {
            clearTimeout(pendingUpdate);
            pendingUpdate = null;
          }
          const note = buildCompletionNote(result, sessionManager, ctx);
          const finalContent = result.accumulated || result.result || '(无输出)';
          try {
            await platformAdapter.sendComplete(finalContent, note, thinkingText || undefined);
          } catch (err) {
            log.error('Failed to send complete:', err);
          }
          cleanup();
          resolve();
        },
        onError: async (error) => {
          if (settled) return;
          settled = true;
          if (pendingUpdate) {
            clearTimeout(pendingUpdate);
            pendingUpdate = null;
          }
          log.error(`Task error for user ${ctx.userId}: ${error}`);
          try {
            await platformAdapter.sendError(error);
          } catch (err) {
            log.error('Failed to send error:', err);
          }
          cleanup();
          resolve();
        },
      },
      {
        skipPermissions: config.claudeSkipPermissions,
        timeoutMs: config.claudeTimeoutMs,
        model: sessionManager.getModel(ctx.userId, ctx.threadId) ?? config.claudeModel,
        chatId: ctx.chatId,
        hookPort: config.hookPort,
      }
    );

    taskState = { handle, latestContent: '', settle, startedAt: Date.now() };
    platformAdapter.onTaskReady(taskState);
  });
}
