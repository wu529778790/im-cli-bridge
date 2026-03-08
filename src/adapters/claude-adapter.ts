/**
 * Claude Code 适配器 - tmux + JSONL
 */

import * as path from 'path';
import { Logger } from '../utils/logger';
import { TmuxManager } from '../tmux/tmux-manager';
import { SessionMonitor } from '../monitors/session-monitor';
import type { ToolAdapter, SessionHandle } from './tool-adapter.interface';
import type { NewMessage } from '../monitors/session-monitor';

export class ClaudeAdapter implements ToolAdapter {
  readonly toolId = 'claude' as const;
  private tmux: TmuxManager;
  private monitor: SessionMonitor;
  private logger: Logger;
  private onNewMessage: ((msg: NewMessage) => void | Promise<void>) | null = null;

  constructor(options?: {
    sessionName?: string;
    pollIntervalSec?: number;
  }) {
    this.tmux = new TmuxManager(options?.sessionName);
    this.logger = new Logger('ClaudeAdapter');
    this.monitor = new SessionMonitor({
      sessionName: options?.sessionName,
      pollIntervalSec: options?.pollIntervalSec,
      listWindows: () => this.tmux.listWindows().then((ws) => ws.map((w) => ({ windowId: w.windowId, cwd: w.cwd })))
    });
    this.monitor.setMessageCallback((msg) => this.onNewMessage?.(msg));
  }

  setOnNewMessage(cb: (msg: NewMessage) => void | Promise<void>): void {
    this.onNewMessage = cb;
  }

  startMonitor(): void {
    this.monitor.start();
  }

  stopMonitor(): void {
    this.monitor.stop();
  }

  async createSession(workDir: string, resumeId?: string): Promise<SessionHandle | null> {
    const dir = workDir.startsWith('~')
      ? path.join(process.env.HOME || '', workDir.slice(1))
      : path.resolve(workDir);

    const result = await this.tmux.createWindow(dir, undefined, true, resumeId);
    if (!result.success || !result.windowId) {
      this.logger.error('createSession failed', result.message);
      return null;
    }

    return {
      windowId: result.windowId,
      sessionId: '',
      workDir: dir
    };
  }

  async sendInput(handle: SessionHandle, text: string): Promise<void> {
    await this.tmux.sendKeys(handle.windowId, text, { enter: true, literal: true });
  }

  async killSession(handle: SessionHandle): Promise<void> {
    await this.tmux.killWindow(handle.windowId);
  }

  async listWindows(): Promise<Array<{ windowId: string; cwd: string }>> {
    const ws = await this.tmux.listWindows();
    return ws.map((w) => ({ windowId: w.windowId, cwd: w.cwd }));
  }
}
