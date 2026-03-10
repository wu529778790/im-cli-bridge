import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  parseStreamLine,
  extractTextDelta,
  extractThinkingDelta,
  extractResult,
} from "./stream-parser.js";
import {
  isStreamInit,
  isContentBlockStart,
  isContentBlockDelta,
  isContentBlockStop,
} from "./types.js";
import { createLogger } from "../logger.js";

const log = createLogger("CliRunner");

export interface ClaudeRunCallbacks {
  onText: (accumulated: string) => void;
  onThinking?: (accumulated: string) => void;
  onToolUse?: (toolName: string, toolInput?: Record<string, unknown>) => void;
  onComplete: (result: {
    success: boolean;
    result: string;
    accumulated: string;
    cost: number;
    durationMs: number;
    model?: string;
    numTurns: number;
    toolStats: Record<string, number>;
  }) => void;
  onError: (error: string) => void;
  onSessionId?: (sessionId: string) => void;
}

export interface ClaudeRunOptions {
  skipPermissions?: boolean;
  permissionMode?: 'default' | 'acceptEdits' | 'plan';
  timeoutMs?: number;
  model?: string;
  chatId?: string;
  hookPort?: number;
}

export interface ClaudeRunHandle {
  abort: () => void;
}

export function runClaude(
  cliPath: string,
  prompt: string,
  sessionId: string | undefined,
  workDir: string,
  callbacks: ClaudeRunCallbacks,
  options?: ClaudeRunOptions,
): ClaudeRunHandle {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];

  if (options?.skipPermissions) {
    args.push("--dangerously-skip-permissions");
  } else if (options?.permissionMode) {
    args.push("--permission-mode", options.permissionMode);
  }
  if (options?.model) args.push("--model", options.model);
  if (sessionId) args.push("--resume", sessionId);
  args.push("--", prompt);

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Skip CLAUDECODE to prevent nested session detection
    if (k === "CLAUDECODE") continue;
    if (v !== undefined) env[k] = v;
  }
  if (options?.chatId) env.CC_IM_CHAT_ID = options.chatId;
  if (options?.hookPort) env.CC_IM_HOOK_PORT = String(options.hookPort);

  // 使用 shell: false 直接 spawn，避免 shell 对参数按空格拆分
  // （用户 prompt 如 "npm 你好" 在 shell: true 下会被拆成 "npm" 和 "你好"，CLI 只收到第一个）
  log.info(`Spawning CLI: path=${cliPath}, platform=${process.platform}`);

  const child = spawn(cliPath, args, {
    cwd: workDir,
    stdio: ["ignore", "pipe", "pipe"],
    env,
    windowsHide: process.platform === "win32",
  });

  log.info(
    `Claude CLI: pid=${child.pid}, cwd=${workDir}, session=${sessionId ?? "new"}`,
  );

  let accumulated = "";
  let accumulatedThinking = "";
  let completed = false;
  let model = "";
  const toolStats: Record<string, number> = {};
  const pendingToolInputs = new Map<number, { name: string; json: string }>();
  const MAX_TIMEOUT = 2_147_483_647;
  const timeoutMs =
    options?.timeoutMs && options.timeoutMs > 0
      ? Math.min(options.timeoutMs, MAX_TIMEOUT)
      : 0;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      if (!completed && !child.killed) {
        completed = true;
        log.warn(
          `Claude CLI timeout after ${timeoutMs}ms, killing pid=${child.pid}`,
        );
        child.kill("SIGTERM");
        callbacks.onError(`执行超时（${timeoutMs}ms），已终止进程`);
      }
    }, timeoutMs);
  }

  // stderr 截断：只保留首 4KB + 尾 6KB，减少 I/O 和内存
  const MAX_STDERR_HEAD = 4 * 1024;
  const MAX_STDERR_TAIL = 6 * 1024;
  let stderrHead = "";
  let stderrTail = "";
  let stderrTotal = 0;
  let stderrHeadFull = false;

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrTotal += text.length;
    if (!stderrHeadFull) {
      const room = MAX_STDERR_HEAD - stderrHead.length;
      if (room > 0) {
        stderrHead += text.slice(0, room);
        if (stderrHead.length >= MAX_STDERR_HEAD) stderrHeadFull = true;
      }
    }
    stderrTail += text;
    if (stderrTail.length > MAX_STDERR_TAIL) {
      stderrTail = stderrTail.slice(-MAX_STDERR_TAIL);
    }
  });

  const rl = createInterface({ input: child.stdout! });

  rl.on("line", (line) => {
    const event = parseStreamLine(line);
    if (!event) return;

    if (isStreamInit(event)) {
      model = event.model;
      callbacks.onSessionId?.(event.session_id);
    }

    const delta = extractTextDelta(event);
    if (delta) {
      accumulated += delta.text;
      callbacks.onText(accumulated);
      return;
    }

    const thinking = extractThinkingDelta(event);
    if (thinking) {
      accumulatedThinking += thinking.text;
      callbacks.onThinking?.(accumulatedThinking);
      return;
    }

    if (
      isContentBlockStart(event) &&
      event.event.content_block?.type === "tool_use"
    ) {
      const name = event.event.content_block.name;
      if (name) pendingToolInputs.set(event.event.index, { name, json: "" });
      return;
    }

    if (
      isContentBlockDelta(event) &&
      event.event.delta?.type === "input_json_delta"
    ) {
      const pending = pendingToolInputs.get(event.event.index);
      if (pending) pending.json += event.event.delta.partial_json ?? "";
      return;
    }

    if (isContentBlockStop(event)) {
      const pending = pendingToolInputs.get(event.event.index);
      if (pending) {
        toolStats[pending.name] = (toolStats[pending.name] || 0) + 1;
        let input: Record<string, unknown> | undefined;
        try {
          input = JSON.parse(pending.json);
        } catch {
          /* empty */
        }
        callbacks.onToolUse?.(pending.name, input);
        pendingToolInputs.delete(event.event.index);
      }
      return;
    }

    const result = extractResult(event);
    if (result) {
      completed = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const fullResult = {
        ...result,
        accumulated,
        model,
        toolStats,
      };
      if (!accumulated && fullResult.result) accumulated = fullResult.result;
      callbacks.onComplete(fullResult);
    }
  });

  let exitCode: number | null = null;
  let rlClosed = false;
  let childClosed = false;

  const finalize = () => {
    if (!rlClosed || !childClosed) return;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!completed) {
      if (exitCode !== null && exitCode !== 0) {
        let errMsg = "";
        if (stderrTotal > 0) {
          if (!stderrHeadFull) {
            errMsg = stderrHead;
          } else if (stderrTotal <= MAX_STDERR_HEAD + MAX_STDERR_TAIL) {
            errMsg = stderrHead + stderrTail.slice(stderrTail.length - (stderrTotal - MAX_STDERR_HEAD));
          } else {
            errMsg =
              stderrHead +
              `\n\n... (省略 ${stderrTotal - MAX_STDERR_HEAD - MAX_STDERR_TAIL} 字节) ...\n\n` +
              stderrTail;
          }
        }
        callbacks.onError(errMsg || `Claude CLI exited with code ${exitCode}`);
      } else {
        callbacks.onComplete({
          success: true,
          result: accumulated,
          accumulated,
          cost: 0,
          durationMs: 0,
          model,
          numTurns: 0,
          toolStats,
        });
      }
    }
  };

  child.on("close", (code) => {
    log.info(`Claude CLI closed: exitCode=${code}, pid=${child.pid}`);
    exitCode = code;
    childClosed = true;
    finalize();
  });

  rl.on("close", () => {
    rlClosed = true;
    finalize();
  });

  child.on("error", (err) => {
    const errorCode = (err as NodeJS.ErrnoException).code;
    log.error(
      `Claude CLI spawn error: ${err.message}, code=${errorCode}, path=${cliPath}`,
    );
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!completed) {
      completed = true;
      callbacks.onError(`Failed to start Claude CLI: ${err.message}`);
    }
    childClosed = true;
    finalize();
  });

  return {
    abort: () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      rl.close();
      if (!child.killed) child.kill("SIGTERM");
    },
  };
}
