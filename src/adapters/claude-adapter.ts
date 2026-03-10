import { runClaude } from '../claude/cli-runner.js';
import { ClaudeProcessPool } from '../claude/process-pool.js';
import type { ToolAdapter, RunCallbacks, RunOptions, RunHandle } from './tool-adapter.interface.js';

// Global process pool instance
let processPool: ClaudeProcessPool | null = null;

export class ClaudeAdapter implements ToolAdapter {
  readonly toolId = 'claude';

  constructor(
    private cliPath: string,
    adapterOptions?: { useProcessPool?: boolean; idleTimeoutMs?: number }
  ) {
    const useProcessPool = adapterOptions?.useProcessPool ?? true;
    const idleTimeoutMs = adapterOptions?.idleTimeoutMs ?? 2 * 60 * 1000; // 2 minutes default

    if (useProcessPool && !processPool) {
      // Initialize process pool with configurable idle timeout
      processPool = new ClaudeProcessPool(idleTimeoutMs);
    }
  }

  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions
  ): RunHandle {
    const opts = {
      skipPermissions: options?.skipPermissions,
      permissionMode: options?.permissionMode,
      timeoutMs: options?.timeoutMs,
      model: options?.model,
      chatId: options?.chatId,
      hookPort: options?.hookPort,
    };

    // Use process pool if enabled and userId is available
    if (processPool && opts.chatId) {
      let aborted = false;

      // Execute using process pool with userId from chatId
      processPool
        .execute(opts.chatId, sessionId, this.cliPath, prompt, workDir, callbacks, opts)
        .catch((err) => {
          if (!aborted && callbacks.onError) {
            callbacks.onError(err.message);
          }
        });

      return {
        abort: () => {
          aborted = true;
          processPool!.terminate(opts.chatId!, sessionId);
        },
      };
    }

    // Fall back to original implementation
    return runClaude(this.cliPath, prompt, sessionId, workDir, callbacks, opts);
  }

  /**
   * Get the number of cached entries in the pool.
   */
  static getCacheSize(): number {
    return processPool?.size() ?? 0;
  }

  /**
   * Get the number of active processes in the pool.
   */
  static getActiveProcessCount(): number {
    return processPool?.activeCount() ?? 0;
  }

  /**
   * Terminate all cached entries and processes.
   */
  static terminateAll(): void {
    if (processPool) {
      processPool.terminateAll();
    }
  }

  /**
   * Destroy the process pool and cleanup resources.
   */
  static destroy(): void {
    if (processPool) {
      processPool.destroy();
      processPool = null;
    }
  }
}
