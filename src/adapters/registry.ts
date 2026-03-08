import type { Config } from '../config.js';
import type { ToolAdapter } from './tool-adapter.interface.js';
import { ClaudeAdapter } from './claude-adapter.js';

const adapters = new Map<string, ToolAdapter>();

export function initAdapters(config: Config): void {
  adapters.clear();
  if (config.aiCommand === 'claude') {
    adapters.set('claude', new ClaudeAdapter(config.claudeCliPath));
  }
}

export function getAdapter(aiCommand: string): ToolAdapter | undefined {
  return adapters.get(aiCommand);
}
