/**
 * Claude SDK Adapter - 使用 Agent SDK 实现持久会话，无需每次 spawn 进程
 *
 * 优势：
 * 1. 进程内执行 - 无 fork/exec 开销，响应更快
 * 2. 会话复用 - resume 保留上下文，无需重新加载历史
 * 3. 流式输出 - includePartialMessages 支持 text_delta、thinking_delta
 *
 * 认证：ANTHROPIC_API_KEY 或 CLAUDE_CODE_OAUTH_TOKEN（claude setup-token）
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createLogger } from '../logger.js';
import type { ToolAdapter, RunCallbacks, RunOptions, RunHandle } from './tool-adapter.interface.js';

const log = createLogger('ClaudeSDK');

// 存储所有活跃的查询，用于清理
const activeQueries = new Set<AsyncIterator<SDKMessage>>();

function isStreamEvent(msg: SDKMessage): boolean {
  return (msg as { type?: string }).type === 'stream_event';
}

function isSystemInit(msg: SDKMessage): boolean {
  const m = msg as { type?: string; subtype?: string; session_id?: string; model?: string };
  return m.type === 'system' && m.subtype === 'init';
}

function isResult(msg: SDKMessage): boolean {
  return (msg as { type?: string }).type === 'result';
}

function isAssistant(msg: SDKMessage): boolean {
  return (msg as { type?: string }).type === 'assistant';
}

export class ClaudeSDKAdapter implements ToolAdapter {
  readonly toolId = 'claude-sdk';

  /**
   * 清理所有活跃的 SDK 查询
   */
  static destroy(): void {
    for (const q of activeQueries) {
      try {
        if (q && typeof q.return === 'function') {
          q.return();
        }
      } catch {
        /* ignore */
      }
    }
    activeQueries.clear();
  }

  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions
  ): RunHandle {
    const abortController = new AbortController();
    let queryClosed = false;

    const permissionMode = options?.skipPermissions
      ? ('bypassPermissions' as const)
      : options?.permissionMode === 'acceptEdits'
        ? ('acceptEdits' as const)
        : options?.permissionMode === 'plan'
          ? ('plan' as const)
          : ('default' as const);

    const runQuery = async () => {
      try {
        // 调试：检查关键环境变量
        const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
        const hasAuthToken = !!process.env.ANTHROPIC_AUTH_TOKEN;
        const hasBaseUrl = !!process.env.ANTHROPIC_BASE_URL;

        if (!hasApiKey && !hasAuthToken && !hasBaseUrl) {
          log.warn('Claude SDK: No API credentials found in environment variables');
        }

        const opts = {
          cwd: workDir,
          resume: sessionId,
          includePartialMessages: true,
          permissionMode,
          model: options?.model,
          abortController,
          allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
        };

        const q = query({
          prompt,
          options: opts,
        });

        // 将查询添加到活跃列表
        activeQueries.add(q as unknown as AsyncIterator<SDKMessage>);

        let accumulated = '';
        let accumulatedThinking = '';
        const toolStats: Record<string, number> = {};

        try {
          for await (const msg of q) {
            if (abortController.signal.aborted) break;

            if (isSystemInit(msg)) {
            callbacks.onSessionId?.((msg as { session_id: string }).session_id);
            continue;
          }

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

          if (isResult(msg)) {
            queryClosed = true;
            const m = msg as { subtype?: string; result?: string; total_cost_usd?: number; duration_ms?: number; num_turns?: number; errors?: string[] };
            const success = m.subtype === 'success';
            const errs = m.errors ?? [];
            const noConvErr = errs.find((e) => e.includes('No conversation found with session ID'));
            if (!success && noConvErr) {
              log.warn(`SDK session invalid: ${noConvErr}`);
              callbacks.onSessionInvalid?.();
              callbacks.onError('会话已过期，请发送 /new 开始新会话');
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
            if (!result.accumulated && result.result) result.accumulated = result.result;
            if (!result.accumulated && !result.result && accumulated) {
              log.debug(`Result event had no text but accumulated=${accumulated.length} chars, using accumulated`);
              result.accumulated = accumulated;
              result.result = accumulated;
            }
            if (!result.accumulated && !result.result) {
              const errMsg = errs[0] ?? '未知错误';
              log.warn(`SDK result empty: subtype=${m.subtype}, errors=${JSON.stringify(errs)}`);
              callbacks.onError(errMsg);
              return;
            }
            callbacks.onComplete(result);
            return;
          }
        }

        if (!queryClosed) {
          callbacks.onComplete({
            success: true,
            result: accumulated,
            accumulated,
            cost: 0,
            durationMs: 0,
            numTurns: 0,
            toolStats,
          });
        }
        } finally {
          q.close();
          // 从活跃列表中移除
          activeQueries.delete(q as unknown as AsyncIterator<SDKMessage>);
        }
      } catch (err) {
        if (abortController.signal.aborted) return;
        const errorObj = err as Error;
        const msg = errorObj.message || String(err);
        const stack = errorObj.stack || '';

        // 输出详细的错误信息用于调试
        log.error(`Claude SDK error: ${msg}`);
        if (stack) {
          log.error(`Error stack: ${stack}`);
        }

        callbacks.onError(msg);
      }
    };

    runQuery();

    return {
      abort: () => {
        abortController.abort();
      },
    };
  }
}
