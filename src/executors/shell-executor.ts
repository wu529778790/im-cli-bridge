import { spawn, ChildProcess } from 'child_process';
import { BaseExecutor } from './base-executor';
import {
  ExecutionResult,
  ExecutionOptions,
  StreamExecutionOptions
} from '../interfaces/command-executor';

/**
 * Shell command executor using child_process.spawn
 * Supports streaming output, timeout control, and custom environment
 */
export class ShellExecutor extends BaseExecutor {
  private activeChildren: Set<ChildProcess> = new Set();

  constructor() {
    super('ShellExecutor');
  }

  /**
   * 关闭时杀掉所有后台子进程
   */
  killAll(): void {
    for (const child of this.activeChildren) {
      try {
        if (child.pid && child.exitCode === null) {
          child.kill('SIGTERM');
          this.logger.debug(`Killed child process ${child.pid}`);
        }
      } catch (e) {
        this.logger.debug('Error killing child:', e);
      }
    }
    this.activeChildren.clear();
  }

  /**
   * Validate if shell is available
   */
  async validate(): Promise<boolean> {
    try {
      // Try to execute a simple echo command
      const result = await this.execute('echo', ['test'], { timeout: 5000 });
      return result.exitCode === 0;
    } catch (error) {
      this.logger.error('Shell validation failed', error);
      return false;
    }
  }

  /**
   * Execute a command and return the result
   */
  async execute(
    command: string,
    args: string[],
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const cwd = options?.cwd || process.cwd();
    const env = this.buildEnvironment(options?.env);
    const timeout = options?.timeout;

    this.logger.info(`Executing: ${this.formatCommand(command, args)}`);
    this.logger.debug(`Working directory: ${cwd}`);

    try {
      const result = await this.executeWithTimeout(
        this.spawnCommand(command, args, cwd, env),
        timeout,
        `Command timed out: ${command}`
      );

      const duration = Date.now() - startTime;
      this.logger.info(`Command completed in ${duration}ms with exit code ${result.exitCode}`);

      return {
        ...result,
        duration,
        timedOut: false
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof Error && error.message.includes('Timeout')) {
        this.logger.warn(`Command timed out after ${duration}ms`);
        return {
          exitCode: -1,
          stdout: '',
          stderr: `Command timed out after ${timeout}ms`,
          timedOut: true,
          duration
        };
      }

      this.logger.error('Command execution failed', error);
      throw error;
    }
  }

  /**
   * Execute a command with streaming output.
   * 超时时会 kill 子进程并返回已收集的 stdout/stderr。
   */
  async executeStream(
    command: string,
    args: string[],
    options?: StreamExecutionOptions
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const cwd = options?.cwd || process.cwd();
    const env = this.buildEnvironment(options?.env);
    const timeout = options?.timeout;

    this.logger.info(`Executing (stream): ${this.formatCommand(command, args)}`);

    const result = await this.spawnCommandStream(command, args, cwd, env, options, timeout);
    const duration = Date.now() - startTime;

    if (result.timedOut) {
      this.logger.warn(`Stream command timed out after ${duration}ms`);
      options?.onError?.(new Error(`Command timed out after ${timeout}ms`));
    } else {
      this.logger.info(`Stream command completed in ${duration}ms, exit code ${result.exitCode}`);
    }

    return { ...result, duration };
  }

  /**
   * 构建带引号的 shell 命令字符串，避免 DEP0190 警告并正确传递中文等参数
   */
  private buildShellCommand(command: string, args: string[]): string {
    const escapedArgs = args.map((arg) => {
      if (arg.startsWith('-') && /^[\w-]+$/.test(arg)) return arg;
      const escaped = arg.replace(/"/g, process.platform === 'win32' ? '""' : '\\"');
      return `"${escaped}"`;
    });
    return [command, ...escapedArgs].join(' ');
  }

  /**
   * Spawn a command and collect output
   */
  private spawnCommand(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>
  ): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let exitCode = 0;
      const shellCommand = this.buildShellCommand(command, args);

      const childProcess = spawn(shellCommand, [], {
        cwd,
        env,
        shell: true, // Windows 需要 shell 才能解析 PATH 和 .cmd
        stdio: ['pipe', 'pipe', 'pipe']
      });
      this.activeChildren.add(childProcess);

      // Collect stdout
      childProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        stdout += text;
        this.logger.debug(`STDOUT: ${text.trim()}`);
      });

      // Collect stderr
      childProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        stderr += text;
        this.logger.debug(`STDERR: ${text.trim()}`);
      });

      childProcess.on('close', (code: number | null) => {
        this.activeChildren.delete(childProcess);
        exitCode = code ?? 0;
        this.logger.debug(`Process closed with exit code: ${exitCode}`);
        resolve({ exitCode, stdout, stderr, timedOut: false, duration: 0 });
      });

      // Handle process error
      childProcess.on('error', (error: Error) => {
        this.logger.error('Process error', error);
        reject(error);
      });
    });
  }

  /**
   * Spawn a command with streaming callbacks.
   * 超时时 kill 子进程，resolve 时返回已收集的 stdout/stderr。
   */
  private spawnCommandStream(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    options?: StreamExecutionOptions,
    timeoutMs?: number
  ): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let exitCode = 0;
      let timedOut = false;
      let resolved = false;

      const shellCommand = this.buildShellCommand(command, args);
      const childProcess = spawn(shellCommand, [], {
        cwd,
        env,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      this.activeChildren.add(childProcess);

      const finish = (code: number) => {
        if (resolved) return;
        resolved = true;
        resolve({
          exitCode: code,
          stdout,
          stderr: timedOut ? stderr + `\n\n⏱ 已超时 (${timeoutMs}ms)` : stderr,
          timedOut,
          duration: 0
        });
      };

      let timeoutId: NodeJS.Timeout | undefined;
      if (timeoutMs && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          if (resolved) return;
          timedOut = true;
          childProcess.kill('SIGTERM');
          setTimeout(() => childProcess.kill('SIGKILL'), 2000);
        }, timeoutMs);
      }

      childProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        stdout += text;
        options?.onText?.(text);
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        stderr += text;
        options?.onText?.(text);
      });

      childProcess.on('close', (code: number | null) => {
        this.activeChildren.delete(childProcess);
        if (timeoutId) clearTimeout(timeoutId);
        exitCode = code ?? 0;
        finish(exitCode);
      });

      childProcess.on('error', (error: Error) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.logger.error('Stream process error', error);
        options?.onError?.(error);
        reject(error);
      });
    });
  }
}
