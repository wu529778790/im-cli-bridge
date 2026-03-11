/**
 * Codex Adapter - 通过 OpenAI Codex CLI (codex exec) 执行任务
 * 需要预先安装: npm install -g @openai/codex
 */

import { runCodex } from '../codex/cli-runner.js';
import type { ToolAdapter, RunCallbacks, RunOptions, RunHandle } from './tool-adapter.interface.js';
import type { ParsedResult } from './tool-adapter.interface.js';

export class CodexAdapter implements ToolAdapter {
  readonly toolId = 'codex';

  constructor(private cliPath: string) {}

  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions
  ): RunHandle {
    const opts = {
      skipPermissions: options?.skipPermissions,
      permissionMode: options?.permissionMode,
      timeoutMs: options?.timeoutMs,
      model: options?.model,
      chatId: options?.chatId,
      hookPort: options?.hookPort,
      proxy: options?.proxy,
    };

    return runCodex(this.cliPath, prompt, sessionId, workDir, {
      onText: callbacks.onText,
      onThinking: callbacks.onThinking,
      onToolUse: callbacks.onToolUse,
      onComplete: (raw) => {
        const result: ParsedResult = {
          success: raw.success,
          result: raw.result,
          accumulated: raw.accumulated,
          cost: raw.cost,
          durationMs: raw.durationMs,
          model: raw.model,
          numTurns: raw.numTurns,
          toolStats: raw.toolStats,
        };
        callbacks.onComplete(result);
      },
      onError: (err) => {
        const msg = typeof err === 'string' ? err : String(err);
        const friendly =
          msg.includes('Authentication') || msg.includes('login')
            ? 'Codex 需要先登录。请在终端运行 codex login，或在 ~/.open-im/config.json 的 env 中添加 OPENAI_API_KEY。'
            : msg;
        callbacks.onError(friendly);
      },
      onSessionId: callbacks.onSessionId,
    }, opts);
  }
}
