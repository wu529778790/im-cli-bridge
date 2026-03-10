import type { Config } from '../config.js';
import type { ToolAdapter } from './tool-adapter.interface.js';
import { ClaudeAdapter } from './claude-adapter.js';

const adapters = new Map<string, ToolAdapter>();

export function initAdapters(config: Config): void {
  adapters.clear();
  if (config.aiCommand === 'claude') {
    // Enable process pool with 2 minute idle timeout
    adapters.set('claude', new ClaudeAdapter(config.claudeCliPath, {
      useProcessPool: true,
      idleTimeoutMs: 2 * 60 * 1000, // 2 minutes
    }));
  }
}

export function getAdapter(aiCommand: string): ToolAdapter | undefined {
  return adapters.get(aiCommand);
}

/**
 * Cleanup all adapter resources.
 */
export function cleanupAdapters(): void {
  ClaudeAdapter.destroy();
  adapters.clear();
}
