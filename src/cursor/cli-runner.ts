/**
 * Cursor CLI Runner - 解析 Cursor Agent 的 stream-json 输出
 * 参考: https://cursor.com/docs/cli/reference/output-format
 */

import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { createLogger } from '../logger.js';

const log = createLogger('CursorCli');

export interface CursorRunCallbacks {
  onText: (accumulated: string) => void;
  onThinking?: (accumulated: string) => void;
  onToolUse?: (toolName: string, toolInput?: Record<string, unknown>) => void;
  onSessionInvalid?: () => void;
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

export interface CursorRunOptions {
  skipPermissions?: boolean;
  permissionMode?: 'default' | 'acceptEdits' | 'plan';
  timeoutMs?: number;
  model?: string;
  chatId?: string;
  hookPort?: number;
  /** HTTP/HTTPS 代理（CLI 非官方支持，部分环境可能生效） */
  proxy?: string;
}

export interface CursorRunHandle {
  abort: () => void;
}

/** 从 Cursor tool_call 事件提取工具名和参数 */
function extractToolFromCursorEvent(event: Record<string, unknown>): { name: string; input?: Record<string, unknown> } | null {
  const toolCall = event.tool_call as Record<string, unknown> | undefined;
  if (!toolCall || typeof toolCall !== 'object') return null;

  const keys = Object.keys(toolCall).filter((k) => k !== 'result');
  if (keys.length === 0) return null;

  const key = keys[0];
  const val = toolCall[key] as Record<string, unknown> | undefined;
  if (!val) return null;

  let name = key;
  if (key === 'readToolCall') name = 'Read';
  else if (key === 'writeToolCall') name = 'Write';
  else if (key === 'editToolCall') name = 'Edit';
  else if (key === 'bashToolCall' || key === 'shellToolCall') name = 'Bash';
  else if (key === 'grepToolCall') name = 'Grep';
  else if (key === 'globToolCall') name = 'Glob';
  else if (key === 'webSearchToolCall') name = 'WebSearch';
  else if (key === 'webFetchToolCall') name = 'WebFetch';
  else if (key === 'function') {
    const fn = val as { name?: string; arguments?: string };
    name = (fn.name as string) ?? 'unknown';
    try {
      const input = fn.arguments ? (JSON.parse(fn.arguments as string) as Record<string, unknown>) : undefined;
      return { name, input };
    } catch {
      return { name };
    }
  }

  const args = val.args as Record<string, unknown> | undefined;
  return { name, input: args };
}

function shouldPrependAgentSubcommand(cliPath: string): boolean {
  const command = basename(cliPath).toLowerCase();
  return command === 'cursor' || command === 'cursor.cmd' || command === 'cursor.exe';
}

export function runCursor(
  cliPath: string,
  prompt: string,
  sessionId: string | undefined,
  workDir: string,
  callbacks: CursorRunCallbacks,
  options?: CursorRunOptions
): CursorRunHandle {
  // 使用 json 格式：输出单行 JSON，stream-json 在 Windows 管道下可能无输出（lines=0）
  const args = [
    ...(shouldPrependAgentSubcommand(cliPath) ? ['agent'] : []),
    '-p', '--output-format', 'json',
    '--trust',  // headless 模式必须，否则会卡在 "Workspace Trust Required" 提示
    '--sandbox', 'disabled',  // 禁用 sandbox，避免 Windows 下 shell 命令极慢或卡死
  ];

  // Cursor CLI 运行于 stream-json 非交互模式，stdin 设为 ignore。
  // 若不加 --force，agent 遇到 shell/edit 权限时会等待 stdin 响应，
  // 由于 stdin 永远为 EOF，任务会无限期挂起。
  // plan 模式不执行操作，无需 --force；其余模式均加 --force 跳过交互式权限提示。
  if (options?.permissionMode === 'plan') {
    args.push('--plan');
  } else {
    args.push('--force');
  }

  if (options?.model) args.push('--model', options.model);
  if (sessionId) args.push('--resume', sessionId);
  args.push('--workspace', workDir);
  args.push('--', prompt);

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

  const argsForLog = args.filter(a => a !== prompt).join(' ');
  log.info(`Spawning Cursor CLI: path=${cliPath}, cwd=${workDir}, session=${sessionId ?? 'new'}, args=${argsForLog}`);

  // Windows: .cmd 需通过 cmd.exe 执行，否则 spawn 报 ENOENT
  const isCmd = process.platform === 'win32' && /\.cmd$/i.test(cliPath);
  const spawnCmd = isCmd ? 'cmd.exe' : cliPath;
  const spawnArgs = isCmd ? ['/c', cliPath, ...args] : args;

  const child = spawn(spawnCmd, spawnArgs, {
    cwd: workDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    windowsHide: process.platform === 'win32',
  });

  let accumulated = '';
  let completed = false;
  let model = '';
  const toolStats: Record<string, number> = {};
  let lineCount = 0;
  let stdoutBytes = 0;
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
        log.warn(`Cursor CLI timeout after ${timeoutMs}ms, killing pid=${child.pid}`);
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
    // 实时打印 stderr，方便诊断 Cursor CLI 问题
    log.debug(`[stderr] ${text.trimEnd()}`);
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length;
  });

  const rl = createInterface({ input: child.stdout! });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    lineCount++;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      log.warn(`[Cursor] Failed to parse line ${lineCount}: ${trimmed.slice(0, 80)}...`);
      return;
    }

    const type = event.type as string;
    log.debug(`[Cursor event] type=${type} subtype=${event.subtype}`);

    if (type === 'system' && event.subtype === 'init') {
      model = (event.model as string) ?? '';
      const sid = event.session_id as string | undefined;
      if (sid) callbacks.onSessionId?.(sid);
      log.info(`[Cursor] Session init: model=${model}, sessionId=${sid ?? 'none'}`);
      return;
    }

    if (type === 'assistant') {
      const msg = event.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
      const content = msg?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'text' && block.text) {
            accumulated += block.text;
            callbacks.onText(accumulated);
          }
        }
      }
      // 兼容 content 为字符串或结构不同的情况
      const rawContent = (msg as Record<string, unknown>)?.content;
      if (!Array.isArray(content) && typeof rawContent === 'string') {
        accumulated += rawContent;
        callbacks.onText(accumulated);
      }
      if (accumulated.length > 0) {
        log.info(`[Cursor] Assistant text received: ${accumulated.length} chars total`);
      }
      return;
    }

    if (type === 'tool_call') {
      const subtype = event.subtype as string;
      if (subtype === 'started') {
        const tool = extractToolFromCursorEvent(event);
        if (tool) {
          toolStats[tool.name] = (toolStats[tool.name] || 0) + 1;
          callbacks.onToolUse?.(tool.name, tool.input);
        }
      } else if (subtype === 'completed') {
        const toolCall = event.tool_call as Record<string, unknown> | undefined;
        if (toolCall?.shellToolCall || toolCall?.bashToolCall) {
          // Shell execution is already surfaced via tool notifications.
          // Avoid appending raw command output into the user-facing reply.
        }
      }
      return;
    }

    if (type === 'result' && event.subtype === 'success') {
      completed = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const result = (event.result as string) ?? '';
      const sid = event.session_id as string | undefined;
      if (sid) callbacks.onSessionId?.(sid);
      if (!accumulated && result) accumulated = result;
      log.info(`[Cursor] Result event: resultLen=${result.length}, accumulatedLen=${accumulated.length}, lines=${lineCount}`);
      callbacks.onComplete({
        success: true,
        result,
        accumulated,
        cost: 0,
        durationMs: (event.duration_ms as number) ?? 0,
        model,
        numTurns: 0,
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
        const fullErr = errMsg || `Cursor CLI exited with code ${exitCode}`;
        const isSessionErr = /no session found|no conversation found|unable to find session|session not found|invalid session/i.test(fullErr);
        if (isSessionErr) callbacks.onSessionInvalid?.();
        callbacks.onError(fullErr);
      } else {
        const stderrPreview = stderrTotal > 0 ? stderrHead.slice(0, 500) : '(无)';
        log.warn(
          `[Cursor] Process exited 0 without result event: accumulated=${accumulated.length} chars, lines=${lineCount}, stdoutBytes=${stdoutBytes}. stderr(${stderrTotal} chars): ${stderrPreview}`
        );
        // 检测到 Cursor IDE（非 Agent CLI）时给出明确指引
        if (stderrHead.includes('Electron') || stderrHead.includes('Chromium') || stderrHead.includes('not in the list of known options')) {
          callbacks.onError(
            '当前使用的是 Cursor IDE 的 cursor.cmd，不支持 CLI 模式。请安装独立的 Cursor Agent CLI：在 PowerShell 运行 irm \'https://cursor.com/install?win32=true\' | iex，安装后在配置中把 CLI Path 改为 agent。'
          );
          return;
        }
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
    log.info(`Cursor CLI closed: exitCode=${code}, pid=${child.pid}`);
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
    log.error(`Cursor CLI spawn error: ${err.message}, code=${errorCode}, path=${cliPath}`);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!completed) {
      completed = true;
      callbacks.onError(`Failed to start Cursor CLI: ${err.message}`);
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
