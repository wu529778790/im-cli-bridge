import { runCodeBuddy } from '../codebuddy/cli-runner.js';
import type {
  ParsedResult,
  RunCallbacks,
  RunHandle,
  RunOptions,
  ToolAdapter,
} from './tool-adapter.interface.js';

export class CodeBuddyAdapter implements ToolAdapter {
  readonly toolId = 'codebuddy';

  constructor(private cliPath: string) {}

  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions,
  ): RunHandle {
    return runCodeBuddy(
      this.cliPath,
      prompt,
      sessionId,
      workDir,
      {
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
            msg.includes('Authentication') || msg.includes('/login') || msg.includes('CODEBUDDY_API_KEY')
              ? 'CodeBuddy 需要先登录。请在终端运行 codebuddy login，或在 ~/.open-im/config.json 的 env 中添加 CODEBUDDY_API_KEY / CODEBUDDY_AUTH_TOKEN。'
              : msg.includes('No conversation found') ||
                  msg.includes('Session not found') ||
                  msg.includes('Invalid session') ||
                  msg.includes('Unable to resume')
                ? 'CodeBuddy 会话已失效，旧 session 已清理。请直接重试当前请求。'
                : msg;
          callbacks.onError(friendly);
        },
        onSessionId: callbacks.onSessionId,
        onSessionInvalid: callbacks.onSessionInvalid,
      },
      {
        skipPermissions: options?.skipPermissions,
        permissionMode: options?.permissionMode,
        timeoutMs: options?.timeoutMs,
        model: options?.model,
      },
    );
  }
}
