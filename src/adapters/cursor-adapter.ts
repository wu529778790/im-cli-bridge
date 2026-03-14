/**
 * Cursor Adapter - 通过 Cursor CLI 执行任务
 * 需要预先安装: curl https://cursor.com/install -fsSL | bash
 */

import { runCursor } from '../cursor/cli-runner.js';
import type { ToolAdapter, RunCallbacks, RunOptions, RunHandle } from './tool-adapter.interface.js';
import type { ParsedResult } from './tool-adapter.interface.js';
import { createLogger } from '../logger.js';

const log = createLogger('CursorAdapter');

export class CursorAdapter implements ToolAdapter {
  readonly toolId = 'cursor';

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

    return runCursor(this.cliPath, prompt, sessionId, workDir, {
      onText: callbacks.onText,
      onThinking: callbacks.onThinking,
      onToolUse: callbacks.onToolUse,
      onSessionInvalid: callbacks.onSessionInvalid,
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
          msg.includes('Electron') || msg.includes('Chromium') || msg.includes('not in the list of known options')
            ? '当前使用的是 Cursor IDE 的 cursor.cmd，不支持 CLI 模式。请安装独立的 Cursor Agent CLI：在 PowerShell 运行 irm \'https://cursor.com/install?win32=true\' | iex，安装后把 tools.cursor.cliPath 改为 agent。'
            : msg.includes('Authentication required') || msg.includes('agent login') || msg.includes('cursor agent login')
              ? 'Cursor 需要先登录。请在终端运行 agent login，或在 ~/.open-im/config.json 的 env 中添加 "CURSOR_API_KEY"。'
              : msg.includes('No session found') || msg.includes('No conversation found') || msg.includes('Unable to find session') || msg.includes('session not found') || msg.includes('invalid session')
                ? 'Cursor 会话已失效，旧 session 已清理。请直接重试当前请求。'
                : msg.includes('stream disconnected') || msg.includes('error sending request') || msg.includes('Connection refused') || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT')
                  ? 'Cursor 网络请求失败。如无法访问 Cursor API，可在 tools.cursor.proxy 或 CURSOR_PROXY 中配置代理。'
                  : msg.includes('usage limit') || msg.includes('You\'ve hit your usage limit')
                    ? 'Cursor 模型用量已超限（如 Opus）。请在 config.json 的 tools.cursor.model 中改为 claude-4-sonnet 或其他非 Opus 模型，或运行 agent --list-models 查看可用模型。'
                    : msg;
        callbacks.onError(friendly);
      },
      onSessionId: callbacks.onSessionId,
    }, opts);
  }
}
