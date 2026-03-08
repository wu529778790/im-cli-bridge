import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { parseStreamLine, extractTextDelta, extractThinkingDelta, extractResult } from './stream-parser.js';
import { isStreamInit, isContentBlockStart, isContentBlockDelta, isContentBlockStop } from './types.js';
import { createLogger } from '../logger.js';

const log = createLogger('CliRunner');

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
  options?: ClaudeRunOptions
): ClaudeRunHandle {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];

  if (options?.skipPermissions) args.push('--dangerously-skip-permissions');
  if (options?.model) args.push('--model', options.model);
  if (sessionId) args.push('--resume', sessionId);
  args.push('--', prompt);

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  if (options?.chatId) env.CC_IM_CHAT_ID = options.chatId;
  if (options?.hookPort) env.CC_IM_HOOK_PORT = String(options.hookPort);

  const child = spawn(cliPath, args, { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'], env });

  log.debug(`Claude CLI spawned: pid=${child.pid}, cwd=${workDir}, session=${sessionId ?? 'new'}`);

  let accumulated = '';
  let accumulatedThinking = '';
  let completed = false;
  let model = '';
  const toolStats: Record<string, number> = {};
  const pendingToolInputs = new Map<number, { name: string; json: string }>();
  const MAX_TIMEOUT = 2_147_483_647;
  const timeoutMs = options?.timeoutMs && options.timeoutMs > 0 ? Math.min(options.timeoutMs, MAX_TIMEOUT) : 0;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      if (!completed && !child.killed) {
        completed = true;
        log.warn(`Claude CLI timeout after ${timeoutMs}ms, killing pid=${child.pid}`);
        child.kill('SIGTERM');
        callbacks.onError(`执行超时（${timeoutMs}ms），已终止进程`);
      }
    }, timeoutMs);
  }

  const rl = createInterface({ input: child.stdout! });

  rl.on('line', (line) => {
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

    if (isContentBlockStart(event) && event.event.content_block?.type === 'tool_use') {
      const name = event.event.content_block.name;
      if (name) pendingToolInputs.set(event.event.index, { name, json: '' });
      return;
    }

    if (isContentBlockDelta(event) && event.event.delta?.type === 'input_json_delta') {
      const pending = pendingToolInputs.get(event.event.index);
      if (pending) pending.json += event.event.delta.partial_json ?? '';
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
        callbacks.onError(`Claude CLI exited with code ${exitCode}`);
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

  child.on('close', (code) => {
    exitCode = code;
    childClosed = true;
    finalize();
  });

  rl.on('close', () => {
    rlClosed = true;
    finalize();
  });

  child.on('error', (err) => {
    log.error(`Claude CLI error: ${err.message}`);
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
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}
