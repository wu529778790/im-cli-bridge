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
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createLogger } from '../logger.js';
import type { ToolAdapter, RunCallbacks, RunOptions, RunHandle } from './tool-adapter.interface.js';

const log = createLogger('ClaudeSDK');

// ── 从 ~/.claude/settings.json 读取用户插件配置 ──

interface UserPluginSettings {
  enabledPlugins?: Record<string, boolean>;
  extraKnownMarketplaces?: Record<string, unknown>;
}

function loadUserPluginSettings(): UserPluginSettings | null {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    if (!existsSync(settingsPath)) return null;
    const content = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    const result: UserPluginSettings = {};
    if (settings.enabledPlugins) result.enabledPlugins = settings.enabledPlugins;
    if (settings.extraKnownMarketplaces) result.extraKnownMarketplaces = settings.extraKnownMarketplaces;
    if (Object.keys(result).length === 0) return null;
    log.info(`Loaded user plugin settings: plugins=[${Object.keys(result.enabledPlugins ?? {}).join(', ')}]`);
    return result;
  } catch (err) {
    log.warn('Failed to read ~/.claude/settings.json for plugin config:', err);
    return null;
  }
}

const _userPluginSettings = loadUserPluginSettings();

// 存储所有活跃的 SDKSession 对象，key 为 sessionId
// 使用 Map 而不是 Set，因为我们需要通过 sessionId 获取 session
const activeSessions = new Map<string, SDKSession>();

// 存储正在进行的流式迭代器，用于中断
const activeStreams = new Set<AsyncIterator<SDKMessage>>();

// 空闲会话清理：跟踪最后使用时间，定期清除超时会话
const sessionLastUsed = new Map<string, number>();
// 跟踪正在执行任务的 session ID，防止空闲清理误杀运行中的长任务
const runningSessions = new Set<string>();
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000; // 30 分钟未使用则清理
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;  // 每 5 分钟检查一次
const MAX_ACTIVE_SESSIONS = 100;

let sessionSeq = 0;

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, lastUsed] of sessionLastUsed) {
    if (runningSessions.has(id)) continue; // 跳过正在运行任务的 session
    if (now - lastUsed > SESSION_IDLE_TTL_MS) {
      const session = activeSessions.get(id);
      if (session) {
        try { session.close(); } catch { /* ignore */ }
        activeSessions.delete(id);
      }
      sessionLastUsed.delete(id);
      log.info(`Cleaned up idle session (unused ${Math.round((now - lastUsed) / 60000)}min): ${id}`);
    }
  }
}, CLEANUP_INTERVAL_MS);
cleanupInterval.unref(); // 不阻止进程退出

/**
 * Serializes process.chdir() calls across concurrent users.
 *
 * process.chdir() is a process-wide global side effect — only one chdir can
 * be active at a time. The SDK's createSession/resumeSession do not accept a
 * `cwd` parameter, so we must chdir before calling them. This mutex ensures
 * concurrent requests don't race on the working directory.
 *
 * **Limitation:** If the SDK ever supports a `cwd` option, this mutex should
 * be removed entirely.
 */
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

