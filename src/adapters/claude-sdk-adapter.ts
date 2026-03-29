/**
 * Claude SDK Adapter - 使用 Agent SDK V2 Session API 实现真正的多轮对话
 *
 * V2 API 优势：
 * 1. 进程内执行 - 无 fork/exec 开销
 * 2. 持久会话 - SDKSession 对象保持会话状态，支持真正的多轮对话
 * 3. 流式输出 - 支持实时增量更新
 *
 * 认证：ANTHROPIC_API_KEY 或 CLAUDE_CODE_OAUTH_TOKEN
 */

import { unstable_v2_createSession, unstable_v2_resumeSession } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKSession } from '@anthropic-ai/claude-agent-sdk';
import { createLogger } from '../logger.js';
import type { ToolAdapter, RunCallbacks, RunOptions, RunHandle } from './tool-adapter.interface.js';

const log = createLogger('ClaudeSDK');

// 存储所有活跃的 SDKSession 对象，key 为 sessionId
// 使用 Map 而不是 Set，因为我们需要通过 sessionId 获取 session
const activeSessions = new Map<string, SDKSession>();

// 存储正在进行的流式迭代器，用于中断
const activeStreams = new Set<AsyncIterator<SDKMessage>>();

// Mutex to serialize process.chdir() calls across concurrent users
let chdirMutex: Promise<void> = Promise.resolve();
function withChdirMutex<T>(fn: () => T): Promise<T> {
  const previous = chdirMutex;
  let resolve!: () => void;
  chdirMutex = new Promise<void>((r) => { resolve = r; });
  return previous.then(() => {
    try {
      return fn();
    } finally {
      resolve();
    }
  });
}

function isStreamEvent(msg: SDKMessage): boolean {
  return (msg as { type?: string }).type === 'stream_event';
}

function isSystemInit(msg: SDKMessage): boolean {
  const m = msg as { type?: string; subtype?: string };
  return m.type === 'system' && m.subtype === 'init';
}

function isAssistant(msg: SDKMessage): boolean {
  return (msg as { type?: string }).type === 'assistant';
}

function isResult(msg: SDKMessage): boolean {
  return (msg as { type?: string }).type === 'result';
}

/**
 * 获取或创建 SDKSession
 * @param sessionId 已有的 sessionId，如果为 undefined 则创建新会话
 * @param workDir 工作目录
 * @param model 模型名称
 * @param permissionMode 权限模式
 * @returns SDKSession 对象和实际的 sessionId
 */
async function getOrCreateSession(
  sessionId: string | undefined,
  workDir: string,
  model: string | undefined,
  permissionMode: 'default' | 'bypassPermissions' | 'acceptEdits' | 'plan'
): Promise<{ session: SDKSession; sessionId: string }> {
  const resolvedModel = model?.trim() || 'claude-opus-4-5';
  const sessionOptions = {
    model: resolvedModel,
    permissionMode,
  };

  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? '(default)';
  log.info(`[V2] getOrCreateSession model param=${String(model ?? '')} resolved=${resolvedModel} baseUrl=${baseUrl} workDir=${workDir}`);

  // Use mutex to serialize process.chdir() calls across concurrent users
  return withChdirMutex(() => {
    let session: SDKSession;

    const originalCwd = process.cwd();
    try {
      if (workDir && workDir !== originalCwd) {
        process.chdir(workDir);
      }

      if (sessionId) {
        // 尝试恢复已有会话
        try {
          log.info(`Attempting to resume session: ${sessionId}`);
          session = unstable_v2_resumeSession(sessionId, sessionOptions);
          activeSessions.set(sessionId, session);
          log.info(`Successfully resumed session: ${sessionId}`);
          return { session, sessionId };
        } catch (err) {
          log.warn(`Failed to resume session ${sessionId}, creating new one: ${err}`);
          // 恢复失败，创建新会话
        }
      }

      // 创建新会话
      session = unstable_v2_createSession(sessionOptions);
      // 新会话的 sessionId 需要从第一个消息中获取
      // 暂时返回 undefined，稍后在 init 消息中获取
      const tempId = `pending-${Date.now()}`;
      activeSessions.set(tempId, session);
      log.info(`Created new session (tempId: ${tempId})`);
      return { session, sessionId: tempId };
    } finally {
      if (workDir && workDir !== originalCwd) {
        process.chdir(originalCwd);
      }
    }
  });
}

