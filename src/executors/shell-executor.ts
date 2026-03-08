import { spawn, ChildProcess } from 'child_process';
import { BaseExecutor } from './base-executor';
import {
  ExecutionResult,
  ExecutionOptions,
  StreamExecutionOptions,
  ClaudeStreamEvent
} from '../interfaces/command-executor';

/**
 * Shell command executor using child_process.spawn
 * Supports streaming output, timeout control, and custom environment
 */
export class ShellExecutor extends BaseExecutor {
  constructor() {
    super('ShellExecutor');
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
   * Execute a command with streaming output
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
    this.logger.debug(`Working directory: ${cwd}`);

    try {
      const result = await this.executeWithTimeout(
        this.spawnCommandStream(command, args, cwd, env, options),
        timeout,
        `Command timed out: ${command}`
      );

      const duration = Date.now() - startTime;
      this.logger.info(`Stream command completed in ${duration}ms with exit code ${result.exitCode}`);

      return {
        ...result,
        duration,
        timedOut: false
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof Error && error.message.includes('Timeout')) {
        this.logger.warn(`Stream command timed out after ${duration}ms`);
        options?.onError?.(new Error(`Command timed out after ${timeout}ms`));
        return {
          exitCode: -1,
          stdout: '',
          stderr: `Command timed out after ${timeout}ms`,
          timedOut: true,
          duration
        };
      }

      this.logger.error('Stream command execution failed', error);
      options?.onError?.(error as Error);
      throw error;
    }
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

      // Handle process exit
      childProcess.on('close', (code: number | null) => {
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
   * Spawn a command with streaming callbacks
   */
  private spawnCommandStream(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    options?: StreamExecutionOptions
  ): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let exitCode = 0;
      let buffer = '';

      const shellCommand = this.buildShellCommand(command, args);

      const childProcess = spawn(shellCommand, [], {
        cwd,
        env,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Stream stdout
      childProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        stdout += text;

        // Try to parse stream events line by line
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;

          buffer += line;

          try {
            const event = JSON.parse(buffer) as ClaudeStreamEvent;
            options?.onEvent?.(event);

            // Handle text content
            if (event.type === 'content_block_delta' && 'delta' in event) {
              if (event.delta.type === 'text_delta' && event.delta.text) {
                options?.onText?.(event.delta.text);
              }
            }

            buffer = '';
          } catch (parseError) {
            // If parsing fails, wait for more data
            if (!line.endsWith('\n')) {
              continue;
            }
            // If it ends with newline and still fails, treat as plain text
            if (buffer && !buffer.startsWith('{')) {
              options?.onText?.(buffer);
              buffer = '';
            }
          }
        }

        this.logger.debug(`STDOUT (stream): ${text.trim()}`);
      });

      // Stream stderr
      childProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        stderr += text;
        this.logger.debug(`STDERR (stream): ${text.trim()}`);

        // Treat stderr as error events
        options?.onEvent?.({
          type: 'system',
          message: text,
          level: 'error',
          timestamp: Date.now()
        });
      });

      // Handle process exit
      childProcess.on('close', (code: number | null) => {
        exitCode = code ?? 0;
        this.logger.debug(`Stream process closed with exit code: ${exitCode}`);

        // Send message stop event
        options?.onEvent?.({
          type: 'message_stop',
          timestamp: Date.now()
        });

        resolve({ exitCode, stdout, stderr, timedOut: false, duration: 0 });
      });

      // Handle process error
      childProcess.on('error', (error: Error) => {
        this.logger.error('Stream process error', error);
        options?.onError?.(error);
        reject(error);
      });
    });
  }
}
