import { createLogger } from '../logger.js';

const log = createLogger('Queue');

interface QueuedTask {
  prompt: string;
  execute: (prompt: string) => Promise<void>;
  enqueuedAt: number;
}

interface UserQueue {
  running: boolean;
  tasks: QueuedTask[];
}

const MAX_QUEUE_SIZE = 3;

export type EnqueueResult = 'running' | 'queued' | 'rejected';

export class RequestQueue {
  private queues = new Map<string, UserQueue>();

  enqueue(userId: string, convId: string, prompt: string, execute: (prompt: string) => Promise<void>): EnqueueResult {
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
    this.run(key, prompt, execute);
    return 'running';
  }

  private async run(key: string, prompt: string, execute: (prompt: string) => Promise<void>): Promise<void> {
    try {
      await execute(prompt);
    } catch (err) {
      log.error(`Error executing task for ${key}:`, err);
    }
    const q = this.queues.get(key);
    if (!q) return;
    const next = q.tasks.shift();
    if (next) {
      setImmediate(() => this.run(key, next.prompt, next.execute));
    } else {
      q.running = false;
      this.queues.delete(key);
    }
  }
}
