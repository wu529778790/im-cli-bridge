/**
 * AI CLI 进程池管理器
 * 管理多个 AI CLI Worker，提供进程复用和资源控制
 */

import { v4 as uuidv4 } from 'uuid';
import { AICliWorker, WorkerConfig } from './ai-cli-worker';
import { ExecutionResult, ExecutionOptions } from '../../interfaces/command-executor';
import { Logger } from '../../utils/logger';

export interface PoolConfig {
  /** 每个 Worker 的最大空闲时间（毫秒） */
  maxWorkerIdleTime?: number;
  /** 每个 Worker 的最大执行次数 */
  maxWorkerExecutions?: number;
  /** 每个 Pool 的最大 Worker 数量 */
  maxWorkersPerPool?: number;
  /** 每个 Pool 的最小 Worker 数量 */
  minWorkersPerPool?: number;
  /** Worker 回收检查间隔（毫秒） */
  reapInterval?: number;
}

/**
 * 进程池
 */
interface WorkerPool {
  poolId: string;
  userId: string;
  command: string;
  workers: AICliWorker[];
  queue: Array<{
    resolve: (value: ExecutionResult) => void;
    reject: (reason?: any) => void;
    command: string;
    args: string[];
    options?: ExecutionOptions;
  }>;
}

/**
 * AI CLI 进程池管理器
 * 为每个用户+命令组合维护独立的进程池
 */
export class AICliPoolManager {
  private pools: Map<string, WorkerPool> = new Map();
  private logger: Logger;
  private config: Required<PoolConfig>;
  private reapTimer: NodeJS.Timeout | null = null;
  private stats: {
    totalExecutions: number;
    totalWorkersCreated: number;
    totalWorkersReaped: number;
  } = {
    totalExecutions: 0,
    totalWorkersCreated: 0,
    totalWorkersReaped: 0
  };

  constructor(config: PoolConfig = {}) {
    this.logger = new Logger('AICliPoolManager');
    this.config = {
      maxWorkerIdleTime: config.maxWorkerIdleTime || 5 * 60 * 1000, // 5分钟
      maxWorkerExecutions: config.maxWorkerExecutions || 100,
      maxWorkersPerPool: config.maxWorkersPerPool || 3,
      minWorkersPerPool: config.minWorkersPerPool || 0,
      reapInterval: config.reapInterval || 60 * 1000 // 1分钟
    };

    // 启动回收定时器
    this.startReapTimer();
  }

  /**
   * 执行命令
   * @param userId 用户ID
   * @param command AI CLI 命令
   * @param args 命令参数
   * @param options 执行选项
   */
  async execute(
    userId: string,
    command: string,
    args: string[],
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    this.stats.totalExecutions++;

    const poolKey = this.getPoolKey(userId, command);
    let pool = this.pools.get(poolKey);

    // 创建新池（如果不存在）
    if (!pool) {
      pool = this.createPool(userId, command);
      this.pools.set(poolKey, pool);
    }

    // 获取空闲 worker 或排队等待
    const idleWorker = pool.workers.find(w => w.getStatus().state === 'idle');

    if (idleWorker) {
      this.logger.debug(`Using idle worker for ${command} (${userId})`);
      try {
        const result = await idleWorker.execute(command, args, options);
        // 执行完成后释放 worker 以处理队列中的任务
        this.releaseWorker(pool, idleWorker);
        return result;
      } catch (error) {
        // 执行失败，移除该 worker
        this.removeWorker(pool, idleWorker);
        throw error;
      }
    }

    // 检查是否可以创建新 worker
    if (pool.workers.length < this.config.maxWorkersPerPool) {
      const newWorker = this.createWorker(command, options);
      pool.workers.push(newWorker);
      this.logger.debug(`Created new worker for ${command} (${userId}), total: ${pool.workers.length}`);
      try {
        const result = await newWorker.execute(command, args, options);
        // 执行完成后释放 worker 以处理队列中的任务
        this.releaseWorker(pool, newWorker);
        return result;
      } catch (error) {
        this.removeWorker(pool, newWorker);
        throw error;
      }
    }

    // 排队等待
    this.logger.debug(`No idle worker, queuing for ${command} (${userId})`);
    return new Promise((resolve, reject) => {
      pool!.queue.push({ resolve, reject, command, args, options });
    });
  }

  /**
   * 释放 worker 并处理队列
   */
  private releaseWorker(pool: WorkerPool, worker: AICliWorker): void {
    // 处理队列中的任务
    if (pool.queue.length > 0) {
      const task = pool.queue.shift()!;
      this.logger.debug(`Processing queued task for ${task.command}`);
      worker.execute(task.command, task.args, task.options)
        .then((result) => {
          // 任务完成后再次释放 worker 以处理下一个队列任务
          this.releaseWorker(pool, worker);
          task.resolve(result);
        })
        .catch((error) => {
          // 任务失败，移除该 worker
          this.removeWorker(pool, worker);
          task.reject(error);
        });
    }
  }

