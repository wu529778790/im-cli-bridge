/**
 * Claude Bridge - 持久化 Claude CLI 进程桥梁
 *
 * 混合输出模式：
 * - stdout: 使用 stream-json 格式，结构化解析（text、thinking、tool_use、result）
 * - stderr: 完整转发，包含权限提示、错误、警告等
 *
 * 优势：
 * 1. 速度提升 - 避免每次启动进程的开销
 * 2. 原生体验 - stderr 包含 Claude 的原生权限交互界面
 * 3. 双向通信 - stdin 发送输入，stdout/stderr 接收输出
 */

import { ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createLogger } from '../logger.js';
import {
  parseStreamLine,
  extractTextDelta,
  extractThinkingDelta,
  extractResult,
} from './stream-parser.js';
import {
  isStreamInit,
  isContentBlockStart,
  isContentBlockDelta,
  isContentBlockStop,
} from './types.js';
import type { ParsedResult } from '../adapters/tool-adapter.interface.js';

const log = createLogger('ClaudeBridge');

export interface BridgeCallbacks {
  /** 初始化完成 */
  onInit?: (sessionId: string, model: string) => void;
  /** 文本输出增量 */
  onText: (delta: string, accumulated: string) => void;
  /** 思考过程增量 */
  onThinking?: (delta: string, accumulated: string) => void;
  /** 工具调用开始 */
  onToolUseStart?: (toolName: string, index: number) => void;
  /** 工具输入参数增量 */
  onToolInputDelta?: (index: number, partialJson: string, accumulated: string) => void;
  /** 工具调用完成 */
  onToolUseComplete?: (index: number, toolName: string, input: Record<string, unknown> | undefined) => void;
  /** 权限提示 */
  onPermissionPrompt?: (message: string) => void;
  /** 用户输入请求 */
  onUserInputRequest?: (message: string) => void;
  /** 完成回调 */
  onComplete: (result: ParsedResult) => void;
  /** 错误回调 */
  onError: (error: string) => void;
}

export interface BridgeOptions {
  /** Claude CLI 路径 */
  cliPath: string;
  /** 工作目录 */
  workDir: string;
  /** 模型选择 */
  model?: string;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
}

export interface BridgeHandle {
  /** 向 Claude 发送用户输入 */
  sendInput: (input: string) => void;
  /** 中止当前请求 */
  abort: () => void;
  /** 关闭桥梁 */
  close: () => void;
}

/**
 * Claude Bridge 状态机
 */
enum BridgeState {
  /** 初始状态，等待进程启动 */
  Idle = 'idle',
  /** 正在处理流式输出 */
  Processing = 'processing',
  /** 等待权限确认（用户需要回复 "1", "2" 等） */
  WaitingForPermission = 'waiting_for_permission',
  /** 等待用户输入（如文件编辑确认等） */
  WaitingForUserInput = 'waiting_for_user_input',
  /** 正在执行工具 */
  ExecutingTool = 'executing_tool',
  /** 已关闭 */
  Closed = 'closed',
}

/**
 * 桥梁上下文 - 跟踪状态和累积数据
 */
interface BridgeContext {
  /** 当前状态 */
  state: BridgeState;
  /** 累积文本输出 */
  accumulatedText: string;
  /** 累积思考过程 */
  accumulatedThinking: string;
  /** 当前会话 ID */
  sessionId: string;
  /** 当前模型 */
  model: string;
  /** 工具统计 */
  toolStats: Record<string, number>;
  /** 等待工具输入参数的映射 */
  pendingToolInputs: Map<number, { name: string; json: string }>;
  /** 开始时间 */
  startTime: number;
  /** 是否已完成 */
  completed: boolean;
}

/**
 * 创建并启动 Claude Bridge
 *
 * 保持一个长期运行的 Claude CLI 进程，通过 stdin/stdout 实现双向通信
 */
