/**
 * 用户锁管理器
 * 为每个用户提供独立的锁，确保同一用户的请求串行处理
 * 不同用户的请求可以并行处理
 */

import { AsyncLock } from './async-lock';
import { Logger } from '../../utils/logger';

export class UserLockManager {
  private locks: Map<string, AsyncLock> = new Map();
  private logger: Logger;
  private stats: {
    totalAcquisitions: number;
    totalQueued: number;
    totalLocksCreated: number;
  } = {
    totalAcquisitions: 0,
    totalQueued: 0,
    totalLocksCreated: 0
  };

  constructor() {
    this.logger = new Logger('UserLockManager');
  }

  /**
   * 获取用户锁并执行函数
   * @param userId 用户ID
   * @param fn 要执行的异步函数
   * @returns 函数执行结果
   */
  async execute<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    this.stats.totalAcquisitions++;

    let lock = this.locks.get(userId);
    if (!lock) {
      lock = new AsyncLock();
      this.locks.set(userId, lock);
      this.stats.totalLocksCreated++;
      this.logger.debug(`Created new lock for user: ${userId}`);
    }

    // 如果有任务在队列中，记录统计
    if (lock.isLocked()) {
      this.stats.totalQueued++;
      this.logger.debug(`Queued task for user: ${userId} (queue: ${lock.queueLength})`);
    }

    try {
      const result = await lock.acquire(fn);
      return result;
    } catch (error) {
      this.logger.error(`Error executing task for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * 移除用户锁
   * @param userId 用户ID
   */
  removeLock(userId: string): void {
    const lock = this.locks.get(userId);
    if (lock) {
      this.locks.delete(userId);
      this.logger.debug(`Removed lock for user: ${userId}`);
    }
  }

  /**
   * 清理所有锁
   */
  clearAll(): void {
    const count = this.locks.size;
    this.locks.clear();
    this.logger.info(`Cleared ${count} user locks`);
  }

  /**
   * 清理空闲的用户锁
   * @param maxIdleTime 最大空闲时间（毫秒）
   */
  async cleanupIdleLocks(maxIdleTime: number = 5 * 60 * 1000): Promise<void> {
    const before = this.locks.size;
    // 注意：由于 AsyncLock 没有最后使用时间跟踪，
    // 这里我们简单地移除所有锁，实际使用中可能需要增强 AsyncLock 来跟踪空闲时间
    // 如果需要精确的空闲锁清理，应该在 AsyncLock 中添加 lastUsed 时间戳
    this.logger.debug(`Lock cleanup: ${before} locks before (no idle tracking implemented)`);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    activeLocks: number;
    totalAcquisitions: number;
    totalQueued: number;
    totalLocksCreated: number;
  } {
    return {
      activeLocks: this.locks.size,
      totalAcquisitions: this.stats.totalAcquisitions,
      totalQueued: this.stats.totalQueued,
      totalLocksCreated: this.stats.totalLocksCreated
    };
  }

  /**
   * 获取用户的队列状态
   * @param userId 用户ID
   */
  getUserQueueStatus(userId: string): {
    hasLock: boolean;
    isLocked: boolean;
    queueLength: number;
  } {
    const lock = this.locks.get(userId);
    return {
      hasLock: !!lock,
      isLocked: lock?.isLocked() || false,
      queueLength: lock?.queueLength || 0
    };
  }
}

export default UserLockManager;
