/**
 * 结构化日志记录器
 * 提供结构化的 JSON 日志输出，便于日志分析和追踪
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  traceId?: string;
  spanId?: string;
  userId?: string;
  sessionId?: string;
}

/**
 * 链路追踪上下文
 */
export class TraceContext {
  private static currentTraceId: string | undefined;
  private static currentSpanId: string | undefined;
  private static currentUserId: string | undefined;
  private static currentSessionId: string | undefined;

  static setTraceId(traceId: string): void {
    this.currentTraceId = traceId;
  }

  static setSpanId(spanId: string): void {
    this.currentSpanId = spanId;
  }

  static setUserId(userId: string): void {
    this.currentUserId = userId;
  }

  static setSessionId(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  static getTraceId(): string | undefined {
    return this.currentTraceId;
  }

  static getSpanId(): string | undefined {
    return this.currentSpanId;
  }

  static getUserId(): string | undefined {
    return this.currentUserId;
  }

  static getSessionId(): string | undefined {
    return this.currentSessionId;
  }

  static clear(): void {
    this.currentTraceId = undefined;
    this.currentSpanId = undefined;
    this.currentUserId = undefined;
    this.currentSessionId = undefined;
  }

  static toJSON(): Record<string, string | undefined> {
    return {
      traceId: this.currentTraceId,
      spanId: this.currentSpanId,
      userId: this.currentUserId,
      sessionId: this.currentSessionId
    };
  }
}

/**
 * 结构化日志记录器
 */
export class StructuredLogger {
  private name: string;
  private context: LogContext = {};

  constructor(name: string) {
    this.name = name;
  }

  /**
   * 添加上下文
   */
  withContext(key: string, value: unknown): this {
    this.context[key] = value;
    return this;
  }

  /**
   * 批量添加上下文
   */
  withContexts(contexts: LogContext): this {
    Object.assign(this.context, contexts);
    return this;
  }

  /**
   * 清除上下文
   */
  clearContext(): this {
    this.context = {};
    return this;
  }

  /**
   * 记录调试日志
   */
  debug(message: string, meta?: LogContext): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  /**
   * 记录信息日志
   */
  info(message: string, meta?: LogContext): void {
    this.log(LogLevel.INFO, message, meta);
  }

  /**
   * 记录警告日志
   */
  warn(message: string, meta?: LogContext): void {
    this.log(LogLevel.WARN, message, meta);
  }

  /**
   * 记录错误日志
   */
  error(message: string, error?: Error | unknown, meta?: LogContext): void {
    let errorInfo: LogEntry['error'];

    if (error instanceof Error) {
      errorInfo = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      };
    } else if (error) {
      errorInfo = {
        name: 'UnknownError',
        message: String(error)
      };
    }

    this.log(LogLevel.ERROR, message, { ...meta, _error: errorInfo });
  }

  /**
   * 记录日志
   */
  private log(level: LogLevel, message: string, meta?: LogContext): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      context: { ...this.context, ...meta },
      ...TraceContext.toJSON()
    };

    // 输出到控制台
    this.output(entry);
  }

  /**
   * 输出日志
   */
  private output(entry: LogEntry): void {
    // 使用 process.stderr.write 而不是 console.log 以避免日志被缓冲
    const line = JSON.stringify(entry);
    process.stderr.write(line + '\n');
  }

  /**
   * 创建子日志记录器
   */
  child(name: string, context?: LogContext): StructuredLogger {
    const child = new StructuredLogger(`${this.name}:${name}`);
    child.withContexts({ ...this.context, ...context });
    return child;
  }
}

/**
 * 日志管理器
 */
export class LogManager {
  private loggers: Map<string, StructuredLogger> = new Map();
  private globalContext: LogContext = {};

  /**
   * 获取或创建日志记录器
   */
  getLogger(name: string): StructuredLogger {
    let logger = this.loggers.get(name);
    if (!logger) {
      logger = new StructuredLogger(name);
      logger.withContexts(this.globalContext);
      this.loggers.set(name, logger);
    }
    return logger;
  }

  /**
   * 设置全局上下文
   */
  setGlobalContext(context: LogContext): void {
    this.globalContext = { ...this.globalContext, ...context };

    // 更新所有现有日志记录器的上下文
    for (const logger of this.loggers.values()) {
      logger.withContexts(this.globalContext);
    }
  }

  /**
   * 清除所有日志记录器
   */
  clear(): void {
    this.loggers.clear();
  }
}

// 默认日志管理器实例
const defaultManager = new LogManager();

/**
 * 获取日志记录器
 */
export function getLogger(name: string): StructuredLogger {
  return defaultManager.getLogger(name);
}

/**
 * 设置全局日志上下文
 */
export function setGlobalContext(context: LogContext): void {
  defaultManager.setGlobalContext(context);
}

export default StructuredLogger;
