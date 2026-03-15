import { execFileSync, spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('CodeBuddyCli');
const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export interface CodeBuddyRunCallbacks {
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

export interface CodeBuddyRunOptions {
  skipPermissions?: boolean;
  permissionMode?: 'default' | 'acceptEdits' | 'plan';
  timeoutMs?: number;
  model?: string;
}

export interface CodeBuddyRunHandle {
  abort: () => void;
}

function getIdleTimeoutMs(totalTimeoutMs: number): number {
  const raw = process.env.CODEBUDDY_IDLE_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const configuredIdleTimeoutMs =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(parsed, MAX_TIMEOUT_MS)
      : DEFAULT_IDLE_TIMEOUT_MS;

  return totalTimeoutMs > 0
    ? Math.min(configuredIdleTimeoutMs, totalTimeoutMs)
    : configuredIdleTimeoutMs;
}

export function buildCodeBuddyArgs(
  prompt: string,
  sessionId: string | undefined,
  options?: CodeBuddyRunOptions,
): string[] {
  const args = ['--print', '--output-format', 'stream-json'];

  if (options?.skipPermissions) {
    args.push('--dangerously-skip-permissions');
  } else if (options?.permissionMode === 'plan') {
    args.push('--permission-mode', 'plan');
  } else if (options?.permissionMode === 'acceptEdits') {
    args.push('--permission-mode', 'acceptEdits');
  }

  if (options?.model) {
    args.push('--model', options.model);
  }

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  args.push(prompt);
  return args;
}

function normalizePermissionMode(
  permissionMode: CodeBuddyRunOptions['permissionMode'],
): string | undefined {
  if (permissionMode === 'acceptEdits') return 'acceptEdits';
  if (permissionMode === 'plan') return 'plan';
  if (permissionMode === 'default') return 'default';
  return undefined;
}

function normalizeCliPath(cliPath: string): string {
  if (process.platform !== 'win32' || cliPath !== 'codebuddy') return cliPath;

  const candidates = [
    join(process.env.APPDATA || '', 'npm', 'codebuddy.cmd'),
    join(process.env.LOCALAPPDATA || '', 'npm', 'codebuddy.cmd'),
  ];

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.F_OK);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  return cliPath;
}

function parseSseChunk(buffer: string): Array<{ event: string; data: string }> {
  const chunks = buffer.split(/\r?\n\r?\n/);
  const events: Array<{ event: string; data: string }> = [];

  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/);
    let event = '';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim());
      }
    }

    if (event && dataLines.length > 0) {
      events.push({ event, data: dataLines.join('\n') });
    }
  }

  return events;
}

function extractSseFrames(state: { buffer: string }): Array<{ event: string; data: string }> {
  const frames: Array<{ event: string; data: string }> = [];

  while (true) {
    const separatorIndex = state.buffer.search(/\r?\n\r?\n/);
    if (separatorIndex < 0) break;

    const chunk = state.buffer.slice(0, separatorIndex);
    const separatorMatch = state.buffer.slice(separatorIndex).match(/^\r?\n\r?\n/);
    const separatorLength = separatorMatch?.[0].length ?? 2;
    state.buffer = state.buffer.slice(separatorIndex + separatorLength);
    frames.push(...parseSseChunk(chunk));
  }

  return frames;
}

function extractNdjsonPayloads(state: { buffer: string }): string[] {
  const payloads: string[] = [];

  while (true) {
    const newlineIndex = state.buffer.indexOf('\n');
    if (newlineIndex < 0) break;

    const line = state.buffer.slice(0, newlineIndex).trim();
    state.buffer = state.buffer.slice(newlineIndex + 1);
    if (line) payloads.push(line);
  }

  return payloads;
}

export function extractBufferedPayloads(state: { buffer: string }): string[] {
  const payloads: string[] = [];

  if (state.buffer.includes('event:') || state.buffer.includes('data:')) {
    for (const frame of extractSseFrames(state)) {
      if (frame.event === 'done') continue;
      payloads.push(frame.data);
    }
    return payloads;
  }

  payloads.push(...extractNdjsonPayloads(state));
  return payloads;
}

