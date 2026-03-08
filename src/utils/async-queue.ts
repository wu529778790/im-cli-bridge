import { logger } from './logger';

interface QueueTask<T> {
  name: string;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

export class AsyncQueue {
  private queue: QueueTask<any>[] = [];
  private processing = false;
  private concurrency: number;
  private activeCount = 0;

  constructor(concurrency: number = 1) {
    this.concurrency = concurrency;
  }

  async add<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ name, fn, resolve, reject });
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.processing || this.activeCount >= this.concurrency) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 && this.activeCount < this.concurrency) {
      const task = this.queue.shift();
      if (!task) break;

      this.activeCount++;
      this.executeTask(task);
    }

    this.processing = false;
  }

  private async executeTask<T>(task: QueueTask<T>): Promise<void> {
    const { name, fn, resolve, reject } = task;

    try {
      logger.debug(`Executing task: ${name}`);
      const result = await fn();
      resolve(result);
      logger.debug(`Task completed: ${name}`);
    } catch (error) {
      logger.error(`Task failed: ${name}`, error);
      reject(error);
    } finally {
      this.activeCount--;
      this.process();
    }
  }

  get size(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.activeCount;
  }

  clear(): void {
    this.queue = [];
  }
}

export default AsyncQueue;
