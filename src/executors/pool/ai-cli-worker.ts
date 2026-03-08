/**
 * AI CLI Worker
 * 管理 AI CLI 进程的创建、执行和清理
 */

import { spawn, ChildProcess } from 'child_process';
import { ExecutionResult, ExecutionOptions } from '../../interfaces/command-executor';
import { Logger } from '../../utils/logger';

export interface WorkerConfig {
  /** AI CLI 命令 (如 claudecode, cursor) */
  command: string;
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 最大空闲时间（毫秒） */
  maxIdleTime?: number;
  /** 最大执行次数 */
  maxExecutions?: number;
}

/**
 * Worker 状态
 */
enum WorkerState {
  IDLE = 'idle',
  BUSY = 'busy',
  TERMINATED = 'terminated'
}

/**
 * AI CLI Worker 类
 * 每个实例管理一个 AI CLI 进程的生命周期
 */
export class AICliWorker {
  private state: WorkerState = WorkerState.IDLE;
  private executionCount: number = 0;
  private lastUsed: number = Date.now();
  private currentProcess: ChildProcess | null = null;
  private resolveQueue: Array<{
    resolve: (value: ExecutionResult) => void;
    reject: (reason?: any) => void;
    command: string;
    args: string[];
  }> = [];
  private logger: Logger;
  private config: WorkerConfig;

  constructor(config: WorkerConfig, workerId: string) {
    this.config = config;
    this.logger = new Logger(`AICliWorker-${workerId}`);
  }

  /**
   * 执行命令
   */
  async execute(command: string, args: string[], options?: ExecutionOptions): Promise<ExecutionResult> {
    if (this.state === WorkerState.TERMINATED) {
      throw new Error('Worker has been terminated');
    }

    if (this.state === WorkerState.BUSY) {
      throw new Error('Worker is busy');
    }

    this.state = WorkerState.BUSY;
    this.executionCount++;
    this.lastUsed = Date.now();

    try {
      const result = await this.executeCommand(command, args, options);
      return result;
    } finally {
      this.state = WorkerState.IDLE;
      this.lastUsed = Date.now();
    }
  }

  /**
   * 执行单个命令
   */
  private async executeCommand(
    command: string,
    args: string[],
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const cwd = options?.cwd || this.config.cwd || process.cwd();
      const env = { ...this.buildEnvironment(), ...options?.env };
      const timeout = options?.timeout;

      this.logger.debug(`Executing: ${command} ${args.join(' ')}`);

      // 构建带引号的 shell 命令
      const shellCommand = this.buildShellCommand(command, args);

      const childProcess = spawn(shellCommand, [], {
        cwd,
        env,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.currentProcess = childProcess;

      let stdout = '';
      let stderr = '';

      // 收集输出
      childProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString('utf-8');
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf-8');
      });

      // 超时处理
      let timeoutHandle: NodeJS.Timeout | undefined;
      if (timeout) {
        timeoutHandle = setTimeout(() => {
          childProcess.kill('SIGKILL');
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      }

      // 进程结束处理
      childProcess.on('close', (code: number | null) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        const duration = Date.now() - startTime;

        if (code === 0 || code === null) {
          resolve({
            exitCode: code || 0,
            stdout,
            stderr,
            timedOut: false,
            duration
          });
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }

        this.currentProcess = null;
      });

      // 错误处理
      childProcess.on('error', (error: Error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this.currentProcess = null;
        reject(error);
      });
    });
  }

  /**
   * 构建带引号的 shell 命令字符串
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
   * 构建环境变量
   */
  private buildEnvironment(): Record<string, string> {
    const env: Record<string, string> = {};

    // 复制 process.env
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }

    // 移除 CLAUDECODE 环境变量，允许在 Claude Code 内运行 claude 命令
    delete env.CLAUDECODE;

    // 强制 UTF-8 编码
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';

    // 合并自定义环境变量
    return {
      ...env,
      ...this.config.env
    };
  }

  /**
   * 获取 Worker 状态
   */
  getStatus(): {
    state: WorkerState;
    executionCount: number;
    lastUsed: number;
    idleTime: number;
  } {
    return {
      state: this.state,
      executionCount: this.executionCount,
      lastUsed: this.lastUsed,
      idleTime: this.state === WorkerState.IDLE ? Date.now() - this.lastUsed : 0
    };
  }

  /**
   * 检查是否应该被回收
   */
  shouldReap(): boolean {
    if (this.state === WorkerState.TERMINATED) {
      return true;
    }

    const maxIdleTime = this.config.maxIdleTime || 5 * 60 * 1000; // 默认5分钟
    const maxExecutions = this.config.maxExecutions || 100; // 默认最多执行100次

    const idleTooLong = this.state === WorkerState.IDLE && (Date.now() - this.lastUsed) > maxIdleTime;
    const tooManyExecutions = this.executionCount >= maxExecutions;

    return idleTooLong || tooManyExecutions;
  }

  /**
   * 终止 Worker
   */
  terminate(): void {
    this.state = WorkerState.TERMINATED;

    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }

    // 拒绝所有等待中的任务
    for (const task of this.resolveQueue) {
      task.reject(new Error('Worker terminated'));
    }
    this.resolveQueue = [];
  }

  /**
   * 获取当前进程（如果正在运行）
   */
  getProcess(): ChildProcess | null {
    return this.currentProcess;
  }
}
