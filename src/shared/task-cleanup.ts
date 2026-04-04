/**
 * Periodic cleanup of stale running tasks.
 *
 * Tasks older than 30 minutes are aborted and removed from the running-tasks
 * map so they never accumulate indefinitely.
 */

import type { TaskRunState } from './ai-task.js';
import { createLogger } from '../logger.js';

const log = createLogger('TaskCleanup');

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export function startTaskCleanup(runningTasks: Map<string, TaskRunState>): () => void {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, state] of runningTasks) {
      if (now - state.startedAt >= STALE_THRESHOLD_MS) {
        log.warn(`Aborting stale task (forced cleanup): ${key} (age: ${Math.round((now - state.startedAt) / 1000)}s)`);
        try {
          state.handle.abort();
        } catch (err) {
          log.error(`Failed to abort stale task ${key}:`, err);
        }
        runningTasks.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Don't prevent the process from exiting
  timer.unref();

  return () => clearInterval(timer);
}
