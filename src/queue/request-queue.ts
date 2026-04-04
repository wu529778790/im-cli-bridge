import { createLogger } from '../logger.js';

const log = createLogger('Queue');

export class QueueTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Task timed out after ${timeoutMs / 1000}s`);
    this.name = 'QueueTimeoutError';
  }
}

interface QueuedTask {
  prompt: string;
  execute: (prompt: string, signal: AbortSignal) => Promise<void>;
  enqueuedAt: number;
}

interface UserQueue {
  running: boolean;
  tasks: QueuedTask[];
}

const MAX_QUEUE_SIZE = 3;
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export type EnqueueResult = 'running' | 'queued' | 'rejected';

export class RequestQueue {
  private queues = new Map<string, UserQueue>();

  enqueue(userId: string, convId: string, prompt: string, execute: (prompt: string, signal: AbortSignal) => Promise<void>): EnqueueResult {
    const key = `${userId}:${convId}`;
    let q = this.queues.get(key);
    if (!q) {
      q = { running: false, tasks: [] };
      this.queues.set(key, q);
    }
    if (q.running && q.tasks.length >= MAX_QUEUE_SIZE) return 'rejected';
    if (q.running) {
      q.tasks.push({ prompt, execute, enqueuedAt: Date.now() });
      log.info(`Queued task for ${key}`);
      return 'queued';
    }
    q.running = true;
    this.run(key, prompt, execute).catch(() => {});
    return 'running';
  }

  /** 清除指定用户会话的所有排队任务（不中止正在运行的任务） */
  clear(userId: string, convId: string): number {
    const key = `${userId}:${convId}`;
    const q = this.queues.get(key);
    if (!q) return 0;
    const cleared = q.tasks.length;
    q.tasks.length = 0;
    if (cleared > 0) log.info(`Cleared ${cleared} queued tasks for ${key}`);
    return cleared;
  }

  private async run(key: string, prompt: string, execute: (prompt: string, signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new QueueTimeoutError(TASK_TIMEOUT_MS));
        }, TASK_TIMEOUT_MS);
      });
      await Promise.race([execute(prompt, controller.signal), timeoutPromise]);
    } catch (err) {
      if (err instanceof QueueTimeoutError) {
        log.error(`Timeout executing task for ${key}: ${err.message}`);
      } else {
        log.error(`Error executing task for ${key}:`, err);
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      const q = this.queues.get(key);
      if (!q) return;
      const next = q.tasks.shift();
      if (next) {
        setImmediate(() => this.run(key, next.prompt, next.execute).catch(() => {}));
      } else {
        q.running = false;
        this.queues.delete(key);
      }
    }
  }
}
