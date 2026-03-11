/**
 * ToolAdapter 接口 - 多 AI CLI 统一抽象
 */

export interface ParsedResult {
  success: boolean;
  result: string;
  accumulated: string;
  cost: number;
  durationMs: number;
  model?: string;
  numTurns: number;
  toolStats: Record<string, number>;
}

export interface RunCallbacks {
  onText: (accumulated: string) => void;
  onThinking?: (accumulated: string) => void;
  onToolUse?: (toolName: string, toolInput?: Record<string, unknown>) => void;
  onComplete: (result: ParsedResult) => void;
  onError: (error: string) => void;
  onSessionId?: (sessionId: string) => void;
  /** SDK 报 "No conversation found" 时调用，用于清除无效 session */
  onSessionInvalid?: () => void;
}

export interface RunOptions {
  skipPermissions?: boolean;
  /** Claude --permission-mode: default | acceptEdits | plan（yolo 时用 skipPermissions） */
  permissionMode?: 'default' | 'acceptEdits' | 'plan';
  timeoutMs?: number;
  model?: string;
  chatId?: string;
  hookPort?: number;
}

export interface RunHandle {
  abort: () => void;
}

export interface ToolAdapter {
  readonly toolId: string;
  run(
    prompt: string,
    sessionId: string | undefined,
    workDir: string,
    callbacks: RunCallbacks,
    options?: RunOptions
  ): RunHandle;
}