export function flushBufferedPayloads(state: { buffer: string }): string[] {
  const payloads = extractBufferedPayloads(state);
  const trailing = state.buffer.trim();
  if (trailing) {
    payloads.push(trailing);
    state.buffer = '';
  }
  return payloads;
}

function extractTextBlocks(content: unknown): { text: string; thinking: string } {
  if (!Array.isArray(content)) return { text: '', thinking: '' };

  let text = '';
  let thinking = '';

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;

    if (record.type === 'text' && typeof record.text === 'string') {
      text += (text ? '\n' : '') + record.text;
      continue;
    }

    if (record.type === 'thinking' && typeof record.thinking === 'string') {
      thinking += (thinking ? '\n' : '') + record.thinking;
    }
  }

  return { text, thinking };
}

function extractToolUses(content: unknown): Array<{ name: string; input?: Record<string, unknown> }> {
  if (!Array.isArray(content)) return [];

  const toolUses: Array<{ name: string; input?: Record<string, unknown> }> = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    if (record.type !== 'tool_use' || typeof record.name !== 'string') continue;

    toolUses.push({
      name: record.name,
      input:
        record.input && typeof record.input === 'object' && !Array.isArray(record.input)
          ? (record.input as Record<string, unknown>)
          : undefined,
    });
  }

  return toolUses;
}

