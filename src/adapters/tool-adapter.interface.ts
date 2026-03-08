/**
 * 工具适配器接口
 */

export interface SessionHandle {
  windowId: string;
  sessionId: string;
  workDir: string;
}

export interface ToolAdapter {
  readonly toolId: 'claude' | 'codex';
  createSession(workDir: string, resumeId?: string): Promise<SessionHandle | null>;
  sendInput(handle: SessionHandle, text: string): Promise<void>;
  killSession(handle: SessionHandle): Promise<void>;
}
