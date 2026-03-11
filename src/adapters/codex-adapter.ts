/**
 * Codex Adapter - run tasks through OpenAI Codex CLI (`codex exec`)
 */

import { runCodex } from "../codex/cli-runner.js";
import type {
  ParsedResult,
  RunCallbacks,
  RunHandle,
  RunOptions,
  ToolAdapter,
} from "./tool-adapter.interface.js";

export class CodexAdapter implements ToolAdapter {
  readonly toolId = "codex";

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

    return runCodex(
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
          const msg = typeof err === "string" ? err : String(err);
          const friendly =
            msg.includes("Authentication") || msg.includes("login")
              ? "Codex 需要先登录。请在终端运行 codex login，或在 ~/.open-im/config.json 的 env 中添加 OPENAI_API_KEY。"
              : msg.includes("stream disconnected") ||
                  msg.includes("error sending request") ||
                  msg.includes("Connection refused") ||
                  msg.includes("ENOTFOUND") ||
                  msg.includes("ETIMEDOUT")
                ? "Codex 网络请求失败。如无法访问 chatgpt.com，请在 tools.codex.proxy 或 CODEX_PROXY 中配置代理。"
                : msg.includes("No session found") ||
                    msg.includes("No conversation found") ||
                    msg.includes("Unable to find session")
                  ? "Codex 会话已失效，旧 session 已清理。请直接重试当前请求。"
                  : msg;
          callbacks.onError(friendly);
        },
        onSessionId: callbacks.onSessionId,
        onSessionInvalid: callbacks.onSessionInvalid,
      },
      opts
    );
  }
}
