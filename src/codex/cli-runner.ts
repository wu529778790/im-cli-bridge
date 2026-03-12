/**
 * Codex CLI Runner - 解析 codex exec --json 的 JSONL 输出
 * 参考: https://developers.openai.com/codex/cli/reference/
 *       https://takopi.dev/reference/runners/codex/exec-json-cheatsheet/
 */

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createLogger } from '../logger.js';

const log = createLogger('CodexCli');
const windowsCodexLaunchCache = new Map<string, { command: string; args: string[] } | null>();

export interface CodexRunCallbacks {
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
  onSessionInvalid?: () => void;
}

export interface CodexRunOptions {
  skipPermissions?: boolean;
  permissionMode?: 'default' | 'acceptEdits' | 'plan';
  timeoutMs?: number;
  model?: string;
  chatId?: string;
  hookPort?: number;
  /** HTTP/HTTPS 代理，用于访问 chatgpt.com */
  proxy?: string;
}

export interface CodexRunHandle {
  abort: () => void;
}

function parseCodexEvent(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildCodexArgs(
  _prompt: string,
  sessionId: string | undefined,
  workDir: string,
  options?: CodexRunOptions
): string[] {
  const commonOptions = ["--json", "--skip-git-repo-check"];
  const newSessionOptions = [...commonOptions, "--cd", workDir];
  const resumeOptions = [...commonOptions];
  const canResume = Boolean(sessionId) && options?.permissionMode !== "plan";

  if (options?.skipPermissions) {
    newSessionOptions.push("--dangerously-bypass-approvals-and-sandbox");
    resumeOptions.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (options?.permissionMode === "plan") {
    // `codex exec resume` 当前不支持 `--sandbox` / `--cd`，plan 模式统一新开只读会话。
    newSessionOptions.push("--sandbox", "read-only");
  } else {
    newSessionOptions.push("--full-auto");
    resumeOptions.push("--full-auto");
  }

  if (options?.model) {
    newSessionOptions.push("--model", options.model);
    resumeOptions.push("--model", options.model);
  }

  if (sessionId && !canResume) {
    log.warn("Codex plan mode does not support resume; starting a new read-only session");
  }

  return canResume
    ? ["exec", "resume", ...resumeOptions, sessionId!, "-"]
    : ["exec", ...newSessionOptions, "-"];
}

function quoteForWindowsCmd(arg: string): string {
  // 普通 flag / sessionId / 无空格路径不需要加引号，否则引号可能被原样传给子进程。
  if (/^[A-Za-z0-9_./:=+\\-]+$/.test(arg)) {
    return arg;
  }
  const escaped = arg
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/g, '$1$1')
    .replace(/%/g, '%%');
  return `"${escaped}"`;
}

function formatWindowsCommandName(command: string): string {
  // 裸命令名（如 codex）依赖 PATH 查找，不能再包双引号，否则 cmd 会按字面量查找。
  if (/^[A-Za-z0-9_.-]+$/.test(command)) {
    return command;
  }
  return quoteForWindowsCmd(command);
}

function extractCodexJsFromCmdShim(cmdPath: string): string | null {
  try {
    const content = readFileSync(cmdPath, 'utf-8');
    const match = content.match(/"%~dp0\\([^"\r\n]*codex\\bin\\codex\.js)"/i);
    if (!match) return null;
    const relativeJsPath = match[1].replace(/\\/g, '/');
    return join(dirname(cmdPath), relativeJsPath);
  } catch {
    return null;
  }
}

function resolveWindowsCodexLaunch(
  cliPath: string,
  args: string[],
): { command: string; args: string[] } | null {
  if (windowsCodexLaunchCache.has(cliPath)) {
    const cached = windowsCodexLaunchCache.get(cliPath);
    return cached ? { command: cached.command, args: [...cached.args, ...args] } : null;
  }

  try {
    const whereOutput = execFileSync('where', [cliPath], {
      stdio: 'pipe',
      windowsHide: true,
    })
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const cmdShimPath =
      whereOutput.find((line) => /\.cmd$/i.test(line)) ?? null;

    if (!cmdShimPath) {
      windowsCodexLaunchCache.set(cliPath, null);
      return null;
    }

    const codexJsPath = extractCodexJsFromCmdShim(cmdShimPath);
    if (!codexJsPath) {
      windowsCodexLaunchCache.set(cliPath, null);
      return null;
    }

    const resolved = {
      command: process.execPath,
      args: [codexJsPath],
    };
    windowsCodexLaunchCache.set(cliPath, resolved);
    return { command: resolved.command, args: [...resolved.args, ...args] };
  } catch {
    windowsCodexLaunchCache.set(cliPath, null);
    return null;
  }
}

