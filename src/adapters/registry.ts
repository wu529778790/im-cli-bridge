import type { Config } from '../config.js';
import type { ToolAdapter } from './tool-adapter.interface.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { ClaudeBridgeAdapter } from './claude-bridge-adapter.js';

const adapters = new Map<string, ToolAdapter>();

export function initAdapters(config: Config): void {
  adapters.clear();
  if (config.aiCommand === 'claude') {
    // 根据配置选择使用桥梁模式还是普通模式
    if (config.useBridgeMode) {
      console.log('🌉 启用 Claude 桥梁模式 - 持久化进程，原生权限体验');
      adapters.set('claude', new ClaudeBridgeAdapter(config.claudeCliPath, {
        bridgeIdleTimeoutMs: 10 * 60 * 1000, // 10 minutes for bridge
      }));
      // 启动定期清理任务
      ClaudeBridgeAdapter.startCleanupTask(60 * 1000, 10 * 60 * 1000);
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
 * 获取桥梁模式适配器（如果启用）
 */
export function getBridgeAdapter(): typeof ClaudeBridgeAdapter | undefined {
  const adapter = adapters.get('claude');
  if (adapter && adapter.toolId === 'claude-bridge') {
    return ClaudeBridgeAdapter as typeof ClaudeBridgeAdapter;
  }
  return undefined;
}

/**
 * Cleanup all adapter resources.
 */
export function cleanupAdapters(): void {
  ClaudeAdapter.destroy();
  ClaudeBridgeAdapter.closeAll();
  adapters.clear();
}