export function runCodeBuddy(
  cliPath: string,
  prompt: string,
  sessionId: string | undefined,
  workDir: string,
  callbacks: CodeBuddyRunCallbacks,
  options?: CodeBuddyRunOptions,
): CodeBuddyRunHandle {
  const normalizedCliPath = normalizeCliPath(cliPath);
  const args = buildCodeBuddyArgs(prompt, sessionId, {
    ...options,
    permissionMode: normalizePermissionMode(options?.permissionMode) as CodeBuddyRunOptions['permissionMode'],
  });

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  if (process.platform === 'win32') {
    env.LANG = env.LANG || 'C.UTF-8';
    env.LC_ALL = env.LC_ALL || 'C.UTF-8';
  }

  const isCmd = process.platform === 'win32' && (
    /\.(cmd|bat)$/i.test(normalizedCliPath) ||
    normalizedCliPath === 'codebuddy'
  );
  const spawnCmd = isCmd ? 'cmd.exe' : normalizedCliPath;
  const spawnArgs = isCmd ? ['/c', normalizedCliPath, ...args] : args;

  log.info(`Spawning CodeBuddy CLI: path=${normalizedCliPath}, cwd=${workDir}, session=${sessionId ?? 'new'}, args=${args.join(' ')}`);

  const child = spawn(spawnCmd, spawnArgs, {
    cwd: workDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    windowsHide: process.platform === 'win32',
  });

  let accumulated = '';
  let accumulatedThinking = '';
  let completed = false;
  let sessionReported = false;
  let currentModel: string | undefined;
  const toolStats: Record<string, number> = {};
  const startTime = Date.now();

  const timeoutMs =
    options?.timeoutMs && options.timeoutMs > 0
      ? Math.min(options.timeoutMs, MAX_TIMEOUT_MS)
      : 0;
  const idleTimeoutMs = getIdleTimeoutMs(timeoutMs);

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let idleTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const stdoutState = { buffer: '' };

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

  const resetIdleTimeout = () => {
    if (idleTimeoutMs <= 0 || completed) return;
    if (idleTimeoutHandle) clearTimeout(idleTimeoutHandle);
    idleTimeoutHandle = setTimeout(() => {
      if (completed) return;
      completed = true;
      clearTimers();
      if (!child.killed) child.kill('SIGTERM');
      callbacks.onError(`CodeBuddy 执行长时间无输出，已自动终止（${idleTimeoutMs}ms）`);
    }, idleTimeoutMs);
  };

  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      if (completed) return;
      completed = true;
      clearTimers();
      if (!child.killed) child.kill('SIGTERM');
      callbacks.onError(`CodeBuddy 执行超时（${timeoutMs}ms），已终止`);
    }, timeoutMs);
  }
  resetIdleTimeout();

  const MAX_STDERR = 8 * 1024;
  let stderrText = '';

  const handleErrorText = (message: string) => {
    if (sessionId && /No conversation found|Session not found|Invalid session|Unable to resume/i.test(message)) {
      callbacks.onSessionInvalid?.();
    }
    callbacks.onError(message);
  };

  const handlePayload = (payload: Record<string, unknown>) => {
    const type = payload.type;

    if (type === 'system' && payload.subtype === 'init') {
      const nextSessionId =
        typeof payload.session_id === 'string'
          ? payload.session_id
          : typeof payload.uuid === 'string'
            ? payload.uuid
            : undefined;
      const model = typeof payload.model === 'string' ? payload.model : undefined;
      if (model) currentModel = model;
      if (nextSessionId && !sessionReported) {
        sessionReported = true;
        callbacks.onSessionId?.(nextSessionId);
      }
      return;
    }

    if (type === 'assistant') {
      const message =
        payload.message && typeof payload.message === 'object'
          ? (payload.message as Record<string, unknown>)
          : undefined;
      if (!message) return;

      if (typeof message.model === 'string') currentModel = message.model;

      const { text, thinking } = extractTextBlocks(message.content);
      for (const toolUse of extractToolUses(message.content)) {
        toolStats[toolUse.name] = (toolStats[toolUse.name] || 0) + 1;
        callbacks.onToolUse?.(toolUse.name, toolUse.input);
      }

      if (thinking) {
        accumulatedThinking = thinking;
        callbacks.onThinking?.(accumulatedThinking);
      }

      if (text) {
        accumulated = text;
        callbacks.onText(accumulated);
      }
      return;
    }

    if (type === 'result') {
      if (completed) return;
      completed = true;
      clearTimers();
      const isError = payload.is_error === true;
      const resultText =
        typeof payload.result === 'string'
          ? payload.result
          : accumulated;

      if (isError) {
        const errors = Array.isArray(payload.errors)
          ? payload.errors.map((item) => String(item)).join('\n')
          : resultText || 'CodeBuddy execution failed';
        handleErrorText(errors);
        return;
      }

      callbacks.onComplete({
        success: true,
        result: resultText,
        accumulated: accumulated || resultText,
        cost: 0,
        durationMs: Date.now() - startTime,
        model: currentModel,
        numTurns: 1,
        toolStats,
      });
    }
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    resetIdleTimeout();
    stdoutState.buffer += chunk.toString();
    const payloads = extractBufferedPayloads(stdoutState);
    for (const payload of payloads) {
      try {
        handlePayload(JSON.parse(payload) as Record<string, unknown>);
      } catch {
        log.debug(`Failed to parse CodeBuddy stream payload: ${payload.slice(0, 200)}`);
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    resetIdleTimeout();
    stderrText += chunk.toString();
    if (stderrText.length > MAX_STDERR) {
      stderrText = stderrText.slice(-MAX_STDERR);
    }
  });

  child.on('close', (code) => {
    clearTimers();
    if (completed) return;

    if (stdoutState.buffer.trim()) {
      for (const payload of flushBufferedPayloads(stdoutState)) {
        try {
          handlePayload(JSON.parse(payload) as Record<string, unknown>);
        } catch {
          // Ignore trailing partial payloads.
        }
      }
      if (completed) return;
    }

    if (code && code !== 0) {
      completed = true;
      handleErrorText(stderrText.trim() || `CodeBuddy CLI exited with code ${code}`);
      return;
    }

    completed = true;
    callbacks.onComplete({
      success: true,
      result: accumulated,
      accumulated,
      cost: 0,
      durationMs: Date.now() - startTime,
      model: currentModel,
      numTurns: accumulated ? 1 : 0,
      toolStats,
    });
  });

  child.on('error', (err) => {
    clearTimers();
    if (completed) return;
    completed = true;
    callbacks.onError(`Failed to start CodeBuddy CLI: ${err.message}`);
  });

  return {
    abort: () => {
      completed = true;
      clearTimers();
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}

export function checkCodeBuddyCliAvailable(cliPath: string): boolean {
  const target = normalizeCliPath(cliPath);
  if (isAbsolute(target) || target.includes('/') || target.includes('\\')) {
    try {
      accessSync(target, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  const checkCommand = process.platform === 'win32' ? 'where' : 'which';
  try {
    execFileSync(checkCommand, [target], {
      stdio: 'pipe',
      windowsHide: process.platform === 'win32',
    });
    return true;
  } catch {
    return false;
  }
}
