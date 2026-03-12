/**
 * 共享 AI 任务执行层，支持多 ToolAdapter。
 */

import type { Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import { getPermissionMode } from '../permission-mode/session-mode.js';
import type { PermissionMode } from '../permission-mode/types.js';
import type { ToolAdapter } from '../adapters/tool-adapter.interface.js';
import type { ParsedResult } from '../adapters/tool-adapter.interface.js';
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

function buildCompletionNote(
  result: ParsedResult,
  sessionManager: SessionManager,
  ctx: TaskContext,
  mode: PermissionMode
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

  if (mode === 'plan') {
    parts.push('当前模式: plan（只读，不执行命令/不改文件，如需真正改代码请发送 `/mode accept-edits` 或 `/mode yolo`）');
  }

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

    const mode = getPermissionMode(ctx.userId, config.defaultPermissionMode);
    process.env.CC_IM_CHAT_ID = ctx.chatId;

    let skipPermissions: boolean | undefined;
    let permissionMode: 'default' | 'acceptEdits' | 'plan' | undefined;

    if (mode === 'plan') {
      skipPermissions = false;
      permissionMode = 'plan';
    } else {
      skipPermissions = mode === 'yolo' || config.claudeSkipPermissions;
      permissionMode = !skipPermissions
        ? (mode === 'ask'
          ? 'default'
          : mode === 'accept-edits'
            ? 'acceptEdits'
            : undefined)
        : undefined;
    }

    const handle = toolAdapter.run(
      prompt,
      ctx.sessionId,
      ctx.workDir,
      {
        onSessionId: (id) => {
          if (ctx.threadId) sessionManager.setSessionIdForThread(ctx.userId, ctx.threadId, config.aiCommand, id);
          else if (ctx.convId) sessionManager.setSessionIdForConv(ctx.userId, ctx.convId, config.aiCommand, id);
        },
        onSessionInvalid: () => {
          if (ctx.convId) sessionManager.clearSessionForConv(ctx.userId, ctx.convId, config.aiCommand);
        },
        onThinking: (t) => {
          if (!firstContentLogged) {
            firstContentLogged = true;
            platformAdapter.onFirstContent?.();
          }
          wasThinking = true;
          thinkingText = t;
          throttledUpdate(`💭 **${getAIToolDisplayName(config.aiCommand)} 思考中...**\n\n${t}`);
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
          const note = buildCompletionNote(result, sessionManager, ctx, mode);
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
          try {
            await platformAdapter.sendComplete(output, note, thinkingText || undefined);
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
          if (config.aiCommand !== 'claude') {
            if (ctx.convId) sessionManager.clearSessionForConv(ctx.userId, ctx.convId, config.aiCommand);
            else sessionManager.clearActiveToolSession(ctx.userId, config.aiCommand);
            log.info(`Session reset for user ${ctx.userId} due to ${config.aiCommand} task error`);
          }
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
        skipPermissions,
        permissionMode,
        timeoutMs: config.claudeTimeoutMs,
        model: sessionManager.getModel(ctx.userId, ctx.threadId) ?? config.claudeModel,
        chatId: ctx.chatId,
        ...(config.useSdkMode ? {} : { hookPort: config.hookPort }),
        ...(config.aiCommand === 'codex' && config.codexProxy ? { proxy: config.codexProxy } : {}),
      }
    );

    taskState = { handle, latestContent: '', settle, startedAt: Date.now(), toolId: config.aiCommand };
    platformAdapter.onTaskReady(taskState);
  });
}
