/**
 * Codex CLI runner for `codex exec --json` JSONL output.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createLogger } from '../logger.js';

const log = createLogger('CodexCli');
const windowsCodexLaunchCache = new Map<string, { command: string; args: string[] } | null>();
const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.avif',
]);

function getIdleTimeoutMs(totalTimeoutMs: number): number {
  const raw = process.env.CODEX_IDLE_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const configuredIdleTimeoutMs =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(parsed, MAX_TIMEOUT_MS)
      : DEFAULT_IDLE_TIMEOUT_MS;

  return totalTimeoutMs > 0
    ? Math.min(configuredIdleTimeoutMs, totalTimeoutMs)
    : configuredIdleTimeoutMs;
}

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

function isSupportedImagePath(filePath: string): boolean {
  const normalized = filePath.trim();
  if (!normalized || !existsSync(normalized)) return false;
  const lower = normalized.toLowerCase();
  return Array.from(SUPPORTED_IMAGE_EXTENSIONS).some((ext) => lower.endsWith(ext));
}

export function extractPromptImagePaths(prompt: string): string[] {
  const imagePaths = new Set<string>();
  const lines = prompt.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const singleMatch = /^Saved local file path:\s*(.+)$/i.exec(line);
    if (singleMatch) {
      const candidate = singleMatch[1].trim();
      if (isSupportedImagePath(candidate)) imagePaths.add(candidate);
      continue;
    }

    const batchMatch = /^\d+\.\s+(?:.+:\s+)?(.+?)\s+\((image)\)$/i.exec(line);
    if (batchMatch) {
      const candidate = batchMatch[1].trim();
      if (isSupportedImagePath(candidate)) imagePaths.add(candidate);
    }
  }

  return Array.from(imagePaths);
}

export function buildCodexArgs(
  prompt: string,
  sessionId: string | undefined,
  workDir: string,
  options?: CodexRunOptions,
): string[] {
  const commonOptions = ['--json', '--skip-git-repo-check'];
  const newSessionOptions = [...commonOptions, '--cd', workDir];
  const resumeOptions = [...commonOptions];
  const canResume = Boolean(sessionId) && options?.permissionMode !== 'plan';
  const imagePaths = extractPromptImagePaths(prompt);

  if (options?.skipPermissions) {
    newSessionOptions.push('--dangerously-bypass-approvals-and-sandbox');
    resumeOptions.push('--dangerously-bypass-approvals-and-sandbox');
  } else if (options?.permissionMode === 'plan') {
    newSessionOptions.push('--sandbox', 'read-only');
  } else {
    newSessionOptions.push('--full-auto');
    resumeOptions.push('--full-auto');
  }

  if (options?.model) {
    newSessionOptions.push('--model', options.model);
    resumeOptions.push('--model', options.model);
  }

  for (const imagePath of imagePaths) {
    newSessionOptions.push('--image', imagePath);
    resumeOptions.push('--image', imagePath);
  }

  if (sessionId && !canResume) {
    log.warn('Codex plan mode does not support resume; starting a new read-only session');
  }

  return canResume
    ? ['exec', 'resume', ...resumeOptions, sessionId!, '-']
    : ['exec', ...newSessionOptions, '-'];
}

function quoteForWindowsCmd(arg: string): string {
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

    const cmdShimPath = whereOutput.find((line) => /\.cmd$/i.test(line)) ?? null;
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
  options?: CodexRunOptions,
): CodexRunHandle {
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
    env.LANG = env.LANG || 'C.UTF-8';
    env.LC_ALL = env.LC_ALL || 'C.UTF-8';
  }

  const argsForLog = args.join(' ');
  log.info(`Spawning Codex CLI: path=${cliPath}, cwd=${workDir}, session=${sessionId ?? 'new'}, args=${argsForLog}`);

  const isWinCmd =
    process.platform === 'win32' &&
    (/\.(cmd|bat)$/i.test(cliPath) || cliPath === 'codex');
  const directWindowsLaunch = isWinCmd ? resolveWindowsCodexLaunch(cliPath, args) : null;
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

  child.stdin?.write(prompt);
  child.stdin?.end();

  let accumulated = '';
  let accumulatedThinking = '';
  let completed = false;
  const toolStats: Record<string, number> = {};
  const startTime = Date.now();

  const timeoutMs =
    options?.timeoutMs && options.timeoutMs > 0
      ? Math.min(options.timeoutMs, MAX_TIMEOUT_MS)
      : 0;
  const idleTimeoutMs = getIdleTimeoutMs(timeoutMs);

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let idleTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const rl = createInterface({ input: child.stdout! });

  const clearTimers = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    if (idleTimeoutHandle) {
      clearTimeout(idleTimeoutHandle);
      idleTimeoutHandle = null;
    }
  };

  const failAndTerminate = (message: string, logMessage: string) => {
    if (completed) return;
    completed = true;
    clearTimers();
    log.warn(logMessage);
    rl.close();
    if (!child.killed) child.kill('SIGTERM');
    callbacks.onError(message);
  };

  const resetIdleTimeout = () => {
    if (idleTimeoutMs <= 0 || completed) return;
    if (idleTimeoutHandle) clearTimeout(idleTimeoutHandle);
    idleTimeoutHandle = setTimeout(() => {
      failAndTerminate(
        `Codex 执行长时间无输出，已自动终止（${idleTimeoutMs}ms）`,
        `Codex CLI idle timeout after ${idleTimeoutMs}ms, killing pid=${child.pid}`,
      );
    }, idleTimeoutMs);
  };

  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      if (!completed && !child.killed) {
        failAndTerminate(
          `执行超时（${timeoutMs}ms），已终止进程`,
          `Codex CLI timeout after ${timeoutMs}ms, killing pid=${child.pid}`,
        );
      }
    }, timeoutMs);
  }
  resetIdleTimeout();

  const MAX_STDERR_HEAD = 4 * 1024;
  const MAX_STDERR_TAIL = 6 * 1024;
  let stderrHead = '';
  let stderrTail = '';
  let stderrTotal = 0;
  let stderrHeadFull = false;

  child.stderr?.on('data', (chunk: Buffer) => {
    resetIdleTimeout();
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

  rl.on('line', (line) => {
    resetIdleTimeout();
    const event = parseCodexEvent(line);
    if (!event) return;

    const type = event.type as string;
    log.debug(`[Codex event] type=${type}`);

    if (type === 'thread.started') {
      const threadId = (event.thread_id as string) ?? '';
      if (threadId) callbacks.onSessionId?.(threadId);
      return;
    }

    if (type === 'turn.failed') {
      completed = true;
      clearTimers();
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
      clearTimers();
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
      clearTimers();
      callbacks.onComplete({
        success: true,
        result: accumulated,
        accumulated,
        cost: 0,
        durationMs: Date.now() - startTime,
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
    clearTimers();
    if (completed) return;

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
            `\n\n... (omitted ${stderrTotal - MAX_STDERR_HEAD - MAX_STDERR_TAIL} bytes) ...\n\n` +
            stderrTail;
        }
      }
      if (
        sessionId &&
        (errMsg.includes('No session found') ||
          errMsg.includes('No conversation found') ||
          errMsg.includes('Unable to find session'))
      ) {
        callbacks.onSessionInvalid?.();
      }
      callbacks.onError(errMsg || `Codex CLI exited with code ${exitCode}`);
      return;
    }

    callbacks.onComplete({
      success: true,
      result: accumulated,
      accumulated,
      cost: 0,
      durationMs: Date.now() - startTime,
      numTurns: 0,
      toolStats,
    });
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
    clearTimers();
    if (!completed) {
      completed = true;
      callbacks.onError(`Failed to start Codex CLI: ${err.message}`);
    }
    childClosed = true;
    finalize();
  });

  return {
    abort: () => {
      completed = true;
      clearTimers();
      rl.close();
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}
