import type { Config } from '../config.js';
import type { ToolAdapter } from './tool-adapter.interface.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { ClaudeSDKAdapter } from './claude-sdk-adapter.js';
import { CursorAdapter } from './cursor-adapter.js';
import { CodexAdapter } from './codex-adapter.js';

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
        idleTimeoutMs: 2 * 60 * 1000,
      }));
    }
  } else if (config.aiCommand === 'cursor') {
    console.log('🖱️ 使用 Cursor Agent CLI 适配器');
    adapters.set('cursor', new CursorAdapter(config.cursorCliPath));
  } else if (config.aiCommand === 'codex') {
    console.log('📦 使用 Codex CLI 适配器');
    adapters.set('codex', new CodexAdapter(config.codexCliPath));
  }
}

export function getAdapter(aiCommand: string): ToolAdapter | undefined {
  return adapters.get(aiCommand);
}

export function cleanupAdapters(): void {
  ClaudeAdapter.destroy();
  ClaudeSDKAdapter.destroy();
  adapters.clear();
}
