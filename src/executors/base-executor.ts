import { ICommandExecutor, ExecutionResult, ExecutionOptions, StreamExecutionOptions } from '../interfaces/command-executor';
import { logger } from '../utils/logger';

/**
 * Abstract base class for command executors
 * Provides common functionality like logging and timeout control
 */
export abstract class BaseExecutor implements ICommandExecutor {
  protected readonly executorId: string;
  protected readonly logger = logger;

  constructor(executorName: string) {
    this.executorId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Execute a command - to be implemented by subclasses
   */
  abstract execute(command: string, args: string[], options?: ExecutionOptions): Promise<ExecutionResult>;

  /**
   * Execute a command with streaming - to be implemented by subclasses
   */
  abstract executeStream(
    command: string,
    args: string[],
    options?: StreamExecutionOptions
  ): Promise<ExecutionResult>;

  /**
   * Validate if the executor is available - to be implemented by subclasses
   */
  abstract validate(): Promise<boolean>;

  /**
   * Create a timeout promise
   */
  protected createTimeoutPromise<T>(timeoutMs: number, message: string): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timeout after ${timeoutMs}ms: ${message}`));
      }, timeoutMs);
    });
  }

  /**
   * Execute with timeout control
   */
  protected async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number | undefined,
    timeoutMessage: string
  ): Promise<T> {
    if (!timeoutMs || timeoutMs <= 0) {
      return promise;
    }

    this.logger.debug(`Setting timeout: ${timeoutMs}ms`);
    return Promise.race([
      promise,
      this.createTimeoutPromise<T>(timeoutMs, timeoutMessage)
    ]);
  }

  /**
   * Build environment variables
   */
  protected buildEnvironment(customEnv?: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};

    // Copy process.env, filtering out undefined values
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }

    // 强制子进程使用 UTF-8，避免中文等多字节字符出现乱码
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';

    // Merge with custom environment
    return {
      ...env,
      ...customEnv
    };
  }

  /**
   * Sanitize command arguments for logging
   */
  protected sanitizeArgs(args: string[]): string[] {
    return args.map(arg => {
      // Hide sensitive information
      if (arg.includes('api_key') || arg.includes('token') || arg.includes('secret')) {
        return '[REDACTED]';
      }
      return arg;
    });
  }

  /**
   * Format command for logging
   */
  protected formatCommand(command: string, args: string[]): string {
    const sanitizedArgs = this.sanitizeArgs(args);
    return `${command} ${sanitizedArgs.join(' ')}`;
  }
}

/**
 * Simple logger implementation
 */
class Logger {
  private readonly prefix: string;

  constructor(name: string) {
    this.prefix = `[${name}]`;
  }

  debug(message: string, ...args: any[]): void {
    if (process.env.DEBUG) {
      console.error(`${this.prefix} DEBUG:`, message, ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    console.error(`${this.prefix} INFO:`, message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.error(`${this.prefix} WARN:`, message, ...args);
  }

  error(message: string, error?: Error | unknown, ...args: any[]): void {
    console.error(`${this.prefix} ERROR:`, message, error, ...args);
  }
}
