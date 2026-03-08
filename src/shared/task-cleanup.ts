import type { TaskRunState } from './ai-task.js';
import { createLogger } from '../logger.js';

const log = createLogger('TaskCleanup');
const TASK_TIMEOUT_MS = 30 * 60 * 1000;
const INTERVAL_MS = 10 * 60 * 1000;

export function startTaskCleanup(runningTasks: Map<string, TaskRunState>): () => void {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, task] of runningTasks) {
      if (now - task.startedAt > TASK_TIMEOUT_MS) {
        log.warn(`Auto-cleaning timeout task: ${key}`);
        task.settle();
        task.handle.abort();
        runningTasks.delete(key);
      }
    }
  }, INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
