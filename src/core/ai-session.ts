/**
 * 单用户 AI 常驻进程会话
 * 保持一个 claude 进程，通过 stdin 持续输入，stdout 持续输出
 * 若 CLI 需要 TTY 才能交互，此模式可能不工作，可设置 AI_SESSION_MODE=false 退回逐条 -p
 */

import { spawn, ChildProcess } from 'child_process';
import { Logger } from '../utils/logger';

const IDLE_TIMEOUT_MS = 3000; // 无输出超过此时长视为本次回复结束
const MAX_TURN_MS = 120000;   // 单次对话最大时长 2 分钟

export interface SessionOptions {
  command: string;
  /** 启动参数，如 ['--dangerously-skip-permissions']，不要含 -p */
  baseArgs?: string[];
  onOutput: (text: string) => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

function buildShellCommand(command: string, args: string[]): string {
  const escaped = args.map((a) =>
    a.startsWith('-') && /^[\w-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`
  );
  return [command, ...escaped].join(' ');
}

export class AISession {
  private process: ChildProcess | null = null;
  private logger: Logger;
  private options: SessionOptions;
  private idleTimer: NodeJS.Timeout | null = null;
  private turnTimer: NodeJS.Timeout | null = null;
  private isReady = false;
  private pendingMessages: string[] = [];

  constructor(options: SessionOptions) {
    this.options = options;
    this.logger = new Logger('AISession');
  }

  /**
   * 发送消息到 stdin
   */
  send(message: string): void {
    if (!this.process?.stdin?.writable) {
      this.pendingMessages.push(message);
      this.start();
      return;
    }

    if (!this.isReady) {
      this.pendingMessages.push(message);
      return;
    }

    this.writeAndResetTimers(message);
  }

  /**
   * 启动进程（交互模式，无 -p）
   */
  start(): void {
    if (this.process) return;

    const { command, baseArgs = [], onOutput, onEnd, onError } = this.options;
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    const shellCmd = buildShellCommand(command, baseArgs);

    this.logger.info(`Starting AI session: ${shellCmd}`);

    const child = spawn(shellCmd, [], {
      cwd: process.cwd(),
      env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process = child;

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      onOutput(text);
      this.scheduleIdleEnd();
      this.resetTurnTimer();
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      onOutput(text);
      this.scheduleIdleEnd();
      this.resetTurnTimer();
    });

    child.on('close', (code) => {
      this.logger.info(`AI session closed, code=${code}`);
      this.process = null;
      this.isReady = false;
      this.clearTimers();
      onEnd?.();
    });

    child.on('error', (err) => {
      this.logger.error('AI session error', err);
      onError?.(err);
    });

    // 短暂延迟后认为可以输入
    setTimeout(() => {
      this.isReady = true;
      this.drainPending();
    }, 500);
  }

  /**
   * 关闭会话
   */
  stop(): void {
    this.clearTimers();
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.isReady = false;
    this.pendingMessages = [];
  }

  private writeAndResetTimers(message: string): void {
    if (!this.process?.stdin?.writable) return;

    this.clearTimers();
    this.process.stdin.write(message + '\n');
    this.resetTurnTimer();
  }

  private scheduleIdleEnd(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.clearIdleTimer();
      this.isReady = true;
      this.drainPending();
      this.options.onEnd?.();
    }, IDLE_TIMEOUT_MS);
  }

  private resetTurnTimer(): void {
    this.clearTurnTimer();
    this.turnTimer = setTimeout(() => {
      this.logger.warn('Turn timeout');
      this.clearTurnTimer();
      this.isReady = true;
      this.drainPending();
      this.options.onEnd?.();
    }, MAX_TURN_MS);
  }

  private drainPending(): void {
    while (this.pendingMessages.length > 0 && this.isReady) {
      const msg = this.pendingMessages.shift();
      if (msg) this.writeAndResetTimers(msg);
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearIdleTimer();
    this.clearTurnTimer();
  }
}
