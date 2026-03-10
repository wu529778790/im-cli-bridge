import { ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createLogger } from "../logger.js";
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

const log = createLogger("ProcessPool");

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

export interface ClaudeResult {
  success: boolean;
  result: string;
  accumulated: string;
  cost: number;
  durationMs: number;
  model?: string;
  numTurns: number;
  toolStats: Record<string, number>;
}

export interface ClaudeRunOptions {
  skipPermissions?: boolean;
  permissionMode?: 'default' | 'acceptEdits' | 'plan';
  timeoutMs?: number;
  model?: string;
  chatId?: string;
  hookPort?: number;
}

interface SessionEntry {
  lastUsed: number;
}

/**
 * Process pool that manages cached session configurations.
 *
 * Since Claude CLI doesn't support persistent mode, we use this pool to:
 * 1. Cache active sessions for faster resume using --resume
 * 2. Track which sessions are actively being used
 * 3. Clean up stale entries
 *
 * The main benefit is that resumed sessions don't need to reload conversation history.
 */
export class ClaudeProcessPool {
  private entries = new Map<string, SessionEntry>();
  private activeProcesses = new Map<string, ChildProcess>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly ttl: number;

  constructor(ttlMs: number = 2 * 60 * 1000) {
    this.ttl = ttlMs;
    log.info(`Process pool created with TTL: ${ttlMs}ms`);

    // Periodic cleanup of expired entries
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60 * 1000); // Every minute
  }

  /**
   * Execute a prompt, reusing cached session if available.
   */
  async execute(
    userId: string,
    sessionId: string | undefined,
    cliPath: string,
    prompt: string,
    workDir: string,
    callbacks: ClaudeRunCallbacks,
    options?: ClaudeRunOptions,
  ): Promise<ClaudeResult> {
    const key = `${userId}:${sessionId || "default"}`;

    // Update cache entry (tracks active sessions)
    const entry = this.entries.get(key);
    if (entry) {
      entry.lastUsed = Date.now();
    } else {
      this.entries.set(key, { lastUsed: Date.now() });
    }

    // Check if there's an active process for this session
    const activePid = this.activeProcesses.get(key);
    if (activePid && !activePid.killed) {
      log.info(`Session has active process: key=${key}, pid=${activePid.pid}`);
      // Wait a bit for the previous process to complete
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Run the Claude CLI process
    return this.runProcess(key, cliPath, prompt, sessionId, workDir, callbacks, options || {});
  }

  /**
   * Run a Claude CLI process for a single request.
   */
  private runProcess(
    key: string,
    cliPath: string,
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: ClaudeRunCallbacks,
    options: ClaudeRunOptions,
  ): Promise<ClaudeResult> {
    return new Promise((resolve, reject) => {
      const args = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
      ];

      if (options.skipPermissions) {
        args.push("--dangerously-skip-permissions");
      } else if (options.permissionMode) {
        args.push("--permission-mode", options.permissionMode);
      }
      if (options.model) args.push("--model", options.model);
      if (sessionId) args.push("--resume", sessionId);
      args.push("--", prompt);

      // Environment setup
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (k === "CLAUDECODE") continue;
        if (v !== undefined) env[k] = v;
      }
      if (options.chatId) env.CC_IM_CHAT_ID = options.chatId;
      if (options.hookPort) env.CC_IM_HOOK_PORT = String(options.hookPort);

      // Platform-specific spawn
      let child: ChildProcess;
      if (process.platform === "win32") {
        const isGitBash =
          process.env.MSYSTEM ||
          process.env.MINGW_PREFIX ||
          process.env.SHELL?.includes("bash");

        if (isGitBash) {
          child = spawn(cliPath, args, {
            cwd: workDir,
            stdio: ["ignore", "pipe", "pipe"],
            env,
            shell: true,
            windowsHide: true,
          });
        } else {
          child = spawn(cliPath, args, {
            cwd: workDir,
            stdio: ["ignore", "pipe", "pipe"],
            env,
            windowsHide: true,
          });
        }
      } else {
        child = spawn(cliPath, args, {
          cwd: workDir,
          stdio: ["ignore", "pipe", "pipe"],
          env,
        });
      }

      log.info(`Started process: pid=${child.pid}, key=${key}`);

      // Track active process
      this.activeProcesses.set(key, child);

      // State tracking
      let accumulated = "";
      let accumulatedThinking = "";
      let model = "";
      const toolStats: Record<string, number> = {};
      const pendingToolInputs = new Map<number, { name: string; json: string }>();
      const startTime = Date.now();

      const rl = createInterface({ input: child.stdout! });

      rl.on("line", (line) => {
        const event = parseStreamLine(line);
        if (!event) return;

        if (isStreamInit(event)) {
          model = event.model;
          callbacks.onSessionId?.(event.session_id);
          return;
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
          const fullResult: ClaudeResult = {
            ...result,
            accumulated,
            model,
            toolStats,
          };
          if (!accumulated && fullResult.result) {
            accumulated = fullResult.result;
          }

          callbacks.onComplete(fullResult);
          resolve(fullResult);
        }
      });

      let exitCode: number | null = null;
      let rlClosed = false;
      let childClosed = false;

      let resolved = false;

      const finalize = () => {
        if (!rlClosed || !childClosed || resolved) return;
        this.activeProcesses.delete(key);
        resolved = true;

        if (exitCode !== null && exitCode !== 0) {
          const errorMsg = `Claude CLI exited with code ${exitCode}`;
          callbacks.onError(errorMsg);
          reject(new Error(errorMsg));
        }
        // If exitCode is 0 and we haven't resolved yet, the result was already sent
        // via the extractResult handler. This is just cleanup.
      };

      child.on("close", (code) => {
        log.info(`Process closed: code=${code}, pid=${child.pid}, key=${key}`);
        exitCode = code;
        childClosed = true;
        finalize();
      });

      rl.on("close", () => {
        rlClosed = true;
        finalize();
      });

      child.on("error", (err) => {
        log.error(`Process error: ${err.message}, pid=${child.pid}, key=${key}`);
        this.activeProcesses.delete(key);
        const errorMsg = `Failed to start Claude CLI: ${err.message}`;
        callbacks.onError(errorMsg);
        reject(new Error(errorMsg));
      });
    });
  }

  /**
   * Clean up expired entries.
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.entries.entries()) {
      if (now - entry.lastUsed > this.ttl) {
        this.entries.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.info(`Cleaned up ${cleaned} expired entries, ${this.entries.size} remaining`);
    }
  }

  /**
   * Terminate the active process for a session.
   */
  terminate(userId: string, sessionId: string | undefined): void {
    const key = `${userId}:${sessionId || "default"}`;
    const child = this.activeProcesses.get(key);
    if (child && !child.killed) {
      child.kill("SIGTERM");
      this.activeProcesses.delete(key);
    }
    // Also remove from cache
    this.entries.delete(key);
  }

  /**
   * Terminate all active processes and clear cache.
   */
  terminateAll(): void {
    for (const child of this.activeProcesses.values()) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
    this.activeProcesses.clear();
    this.entries.clear();
  }

  /**
   * Get the number of cached entries.
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Get the number of active processes.
   */
  activeCount(): number {
    return this.activeProcesses.size;
  }

  /**
   * Destroy the process pool and cleanup resources.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.terminateAll();
  }
}