  /**
   * 创建新进程池
   */
  private createPool(userId: string, command: string): WorkerPool {
    const pool: WorkerPool = {
      poolId: uuidv4(),
      userId,
      command,
      workers: [],
      queue: []
    };

    // 预创建最小数量的 worker
    for (let i = 0; i < this.config.minWorkersPerPool; i++) {
      const worker = this.createWorker(command);
      pool.workers.push(worker);
    }

    this.logger.info(`Created new pool for ${command} (${userId}) with ${pool.workers.length} workers`);
    return pool;
  }

  /**
   * 创建新 worker
   */
  private createWorker(command: string, options?: ExecutionOptions): AICliWorker {
    const workerId = uuidv4().slice(0, 8);
    const config: WorkerConfig = {
      command,
      cwd: options?.cwd,
      env: options?.env,
      maxIdleTime: this.config.maxWorkerIdleTime,
      maxExecutions: this.config.maxWorkerExecutions
    };

    this.stats.totalWorkersCreated++;
    return new AICliWorker(config, workerId);
  }

  /**
   * 移除 worker
   */
  private removeWorker(pool: WorkerPool, worker: AICliWorker): void {
    const index = pool.workers.indexOf(worker);
    if (index !== -1) {
      pool.workers.splice(index, 1);
      worker.terminate();
      this.stats.totalWorkersReaped++;
      this.logger.debug(`Removed worker from pool ${pool.poolId}`);
    }
  }

  /**
   * 获取进程池的 key
   */
  private getPoolKey(userId: string, command: string): string {
    return `${userId}:${command}`;
  }

  /**
   * 启动回收定时器
   */
  private startReapTimer(): void {
    this.reapTimer = setInterval(() => {
      this.reapIdleWorkers();
    }, this.config.reapInterval);

    this.logger.info(`Started worker reap timer (interval: ${this.config.reapInterval}ms)`);
  }

  /**
   * 回收空闲的 worker
   */
  private reapIdleWorkers(): void {
    const before = this.getTotalWorkerCount();

    for (const [key, pool] of this.pools.entries()) {
      // 找出应该被回收的 worker
      const toReap = pool.workers.filter(w => w.shouldReap());

      for (const worker of toReap) {
        this.removeWorker(pool, worker);
      }

      // 如果池为空且没有排队的任务，删除池
      if (pool.workers.length === 0 && pool.queue.length === 0) {
        this.pools.delete(key);
        this.logger.debug(`Removed empty pool ${pool.poolId}`);
      }
    }

    const after = this.getTotalWorkerCount();
    if (before !== after) {
      this.logger.debug(`Reaped workers: ${before} -> ${after}`);
    }
  }

  /**
   * 获取总 worker 数量
   */
  private getTotalWorkerCount(): number {
    let count = 0;
    for (const pool of this.pools.values()) {
      count += pool.workers.length;
    }
    return count;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalPools: number;
    totalWorkers: number;
    totalQueued: number;
    totalExecutions: number;
    totalWorkersCreated: number;
    totalWorkersReaped: number;
  } {
    let totalWorkers = 0;
    let totalQueued = 0;

    for (const pool of this.pools.values()) {
      totalWorkers += pool.workers.length;
      totalQueued += pool.queue.length;
    }

    return {
      totalPools: this.pools.size,
      totalWorkers,
      totalQueued,
      totalExecutions: this.stats.totalExecutions,
      totalWorkersCreated: this.stats.totalWorkersCreated,
      totalWorkersReaped: this.stats.totalWorkersReaped
    };
  }

  /**
   * 清理所有进程池
   */
  shutdown(): void {
    this.logger.info('Shutting down pool manager...');

    if (this.reapTimer) {
      clearInterval(this.reapTimer);
      this.reapTimer = null;
    }

    // 终止所有 worker
    for (const pool of this.pools.values()) {
      for (const worker of pool.workers) {
        worker.terminate();
      }
      // 拒绝所有等待中的任务
      for (const task of pool.queue) {
        task.reject(new Error('Pool manager shutdown'));
      }
    }

    const poolCount = this.pools.size;
    this.pools.clear();

    this.logger.info(`Pool manager shutdown complete (cleaned up ${poolCount} pools)`);
  }

  /**
   * 获取指定用户的进程池状态
   */
  getUserPoolStatus(userId: string): Array<{
    command: string;
    workers: number;
    queued: number;
  }> {
    const status: Array<{ command: string; workers: number; queued: number }> = [];

    for (const pool of this.pools.values()) {
      if (pool.userId === userId) {
        status.push({
          command: pool.command,
          workers: pool.workers.length,
          queued: pool.queue.length
        });
      }
    }

    return status;
  }
}

export default AICliPoolManager;