export class ClaudeSDKAdapter implements ToolAdapter {
  readonly toolId = 'claude-sdk';

  /**
   * 清理所有活跃的 SDK 会话和流
   */
  static destroy(): void {
    for (const stream of activeStreams) {
      try {
        if (stream && typeof stream.return === 'function') {
          stream.return();
        }
      } catch {
        /* ignore */
      }
    }
    activeStreams.clear();

    for (const session of activeSessions.values()) {
      try {
        session.close();
      } catch {
        /* ignore */
      }
    }
    activeSessions.clear();
  }

  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions
  ): RunHandle {
    log.info(`[V2] run() entry model=${String(options?.model ?? '')} baseUrl=${process.env.ANTHROPIC_BASE_URL ?? '(default)'}`);

    const abortController = new AbortController();
    let streamClosed = false;
    let actualSessionId: string | undefined;
    let pendingTempId: string | undefined; // 记录临时 ID，用于 abort 时清理
    let runSettled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutMs = options?.timeoutMs ?? 600_000;

    const clearRunTimeout = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const permissionMode = options?.skipPermissions
      ? ('bypassPermissions' as const)
      : options?.permissionMode === 'acceptEdits'
        ? ('acceptEdits' as const)
        : options?.permissionMode === 'plan'
          ? ('plan' as const)
          : ('default' as const);

    const runSession = async () => {
      timeoutId = setTimeout(() => {
        if (runSettled) return;
        runSettled = true;
        clearRunTimeout();
        log.warn(`[ClaudeSDK] Request timeout after ${timeoutMs}ms`);
        abortController.abort();
        callbacks.onError(`请求超时（${Math.round(timeoutMs / 1000)}s），请重试或缩短问题。`);
      }, timeoutMs);

      try {
        // 检查环境变量
        const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
        const hasAuthToken = !!process.env.ANTHROPIC_AUTH_TOKEN;

        if (!hasApiKey && !hasAuthToken) {
          log.warn('Claude SDK: No API credentials found in environment variables');
        }

        log.info(`[V2] Session: ${sessionId ?? 'new'}, prompt="${prompt.slice(0, 50)}..."`);
        log.info(`[V2] model param=${String(options?.model ?? '')} baseUrl=${process.env.ANTHROPIC_BASE_URL ?? '(default)'}`);

        // 获取或创建会话
        const { session, sessionId: returnedId } = await getOrCreateSession(sessionId, workDir, options?.model, permissionMode);
        if (returnedId.startsWith('pending-')) {
          pendingTempId = returnedId;
        }

        // 发送用户消息
        await session.send(prompt);

        // 获取响应流
        const stream = session.stream();
        activeStreams.add(stream);

        let accumulated = '';
        let accumulatedThinking = '';
        const toolStats: Record<string, number> = {};

        try {
          for await (const msg of stream) {
            if (abortController.signal.aborted) {
              log.info('Stream aborted by user');
              break;
            }

            // 获取实际的 sessionId（从 init 消息中）
            if (isSystemInit(msg)) {
              const newSessionId = (msg as { session_id?: string }).session_id;
              if (newSessionId && newSessionId !== actualSessionId) {
                // 更新 sessionId 映射
                if (actualSessionId && actualSessionId.startsWith('pending-')) {
                  activeSessions.delete(actualSessionId);
                }
                activeSessions.set(newSessionId, session);
                actualSessionId = newSessionId;
                log.info(`[V2] Got actual sessionId: ${newSessionId}`);
                callbacks.onSessionId?.(newSessionId);
              }
              continue;
            }

            // 处理流式事件
            if (isStreamEvent(msg)) {
              const ev = (msg as { event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } } }).event;
              if (ev?.type === 'content_block_delta' && ev.delta) {
                if (ev.delta.type === 'text_delta' && ev.delta.text) {
                  accumulated += ev.delta.text;
                  callbacks.onText(accumulated);
                } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
                  accumulatedThinking += ev.delta.thinking;
                  callbacks.onThinking?.(accumulatedThinking);
                }
              }
              continue;
            }

            // 处理助手消息（工具调用）
            if (isAssistant(msg)) {
              const content = (msg as { message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> } }).message?.content;
              for (const block of content ?? []) {
                if (block?.type === 'tool_use' && block.name) {
                  toolStats[block.name] = (toolStats[block.name] || 0) + 1;
                  callbacks.onToolUse?.(block.name, block.input as Record<string, unknown>);
                }
              }
              continue;
            }

            // 处理结果消息
            if (isResult(msg)) {
              streamClosed = true;
              const m = msg as { subtype?: string; result?: string; total_cost_usd?: number; duration_ms?: number; num_turns?: number; errors?: string[] };
              const success = m.subtype === 'success';
              const errs = m.errors ?? [];

              log.info(`[V2] Result: subtype=${m.subtype}, num_turns=${m.num_turns}, sessionId=${actualSessionId ?? 'unknown'}`);

              // 检查会话错误
              if (!success) {
                runSettled = true;
                clearRunTimeout();
                const noConvErr = errs.find((e) => e.includes('No conversation found') || e.includes('session not found'));
                if (noConvErr) {
                  log.warn(`Session ${actualSessionId} not found, may need to create new one`);
                  callbacks.onSessionInvalid?.();
                }
                const errMsg = errs[0] || '未知错误';
                callbacks.onError(errMsg);
                return;
              }

              const resultText = m.result ?? '';
              const result: Parameters<RunCallbacks['onComplete']>[0] = {
                success,
                result: resultText,
                accumulated: success ? accumulated : '',
                cost: m.total_cost_usd ?? 0,
                durationMs: m.duration_ms ?? 0,
                numTurns: m.num_turns ?? 0,
                toolStats,
              };

              if (!result.accumulated && result.result) {
                result.accumulated = result.result;
              }
              if (!result.accumulated && !result.result && accumulated) {
                result.accumulated = accumulated;
                result.result = accumulated;
              }

              runSettled = true;
              clearRunTimeout();
              callbacks.onComplete(result);
              return;
            }
          }

          // 如果流正常结束但没有收到 result 消息
          if (!streamClosed) {
            if (accumulated) {
              log.info('Stream ended without result message, using accumulated text');
              runSettled = true;
              clearRunTimeout();
              callbacks.onComplete({
                success: true,
                result: accumulated,
                accumulated,
                cost: 0,
                durationMs: 0,
                numTurns: 1,
                toolStats,
              });
            } else {
              // 流结束但无 result 也无 accumulated：必须触发回调，否则 Promise 永远挂起
              log.warn('Stream ended with no result and no accumulated text, calling onError to prevent stuck state');
              runSettled = true;
              clearRunTimeout();
              callbacks.onError('AI 响应异常结束（无输出），请重试');
            }
          }
        } finally {
          // 从活跃列表中移除流
          activeStreams.delete(stream);
        }
      } catch (err) {
        if (abortController.signal.aborted) {
          log.info('Session run aborted');
          clearRunTimeout();
          // 清理 pending tempId（abort 可能在 init 消息之前发生）
          const idToClean = actualSessionId ?? pendingTempId;
          if (idToClean?.startsWith('pending-')) {
            activeSessions.delete(idToClean);
            log.info(`Cleaned up pending session: ${idToClean}`);
          }
          return;
        }

        runSettled = true;
        clearRunTimeout();
        const errorObj = err as Error;
        const msg = errorObj.message || String(err);

        log.error(`Claude SDK V2 error: ${msg}`);
        if (errorObj.stack) {
          log.error(`Error stack: ${errorObj.stack}`);
        }

        // 清理 pending tempId（session 在获取真实 ID 前就失败了）
        const errIdToClean = actualSessionId ?? pendingTempId;
        if (errIdToClean?.startsWith('pending-')) {
          activeSessions.delete(errIdToClean);
          log.info(`Cleaned up pending session after error: ${errIdToClean}`);
        }

        callbacks.onError(msg);
      }
    };

    // 启动会话（不等待）
    runSession();

    return {
      abort: () => {
        log.info('Aborting session run');
        abortController.abort();
      },
    };
  }
}