function isSessionCorruptionError(msg: string): boolean {
  return /session\s*(not found|expired|corrupt)|no\s*conversation\s*found/i.test(msg);
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

  if (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
    throw new Error(`Session pool is full (${MAX_ACTIVE_SESSIONS}). Cannot create new session.`);
  }
  const sessionOptions = {
    model: resolvedModel,
    permissionMode,
  };

  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? '(default)';
  log.info(`[V2] getOrCreateSession model param=${String(model ?? '')} resolved=${resolvedModel} baseUrl=${baseUrl} workDir=${workDir}`);

  // NOTE: process.chdir() 是进程级全局副作用，在并发服务器中不理想。
  // 但 SDK 的 createSession/resumeSession 不接受 cwd 参数，且这些调用是同步的，
  // 所以 mutex + try/finally 已是最优方案。如果 SDK 未来支持 cwd 选项，应移除 chdir。
  return withChdirMutex(() => {
    let session: SDKSession;

    const originalCwd = process.cwd();
    try {
      if (workDir && workDir !== originalCwd) {
        process.chdir(workDir);
      }

      if (sessionId) {
        // 优先复用内存中已有的 SDKSession，避免每次都启动新进程
        const existing = activeSessions.get(sessionId);
        if (existing) {
          log.info(`Reusing existing in-memory session: ${sessionId}`);
          sessionLastUsed.set(sessionId, Date.now());
          return { session: existing, sessionId };
        }

        // 内存中没有，尝试通过 resume 恢复（会启动新 CLI 进程）
        try {
          log.info(`Attempting to resume session: ${sessionId}`);
          session = unstable_v2_resumeSession(sessionId, sessionOptions);
          activeSessions.set(sessionId, session);
          sessionLastUsed.set(sessionId, Date.now());
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
      const tempId = `pending-${++sessionSeq}`;
      activeSessions.set(tempId, session);
      sessionLastUsed.set(tempId, Date.now());
      log.info(`Created new session (tempId: ${tempId})`);
      return { session, sessionId: tempId, wasReused: false };
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
    clearInterval(cleanupInterval);

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
    sessionLastUsed.clear();
  }

  /**
   * Remove a specific session from the in-memory cache and close it.
   * Useful when the caller knows a session is corrupted.
   */
  static removeSession(sessionId: string): void {
    const session = activeSessions.get(sessionId);
    if (session) {
      try { session.close(); } catch { /* ignore */ }
      activeSessions.delete(sessionId);
      sessionLastUsed.delete(sessionId);
      log.info(`Explicitly removed session: ${sessionId}`);
    }
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
    let currentStream: AsyncIterator<SDKMessage> | undefined; // 用于 abort 时立即中断 stream

    const permissionMode = options?.skipPermissions
      ? ('bypassPermissions' as const)
      : options?.permissionMode === 'acceptEdits'
        ? ('acceptEdits' as const)
        : options?.permissionMode === 'plan'
          ? ('plan' as const)
          : ('default' as const);

    const runSession = async () => {
      let trackedRunningId: string | undefined; // 用于 finally 中清理 runningSessions
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
        runningSessions.add(returnedId);
        trackedRunningId = returnedId;

        // 发送用户消息
        await session.send(prompt);

        // 获取响应流
        const stream = session.stream();
        currentStream = stream;
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
              const initMsg = msg as {
                session_id?: string;
                skills?: string[];
                plugins?: Array<{ name: string; path: string }>;
                tools?: string[];
              };
              // 记录 session 加载的插件和技能
              const pluginNames = initMsg.plugins?.map(p => p.name).join(', ') ?? 'none';
              const skillCount = initMsg.skills?.length ?? 0;
              const toolCount = initMsg.tools?.length ?? 0;
              log.info(`[V2] Init: plugins=[${pluginNames}], skills=${skillCount}, tools=${toolCount}`);

              const newSessionId = initMsg.session_id;
              if (newSessionId && newSessionId !== actualSessionId) {
                // 更新 sessionId 映射
                // 清理 pending 临时 ID（actualSessionId 尚未赋值时用 pendingTempId）
                const idToClean = actualSessionId ?? pendingTempId;
                if (idToClean?.startsWith('pending-')) {
                  activeSessions.delete(idToClean);
                }
                activeSessions.set(newSessionId, session);
                sessionLastUsed.set(newSessionId, Date.now());
                if (idToClean) sessionLastUsed.delete(idToClean);
                // 更新 runningSessions：移除旧 ID，添加新 ID
                if (idToClean) runningSessions.delete(idToClean);
                runningSessions.add(newSessionId);
                trackedRunningId = newSessionId;
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

                const noConvErr = errs.find((e) => e.includes('No conversation found') || e.includes('session not found'));
                if (noConvErr) {
                  log.warn(`Session ${actualSessionId} not found, removing from active sessions`);
                  if (actualSessionId) {
                    activeSessions.delete(actualSessionId);
                    sessionLastUsed.delete(actualSessionId);
                    try { session.close(); } catch { /* ignore */ }
                  }
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
              callbacks.onComplete(result);
              return;
            }
          }

          // 如果流正常结束但没有收到 result 消息
          if (!streamClosed) {
            if (accumulated) {
              log.info('Stream ended without result message, using accumulated text');
              runSettled = true;
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
          // 清理 pending tempId（abort 可能在 init 消息之前发生）
          const idToClean = actualSessionId ?? pendingTempId;
          if (idToClean?.startsWith('pending-')) {
            activeSessions.delete(idToClean);
            log.info(`Cleaned up pending session: ${idToClean}`);
          }
          return;
        }

        runSettled = true;
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

        // If error suggests a corrupted session, remove it from cache to prevent reuse
        if (actualSessionId && isSessionCorruptionError(msg)) {
          const corrupted = activeSessions.get(actualSessionId);
          activeSessions.delete(actualSessionId);
          sessionLastUsed.delete(actualSessionId);
          if (corrupted) {
            try { corrupted.close(); } catch { /* ignore */ }
          }
          log.warn(`Removed corrupted session ${actualSessionId} after error: ${msg}`);
          callbacks.onSessionInvalid?.();
        }

        callbacks.onError(msg);
      } finally {
        // 无论成功、失败还是 abort，都从运行中集合移除
        if (trackedRunningId) {
          runningSessions.delete(trackedRunningId);
        }
        // 也清理 actualSessionId（可能在 init 后更新了）
        if (actualSessionId && actualSessionId !== trackedRunningId) {
          runningSessions.delete(actualSessionId);
        }
      }
    };

    // 启动会话（不等待），catch 兜底防止 unhandledRejection 导致用户请求挂起
    runSession().catch((err) => {
      if (!runSettled) {
        runSettled = true;
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`Unhandled runSession error: ${msg}`);
        callbacks.onError(msg);
      }
    });

    return {
      abort: () => {
        log.info('Aborting session run');
        abortController.abort();
        // 立即中断 stream，不等下一条消息
        if (currentStream) {
          try { currentStream.return?.(); } catch { /* ignore */ }
        }
      },
    };
  }
}
