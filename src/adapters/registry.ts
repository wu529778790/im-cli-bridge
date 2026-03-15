import { getConfiguredAiCommands, type Config } from '../config.js';
import type { ToolAdapter } from './tool-adapter.interface.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { ClaudeSDKAdapter } from './claude-sdk-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { CodeBuddyAdapter } from './codebuddy-adapter.js';
import { createLogger } from '../logger.js';

const log = createLogger('Registry');
const adapters = new Map<string, ToolAdapter>();

export function initAdapters(config: Config): void {
  adapters.clear();
  for (const aiCommand of getConfiguredAiCommands(config)) {
    if (aiCommand === 'claude') {
      if (config.useSdkMode) {
        log.info('Claude Agent SDK adapter enabled');
        adapters.set('claude', new ClaudeSDKAdapter());
      } else {
        log.info('Claude CLI adapter enabled');
        adapters.set('claude', new ClaudeAdapter(config.claudeCliPath, {
          useProcessPool: true,
          idleTimeoutMs: 2 * 60 * 1000,
        }));
      }
      continue;
    }

    if (aiCommand === 'codex') {
      log.info('Codex CLI adapter enabled');
      adapters.set('codex', new CodexAdapter(config.codexCliPath));
      continue;
    }

    if (aiCommand === 'codebuddy') {
      log.info('CodeBuddy CLI adapter enabled');
      adapters.set('codebuddy', new CodeBuddyAdapter(config.codebuddyCliPath));
    }
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
