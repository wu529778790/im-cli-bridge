import { runClaude } from '../claude/cli-runner.js';
import type { ToolAdapter, RunCallbacks, RunOptions, RunHandle } from './tool-adapter.interface.js';

export class ClaudeAdapter implements ToolAdapter {
  readonly toolId = 'claude';

  constructor(private cliPath: string) {}

  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions
  ): RunHandle {
    return runClaude(this.cliPath, prompt, sessionId, workDir, callbacks, {
      skipPermissions: options?.skipPermissions,
      timeoutMs: options?.timeoutMs,
      model: options?.model,
      chatId: options?.chatId,
      hookPort: options?.hookPort,
    });
  }
}
