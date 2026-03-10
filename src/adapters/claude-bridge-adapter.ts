/**
 * Claude Bridge Adapter - 持久化进程适配器
 *
 * 与普通适配器不同，这个适配器支持双向通信：
 * - Claude 输出（包括权限提示） -> IM
 * - 用户输入（如 "1" 允许可权） -> Claude
 */

import { createBridge, type BridgeCallbacks, type BridgeHandle, type BridgeOptions } from '../claude/bridge.js';
import type { ToolAdapter, RunCallbacks, RunOptions, RunHandle } from './tool-adapter.interface.js';
import { createLogger } from '../logger.js';

const log = createLogger('ClaudeBridgeAdapter');

// 全局桥梁实例存储（按 userId/workDir）
const bridges = new Map<string, BridgeInstance>();

interface BridgeInstance {
  handle: BridgeHandle;
  lastUsed: number;
  callbacks: BridgeCallbacks | null;
  currentRunPromise: Promise<void> | null;
  currentResolve: (() => void) | null;
}

interface BridgeAdapterHandle extends RunHandle {
  /** 发送用户输入（用于权限回复等） */
  sendInput: (input: string) => void;
}

export class ClaudeBridgeAdapter implements ToolAdapter {
  readonly toolId = 'claude-bridge';

  constructor(
    private cliPath: string,
    private options?: { bridgeIdleTimeoutMs?: number }
  ) {}

  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions
  ): RunHandle {
    const userId = options?.chatId || 'default';
    const bridgeKey = `${userId}:${workDir}`;

    log.info(`Running with bridge: userId=${userId}, workDir=${workDir}`);

    // 检查是否已有桥梁
    let instance = bridges.get(bridgeKey);
    if (instance) {
      log.info(`Reusing existing bridge: ${bridgeKey}`);
      instance.lastUsed = Date.now();

      // 创建 Promise 来追踪本次运行
      const runPromise = new Promise<void>((resolve) => {
        instance!.currentResolve = resolve;
        instance!.callbacks = this.adaptCallbacks(callbacks, sessionId, resolve);
      });

      instance.currentRunPromise = runPromise;

      // 发送 prompt
      instance.handle.sendInput(prompt);

      return {
        abort: () => {
          instance!.currentResolve?.();
          instance!.handle.abort();
        },
        sendInput: instance.handle.sendInput,
      } as BridgeAdapterHandle;
    }

    // 创建新桥梁
    log.info(`Creating new bridge: ${bridgeKey}`);

    let currentResolve: (() => void) | null = null;
    const runPromise = new Promise<void>((resolve) => {
      currentResolve = resolve;
    });

    const adaptedCallbacks = this.adaptCallbacks(callbacks, sessionId, currentResolve);

    const bridgeHandle = createBridge(adaptedCallbacks, {
      cliPath: this.cliPath,
      workDir,
      model: options?.model,
      timeoutMs: options?.timeoutMs,
    });

    // 存储桥梁
    const newInstance: BridgeInstance = {
      handle: bridgeHandle,
      lastUsed: Date.now(),
      callbacks: adaptedCallbacks,
      currentRunPromise: runPromise,
      currentResolve,
    };

    bridges.set(bridgeKey, newInstance);

    // 发送初始 prompt
    bridgeHandle.sendInput(prompt);

    // 返回句柄
    return {
      abort: () => {
        currentResolve?.();
        bridgeHandle.abort();
      },
      sendInput: bridgeHandle.sendInput,
    } as BridgeAdapterHandle;
  }

  /**
   * 适配 RunCallbacks 为 BridgeCallbacks
   */
  private adaptCallbacks(
    callbacks: RunCallbacks,
    sessionId: string | undefined,
    resolveFn: (() => void) | null
  ): BridgeCallbacks {
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      resolveFn?.();
    };

    return {
      onInit: (sid, _model) => {
        if (callbacks.onSessionId) {
          callbacks.onSessionId(sid);
        }
      },

      onText: (_delta, accumulated) => {
        callbacks.onText(accumulated);
      },

      onThinking: (_delta, accumulated) => {
        if (callbacks.onThinking) {
          callbacks.onThinking(accumulated);
        }
      },

      onToolUseStart: (toolName, _index) => {
        if (callbacks.onToolUse) {
          // 工具使用开始时，暂时不通知，等完成时通知
        }
      },

      onToolInputDelta: undefined, // 忽略输入参数增量

      onToolUseComplete: (_index, toolName, input) => {
        if (callbacks.onToolUse && toolName) {
          callbacks.onToolUse(toolName, input);
        }
      },

      onPermissionPrompt: (message) => {
        // 权限提示通过 onText 转发，让用户看到
        callbacks.onText(message);
      },

      onUserInputRequest: (message) => {
        // 用户输入请求也通过 onText 转发
        callbacks.onText(message);
      },

      onComplete: (result) => {
        if (!settled) {
          callbacks.onComplete(result);
        }
        settle();
      },

      onError: (error) => {
        if (!settled) {
          callbacks.onError(error);
        }
        settle();
      },
    };
  }

  /**
   * 发送用户输入到指定桥梁
   *
   * @param userId 用户 ID
   * @param workDir 工作目录
   * @param input 用户输入（如权限回复 "1", "2" 等）
   * @returns 是否成功发送
   */
  static sendUserInput(userId: string, workDir: string, input: string): boolean {
    const bridgeKey = `${userId}:${workDir}`;
    const instance = bridges.get(bridgeKey);

    if (!instance) {
      log.warn(`No bridge found for: ${bridgeKey}`);
      return false;
    }

    instance.lastUsed = Date.now();
    instance.handle.sendInput(input);
    log.info(`User input sent to bridge: ${bridgeKey}, input="${input}"`);
    return true;
  }

  /**
   * 中止指定用户的桥梁
   */
  static abort(userId: string, workDir: string): boolean {
    const bridgeKey = `${userId}:${workDir}`;
    const instance = bridges.get(bridgeKey);

    if (!instance) {
      return false;
    }

    instance.currentResolve?.();
    instance.handle.abort();
    bridges.delete(bridgeKey);
    log.info(`Bridge aborted: ${bridgeKey}`);
    return true;
  }

  /**
   * 获取活跃桥梁数量
   */
  static getActiveBridgeCount(): number {
    return bridges.size;
  }

  /**
   * 清理空闲桥梁
   */
  static cleanupIdleBridges(idleTimeoutMs: number = 10 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, instance] of bridges.entries()) {
      if (now - instance.lastUsed > idleTimeoutMs) {
        instance.currentResolve?.();
        instance.handle.close();
        bridges.delete(key);
        cleaned++;
        log.info(`Idle bridge cleaned up: ${key}`);
      }
    }

    if (cleaned > 0) {
      log.info(`Cleaned up ${cleaned} idle bridges, ${bridges.size} remaining`);
    }

    return cleaned;
  }

  /**
   * 关闭所有桥梁
   */
  static closeAll(): void {
    for (const [key, instance] of bridges.entries()) {
      instance.currentResolve?.();
      instance.handle.close();
      log.info(`Bridge closed: ${key}`);
    }
    bridges.clear();
  }

  /**
   * 初始化定期清理任务
   */
  static startCleanupTask(intervalMs: number = 60 * 1000, idleTimeoutMs: number = 10 * 60 * 1000): void {
    setInterval(() => {
      this.cleanupIdleBridges(idleTimeoutMs);
    }, intervalMs).unref();

    log.info(`Bridge cleanup task started: interval=${intervalMs}ms, idleTimeout=${idleTimeoutMs}ms`);
  }
}
