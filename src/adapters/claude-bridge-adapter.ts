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
    let existing = bridges.get(bridgeKey);
    if (existing) {
      log.info(`Reusing existing bridge: ${bridgeKey}`);
      existing.lastUsed = Date.now();
      const handle = this.createHandleForExistingBridge(existing.handle, callbacks, prompt);
      return handle;
    }

    // 创建新桥梁
    log.info(`Creating new bridge: ${bridgeKey}`);
    const bridgeHandle = createBridge(
      {
        onText: callbacks.onText,
        onThinking: callbacks.onThinking || (() => {}),
        onToolUse: callbacks.onToolUse,
        onComplete: callbacks.onComplete,
        onError: callbacks.onError,
        onSessionId: callbacks.onSessionId,
      },
      {
        cliPath: this.cliPath,
        workDir,
        model: options?.model,
        timeoutMs: options?.timeoutMs,
      }
    );

    // 存储桥梁
    bridges.set(bridgeKey, {
      handle: bridgeHandle,
      lastUsed: Date.now(),
    });

    // 发送初始 prompt
    bridgeHandle.sendInput(prompt);

    // 返回句柄
    return {
      abort: bridgeHandle.abort,
      // @ts-ignore - 扩展句柄以支持 sendInput
      sendInput: bridgeHandle.sendInput,
    } as BridgeAdapterHandle;
  }

  /**
   * 为现有桥梁创建句柄
   */
  private createHandleForExistingBridge(
    bridgeHandle: BridgeHandle,
    callbacks: RunCallbacks,
    prompt: string
  ): BridgeAdapterHandle {
    // 发送 prompt
    bridgeHandle.sendInput(prompt);

    // 注意：这里简化处理，实际上需要重新绑定回调
    // 在完整的实现中，桥梁应该支持注册回调

    return {
      abort: bridgeHandle.abort,
      sendInput: bridgeHandle.sendInput,
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
  static cleanupIdleBridges(idleTimeoutMs: number = 2 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, instance] of bridges.entries()) {
      if (now - instance.lastUsed > idleTimeoutMs) {
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
      instance.handle.close();
      log.info(`Bridge closed: ${key}`);
    }
    bridges.clear();
  }

  /**
   * 初始化定期清理任务
   */
  static startCleanupTask(intervalMs: number = 60 * 1000, idleTimeoutMs: number = 2 * 60 * 1000): void {
    setInterval(() => {
      this.cleanupIdleBridges(idleTimeoutMs);
    }, intervalMs).unref();

    log.info(`Bridge cleanup task started: interval=${intervalMs}ms, idleTimeout=${idleTimeoutMs}ms`);
  }
}
