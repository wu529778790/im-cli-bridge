import type { Config } from '../config.js';
import type { ToolAdapter } from './tool-adapter.interface.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { ClaudeSDKAdapter } from './claude-sdk-adapter.js';

const adapters = new Map<string, ToolAdapter>();

export function initAdapters(config: Config): void {
  adapters.clear();
  if (config.aiCommand === 'claude') {
    if (config.useSdkMode) {
      console.log('⚡ 启用 Claude Agent SDK 模式 - 进程内执行，响应更快');
      adapters.set('claude', new ClaudeSDKAdapter());
    } else {
      console.log('🚀 使用标准 Claude 适配器');
      adapters.set('claude', new ClaudeAdapter(config.claudeCliPath, {
        useProcessPool: true,
        idleTimeoutMs: 2 * 60 * 1000, // 2 minutes
      }));
    }
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