export function runCodex(
  cliPath: string,
  prompt: string,
  sessionId: string | undefined,
  workDir: string,
  callbacks: CodexRunCallbacks,
  options?: CodexRunOptions
): CodexRunHandle {
  // codex exec --json 非交互模式
  const args = buildCodexArgs(prompt, sessionId, workDir, options);

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  if (options?.chatId) env.CC_IM_CHAT_ID = options.chatId;
  if (options?.hookPort) env.CC_IM_HOOK_PORT = String(options.hookPort);
  if (options?.proxy) {
    env.HTTPS_PROXY = options.proxy;
    env.HTTP_PROXY = options.proxy;
    env.https_proxy = options.proxy;
    env.http_proxy = options.proxy;
    env.ALL_PROXY = options.proxy;
    env.all_proxy = options.proxy;
  }
  if (process.platform === 'win32') {
    // 强制子进程在 Windows 下使用 UTF-8，避免中文源码/命令输出乱码。
    env.LANG = env.LANG || 'C.UTF-8';
    env.LC_ALL = env.LC_ALL || 'C.UTF-8';
  }

  const argsForLog = args.join(' ');
  log.info(`Spawning Codex CLI: path=${cliPath}, cwd=${workDir}, session=${sessionId ?? 'new'}, args=${argsForLog}`);

  // Windows: .cmd/.bat 或简单命令名（如 codex）需通过 cmd.exe 执行，否则 spawn 报 ENOENT
  const isWinCmd =
    process.platform === 'win32' &&
    (/\.(cmd|bat)$/i.test(cliPath) || cliPath === 'codex');
  const directWindowsLaunch = isWinCmd
    ? resolveWindowsCodexLaunch(cliPath, args)
    : null;
  const spawnCmd = directWindowsLaunch
    ? directWindowsLaunch.command
    : isWinCmd
      ? 'cmd.exe'
      : cliPath;
  const spawnArgs = directWindowsLaunch
    ? directWindowsLaunch.args
    : isWinCmd
      ? [
          '/d',
          '/s',
          '/c',
          `chcp 65001>nul && ${formatWindowsCommandName(cliPath)} ${args.map(quoteForWindowsCmd).join(' ')}`,
        ]
      : args;

  const child = spawn(spawnCmd, spawnArgs, {
    cwd: workDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    windowsHide: process.platform === 'win32',
  });

  // 通过 stdin 传 prompt，避免 Windows 下命令行参数引用导致中文/路径/空格被拆分。
  child.stdin?.write(prompt);
  child.stdin?.end();

  let accumulated = '';
  let accumulatedThinking = '';
  let completed = false;
  let threadId = '';
  const toolStats: Record<string, number> = {};
  const startTime = Date.now();
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
        log.warn(`Codex CLI timeout after ${timeoutMs}ms, killing pid=${child.pid}`);
        child.kill('SIGTERM');
        callbacks.onError(`执行超时（${timeoutMs}ms），已终止进程`);
      }
    }, timeoutMs);
  }

  const MAX_STDERR_HEAD = 4 * 1024;
  const MAX_STDERR_TAIL = 6 * 1024;
  let stderrHead = '';
  let stderrTail = '';
  let stderrTotal = 0;
  let stderrHeadFull = false;

  child.stderr?.on('data', (chunk: Buffer) => {
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
    log.debug(`[stderr] ${text.trimEnd()}`);
  });

  const rl = createInterface({ input: child.stdout! });

  rl.on('line', (line) => {
    const event = parseCodexEvent(line);
    if (!event) return;

    const type = event.type as string;
    log.debug(`[Codex event] type=${type}`);

    if (type === 'thread.started') {
      threadId = (event.thread_id as string) ?? '';
      if (threadId) callbacks.onSessionId?.(threadId);
      return;
    }

    if (type === 'turn.failed') {
      completed = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const err = event.error as { message?: string } | undefined;
      callbacks.onError(err?.message ?? 'Codex turn failed');
      return;
    }

    if (type === 'error') {
      const msg = event.message as string | undefined;
      if (msg?.includes('Reconnecting')) {
        return;
      }
      completed = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      callbacks.onError(msg ?? 'Codex stream error');
      return;
    }

    if (type === 'item.started' || type === 'item.updated' || type === 'item.completed') {
      const item = event.item as Record<string, unknown> | undefined;
      if (!item) return;

      const itemType = item.type as string;

      if (itemType === 'reasoning' && type === 'item.completed') {
        const text = item.text as string | undefined;
        if (text) {
          accumulatedThinking += (accumulatedThinking ? '\n\n' : '') + text;
          callbacks.onThinking?.(accumulatedThinking);
        }
        return;
      }

      if (itemType === 'command_execution') {
        const cmd = item.command as string | undefined;
        if (cmd && type === 'item.started') {
          const toolName = 'Bash';
          toolStats[toolName] = (toolStats[toolName] || 0) + 1;
          callbacks.onToolUse?.(toolName, { command: cmd });
        }
        return;
      }

      if (itemType === 'file_change' && type === 'item.completed') {
        const changes = item.changes as Array<{ path?: string; kind?: string }> | undefined;
        const toolName = 'Edit';
        toolStats[toolName] = (toolStats[toolName] || 0) + 1;
        callbacks.onToolUse?.(toolName, { changes });
        return;
      }

      if (itemType === 'mcp_tool_call' && type === 'item.started') {
        const tool = item.tool as string | undefined;
        const server = item.server as string | undefined;
        if (tool) {
          const displayName = server ? `${server}/${tool}` : tool;
          toolStats[displayName] = (toolStats[displayName] || 0) + 1;
          callbacks.onToolUse?.(displayName, item.arguments as Record<string, unknown>);
        }
        return;
      }

      if (itemType === 'agent_message' && type === 'item.completed') {
        const text = item.text as string | undefined;
        if (text) {
          accumulated += (accumulated ? '\n\n' : '') + text;
          callbacks.onText(accumulated);
        }
        return;
      }
    }

    if (type === 'turn.completed') {
      completed = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const usage = event.usage as { output_tokens?: number; input_tokens?: number } | undefined;
      const durationMs = Date.now() - startTime;
      callbacks.onComplete({
        success: true,
        result: accumulated,
        accumulated,
        cost: 0,
        durationMs,
        numTurns: 1,
        toolStats,
      });
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
        let errMsg = '';
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
        if (
          sessionId &&
          (errMsg.includes("No session found") ||
            errMsg.includes("No conversation found") ||
            errMsg.includes("Unable to find session"))
        ) {
          callbacks.onSessionInvalid?.();
        }
        callbacks.onError(errMsg || `Codex CLI exited with code ${exitCode}`);
      } else {
        callbacks.onComplete({
          success: true,
          result: accumulated,
          accumulated,
          cost: 0,
          durationMs: Date.now() - startTime,
          numTurns: 0,
          toolStats,
        });
      }
    }
  };

  child.on('close', (code) => {
    log.info(`Codex CLI closed: exitCode=${code}, pid=${child.pid}`);
    exitCode = code;
    childClosed = true;
    finalize();
  });

  rl.on('close', () => {
    rlClosed = true;
    finalize();
  });

  child.on('error', (err) => {
    const errorCode = (err as NodeJS.ErrnoException).code;
    log.error(`Codex CLI spawn error: ${err.message}, code=${errorCode}, path=${cliPath}`);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!completed) {
      completed = true;
      callbacks.onError(`Failed to start Codex CLI: ${err.message}`);
    }
    childClosed = true;
    finalize();
  });

  return {
    abort: () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      rl.close();
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}