export function createBridge(
  callbacks: BridgeCallbacks,
  options: BridgeOptions
): BridgeHandle {
  const { cliPath, workDir, model } = options;

  // 构建启动参数
  const args = [
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  // 不传递 --permission-mode，让 Claude 原生处理权限
  if (model) {
    args.push('--model', model);
  }

  // 环境变量设置
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Skip CLAUDECODE to prevent nested session detection
    if (k === 'CLAUDECODE') continue;
    if (v !== undefined) env[k] = v;
  }

  // 启动 Claude CLI 进程
  const child = spawn(cliPath, args, {
    cwd: workDir,
    stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr 都是 pipe
    env,
    windowsHide: process.platform === 'win32',
  });

  log.info(`Claude Bridge started: pid=${child.pid}, cwd=${workDir}`);

  // 初始化上下文
  const context: BridgeContext = {
    state: BridgeState.Idle,
    accumulatedText: '',
    accumulatedThinking: '',
    sessionId: '',
    model: '',
    toolStats: {},
    pendingToolInputs: new Map(),
    startTime: Date.now(),
    completed: false,
  };

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  // 设置超时
  if (options.timeoutMs && options.timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      if (context.state !== BridgeState.Idle && context.state !== BridgeState.Closed) {
        log.warn(`Claude Bridge timeout after ${options.timeoutMs}ms`);
        if (!context.completed) {
          callbacks.onError(`执行超时（${options.timeoutMs}ms）`);
        }
        cleanup();
      }
    }, options.timeoutMs);
  }

  // 处理 stdout - stream-json 格式的结构化事件
  const rl = createInterface({ input: child.stdout! });

  rl.on('line', (line) => {
    if (context.state === BridgeState.Closed) return;

    const event = parseStreamLine(line);
    if (!event) return;

    // 处理初始化事件
    if (isStreamInit(event)) {
      context.model = event.model;
      context.sessionId = event.session_id;
      context.state = BridgeState.Processing;
      callbacks.onInit?.(event.session_id, event.model);
      return;
    }

    // 处理文本增量
    const textDelta = extractTextDelta(event);
    if (textDelta) {
      context.state = BridgeState.Processing;
      context.accumulatedText += textDelta.text;
      callbacks.onText(textDelta.text, context.accumulatedText);
      return;
    }

    // 处理思考增量
    const thinkingDelta = extractThinkingDelta(event);
    if (thinkingDelta) {
      context.state = BridgeState.Processing;
      context.accumulatedThinking += thinkingDelta.text;
      callbacks.onThinking?.(thinkingDelta.text, context.accumulatedThinking);
      return;
    }

    // 处理工具使用开始
    if (isContentBlockStart(event) && event.event.content_block?.type === 'tool_use') {
      const name = event.event.content_block.name;
      if (name) {
        context.pendingToolInputs.set(event.event.index, { name, json: '' });
        callbacks.onToolUseStart?.(name, event.event.index);
        context.state = BridgeState.ExecutingTool;
      }
      return;
    }

    // 处理工具输入参数
    if (isContentBlockDelta(event) && event.event.delta?.type === 'input_json_delta') {
      const pending = context.pendingToolInputs.get(event.event.index);
      if (pending) {
        pending.json += event.event.delta.partial_json ?? '';
        callbacks.onToolInputDelta?.(
          event.event.index,
          event.event.delta.partial_json ?? '',
          pending.json
        );
      }
      return;
    }

    // 处理工具使用完成
    if (isContentBlockStop(event)) {
      const pending = context.pendingToolInputs.get(event.event.index);
      if (pending) {
        context.toolStats[pending.name] = (context.toolStats[pending.name] || 0) + 1;
        let input: Record<string, unknown> | undefined;
        try {
          input = JSON.parse(pending.json);
        } catch {
          /* ignore parse error */
        }
        callbacks.onToolUseComplete?.(event.event.index, pending.name, input);
        context.pendingToolInputs.delete(event.event.index);
        context.state = BridgeState.Processing;
      }
      return;
    }

    // 处理结果
    const result = extractResult(event);
    if (result) {
      context.completed = true;
      context.state = BridgeState.Processing;
      const fullResult: ParsedResult = {
        ...result,
        accumulated: context.accumulatedText,
        result: context.accumulatedText || result.result,
        toolStats: context.toolStats,
      };
      if (!context.accumulatedText && fullResult.result) {
        context.accumulatedText = fullResult.result;
      }
      callbacks.onComplete(fullResult);
      cleanup();
    }
  });

  // 处理 stderr - 包含权限提示、用户输入请求、错误信息等
  child.stderr?.on('data', (chunk: Buffer) => {
    if (context.state === BridgeState.Closed) return;

    const text = chunk.toString();
    log.debug(`stderr: ${text.trim()}`);

    // 检测权限提示
    if (text.includes('Allow') || text.includes('Always allow')) {
      context.state = BridgeState.WaitingForPermission;
      callbacks.onPermissionPrompt?.(text);
      return;
    }

    // 检测用户输入请求
    if (text.includes('Input response') || text.includes('Enter your choice')) {
      context.state = BridgeState.WaitingForUserInput;
      callbacks.onUserInputRequest?.(text);
      return;
    }

    // 检测错误
    if (text.toLowerCase().includes('error')) {
      callbacks.onError(text);
    }
  });

  // 进程关闭
  child.on('close', (code) => {
    log.info(`Claude Bridge closed: exitCode=${code}, pid=${child.pid}`);
    context.state = BridgeState.Closed;

    if (!context.completed) {
      if (code === 0) {
        // 正常退出，但没有收到 result 事件
        const result: ParsedResult = {
          success: true,
          result: context.accumulatedText,
          accumulated: context.accumulatedText,
          cost: 0,
          durationMs: Date.now() - context.startTime,
          numTurns: 0,
          toolStats: context.toolStats,
        };
        callbacks.onComplete(result);
      } else {
        callbacks.onError(`Claude CLI exited with code ${code}`);
      }
    }
    cleanup();
  });

  // 进程错误
  child.on('error', (err) => {
    log.error(`Claude Bridge error: ${err.message}`);
    context.state = BridgeState.Closed;
    callbacks.onError(`Failed to start Claude CLI: ${err.message}`);
    cleanup();
  });

  // 清理函数
  const cleanup = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };

  return {
    /**
     * 向 Claude 发送用户输入
     */
    sendInput: (input: string) => {
      if (context.state === BridgeState.Closed) {
        log.warn('Cannot send input: bridge is closed');
        return;
      }

      log.info(`Sending input to Claude: "${input.slice(0, 50)}${input.length > 50 ? '...' : ''}"`);

      try {
        // 发送到 stdin
        child.stdin?.write(input + '\n');

        // 如果之前在等待权限或用户输入，现在应该回到处理状态
        if (context.state === BridgeState.WaitingForPermission ||
            context.state === BridgeState.WaitingForUserInput) {
          context.state = BridgeState.Processing;
        }
      } catch (error) {
        log.error(`Failed to send input: ${error}`);
        callbacks.onError(`发送输入失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    /**
     * 中止当前请求
     */
    abort: () => {
      if (context.state === BridgeState.Closed) return;

      log.info('Aborting current request');
      context.state = BridgeState.Idle;

      // 发送 Ctrl+C 到进程
      child.stdin?.write('\x03');

      // 如果不能正常中止，则强制终止
      const forceKillTimeout = setTimeout(() => {
        if (!child.killed) {
          log.warn('Force Force killing Claude CLI after abort');
          child.kill('SIGTERM');

          // 5秒后 SIGKILL
          setTimeout(() => {
            if (!child.killed) {
              log.warn('Force Force killing Claude CLI with SIGKILL');
              child.kill('SIGKILL');
            }
          }, 5000).unref();
        }
      }, 1000).unref();

      cleanup();
    },

    /**
     * 关闭桥梁
     */
    close: () => {
      if (context.state === BridgeState.Closed) return;

      log.info('Closing Claude Bridge');
      context.state = BridgeState.Closed;

      if (!child.killed) {
        child.kill('SIGTERM');
      }

      cleanup();
    },
  };
}
