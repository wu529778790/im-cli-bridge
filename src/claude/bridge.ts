/**
 * Claude Bridge - 持久化 Claude CLI 进程桥梁
 *
 * 通过保持一个长期运行的 Claude CLI 进程，实现：
 * 1. 速度提升 - 避免每次启动进程的开销
 * 2. 原生体验 - 完整转发 Claude 的权限交互界面
 * 3. 双向通信 - stdin 发送输入，stdout/stderr 接收输出
 */

import { ChildProcess, spawn } from 'node:child_process';
import { createLogger } from '../logger.js';
import type { ParsedResult } from '../adapters/tool-adapter.interface.js';

const log = createLogger('ClaudeBridge');

export interface BridgeCallbacks {
  /** Claude 的文本输出 */
  onText: (text: string) => void;
  /** Claude 的思考过程输出 */
  onThinking: (text: string) => void;
  /** 工具调用通知 */
  onToolUse?: (toolName: string, toolInput?: Record<string, unknown>) => void;
  /** 完成回调 */
  onComplete: (result: ParsedResult) => void;
  /** 错误回调 */
  onError: (error: string) => void;
  /** 会话 ID 回调 */
  onSessionId?: (sessionId: string) => void;
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
 * Claude Bridge 状态
 */
enum BridgeState {
  Idle = 'idle',
  Processing = 'processing',
  WaitingForPermission = 'waiting_for_permission',
  Closed = 'closed',
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
  const args = [];

  // 不使用 stream-json 格式，使用默认格式以便完整转发输出
  // 移除 --dangerously-skip-permissions，让 Claude 原生处理权限

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

  // 状态跟踪
  let state = BridgeState.Idle;
  let accumulatedText = '';
  let accumulatedThinking = '';
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let currentInput = '';
  const toolStats: Record<string, number> = {};
  let sessionId = '';
  const startTime = Date.now();

  // 设置超时
  if (options.timeoutMs && options.timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      if (state !== BridgeState.Idle && state !== BridgeState.Closed) {
        log.warn(`Claude Bridge timeout after ${options.timeoutMs}ms`);
        callbacks.onError(`执行超时（${options.timeoutMs}ms）`);
        cleanup();
      }
    }, options.timeoutMs);
  }

  // 处理 stdout - Claude 的主要输出
  child.stdout?.on('data', (chunk: Buffer) => {
    if (state === BridgeState.Closed) return;

    const text = chunk.toString();

    // 简单启发式：区分思考过程和最终输出
    // Claude CLI 使用特定格式输出思考过程
    if (text.includes('Thinking...') || state === BridgeState.Processing && accumulatedThinking.length > 0) {
      state = BridgeState.Processing;
      accumulatedThinking += text;
      callbacks.onThinking(accumulatedThinking);
    } else {
      state = BridgeState.Processing;
      accumulatedText += text;
      callbacks.onText(accumulatedText);
    }
  });

  // 处理 stderr - 包含权限提示、错误信息等
  child.stderr?.on('data', (chunk: Buffer) => {
    if (state === BridgeState.Closed) return;

    const text = chunk.toString();
    log.debug(`stderr: ${text.trim()}`);

    // 检测权限提示
    if (text.includes('Allow') || text.includes('Input response')) {
      state = BridgeState.WaitingForPermission;
      // 将 stderr 内容也转发给用户，因为包含权限提示
      callbacks.onText(text);
    }

    // 检测工具使用
    const toolMatch = text.match(/Using tool: (\w+)/);
    if (toolMatch) {
      const toolName = toolMatch[1];
      toolStats[toolName] = (toolStats[toolName] || 0) + 1;
      callbacks.onToolUse?.(toolName);
    }

    // 检测错误
    if (text.toLowerCase().includes('error')) {
      callbacks.onError(text);
    }
  });

  // 进程关闭
  child.on('close', (code) => {
    log.info(`Claude Bridge closed: exitCode=${code}, pid=${child.pid}`);
    state = BridgeState.Closed;

    if (code === 0) {
      const result: ParsedResult = {
        success: true,
        result: accumulatedText,
        accumulated: accumulatedText,
        cost: 0,
        durationMs: Date.now() - startTime,
        numTurns: 0,
        toolStats,
      };
      callbacks.onComplete(result);
    } else {
      callbacks.onError(`Claude CLI exited with code ${code}`);
    }
    cleanup();
  });

  // 进程错误
  child.on('error', (err) => {
    log.error(`Claude Bridge error: ${err.message}`);
    state = BridgeState.Closed;
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
      if (state === BridgeState.Closed) {
        log.warn('Cannot send input: bridge is closed');
        return;
      }

      currentInput = input;
      log.info(`Sending input to Claude: ${input.slice(0, 50)}${input.length > 50 ? '...' : ''}`);

      // 发送到 stdin
      child.stdin?.write(input + '\n');

      // 如果之前在等待权限，现在应该回到处理状态
      if (state === BridgeState.WaitingForPermission) {
        state = BridgeState.Processing;
      }
    },

    /**
     * 中止当前请求
     */
    abort: () => {
      if (state === BridgeState.Closed) return;

      log.info('Aborting current request');
      state = BridgeState.Idle;

      // 发送 Ctrl+C 到进程
      child.stdin?.write('\x03');

      // 如果不能正常中止，则强制终止
      setTimeout(() => {
        if (child && !child.killed) {
          child.kill('SIGTERM');
        }
      }, 1000);

      cleanup();
    },

    /**
     * 关闭桥梁
     */
    close: () => {
      if (state === BridgeState.Closed) return;

      log.info('Closing Claude Bridge');
      state = BridgeState.Closed;

      if (!child.killed) {
        child.kill('SIGTERM');
      }

      cleanup();
    },
  };
}
