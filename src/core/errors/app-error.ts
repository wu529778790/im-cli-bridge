/**
 * 应用错误分类
 */

export enum ErrorCategory {
  // 认证授权错误
  AUTH_FAILED = 'AUTH_FAILED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',

  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  TIMEOUT = 'TIMEOUT',
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',

  // AI CLI 错误
  AI_CLI_TIMEOUT = 'AI_CLI_TIMEOUT',
  AI_CLI_NOT_FOUND = 'AI_CLI_NOT_FOUND',
  AI_CLI_EXECUTION_FAILED = 'AI_CLI_EXECUTION_FAILED',

  // 存储错误
  STORAGE_ERROR = 'STORAGE_ERROR',
  STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED',

  // 验证错误
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',

  // 配置错误
  CONFIG_ERROR = 'CONFIG_ERROR',
  MISSING_CONFIG = 'MISSING_CONFIG',

  // IM 平台错误
  IM_PLATFORM_ERROR = 'IM_PLATFORM_ERROR',
  MESSAGE_SEND_FAILED = 'MESSAGE_SEND_FAILED',

  // 其他
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * 应用错误类
 * 统一的错误格式，包含错误分类、重试信息等
 */
export class AppError extends Error {
  public readonly category: ErrorCategory;
  public readonly retryable: boolean;
  public readonly userMessage: string;
  public readonly originalError?: Error;
  public readonly context?: Record<string, unknown>;
  public readonly code?: string;
  public readonly timestamp: number;

  constructor(
    category: ErrorCategory,
    userMessage: string,
    options?: {
      retryable?: boolean;
      originalError?: Error;
      context?: Record<string, unknown>;
      code?: string;
    }
  ) {
    const originalMessage = options?.originalError?.message || userMessage;
    super(originalMessage);

    this.name = 'AppError';
    this.category = category;
    this.userMessage = userMessage;
    this.retryable = options?.retryable ?? this.getDefaultRetryable(category);
    this.originalError = options?.originalError;
    this.context = options?.context;
    this.code = options?.code;
    this.timestamp = Date.now();

    // 维护正确的堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * 根据错误类别获取默认的可重试性
   */
  private getDefaultRetryable(category: ErrorCategory): boolean {
    const retryableCategories = [
      ErrorCategory.NETWORK_ERROR,
      ErrorCategory.RATE_LIMITED,
      ErrorCategory.TIMEOUT,
      ErrorCategory.CONNECTION_REFUSED,
      ErrorCategory.AI_CLI_TIMEOUT,
      ErrorCategory.MESSAGE_SEND_FAILED
    ];

    return retryableCategories.includes(category);
  }

  /**
   * 创建认证失败错误
   */
  static authFailed(message: string, context?: Record<string, unknown>): AppError {
    return new AppError(ErrorCategory.AUTH_FAILED, message, {
      retryable: false,
      context
    });
  }

  /**
   * 创建限流错误
   */
  static rateLimited(message: string, context?: Record<string, unknown>): AppError {
    return new AppError(ErrorCategory.RATE_LIMITED, message, {
      retryable: true,
      context
    });
  }

  /**
   * 创建超时错误
   */
  static timeout(message: string, context?: Record<string, unknown>): AppError {
    return new AppError(ErrorCategory.TIMEOUT, message, {
      retryable: true,
      context
    });
  }

  /**
   * 创建验证错误
   */
  static validation(message: string, context?: Record<string, unknown>): AppError {
    return new AppError(ErrorCategory.VALIDATION_ERROR, message, {
      retryable: false,
      context
    });
  }

  /**
   * 从普通错误创建 AppError
   */
  static fromError(error: unknown, context?: Record<string, unknown>): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof Error) {
      // 尝试从错误消息中推断错误类别
      const category = AppError.inferCategory(error.message);
      return new AppError(category, error.message, {
        originalError: error,
        context
      });
    }

    return new AppError(ErrorCategory.UNKNOWN_ERROR, String(error), {
      context
    });
  }

  /**
   * 从错误消息推断错误类别
   */
  private static inferCategory(message: string): ErrorCategory {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('auth') || lowerMessage.includes('unauthorized') || lowerMessage.includes('401')) {
      return ErrorCategory.AUTH_FAILED;
    }
    if (lowerMessage.includes('rate limit') || lowerMessage.includes('429') || lowerMessage.includes('too many requests')) {
      return ErrorCategory.RATE_LIMITED;
    }
    if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
      return ErrorCategory.TIMEOUT;
    }
    if (lowerMessage.includes('econnrefused') || lowerMessage.includes('connection refused')) {
      return ErrorCategory.CONNECTION_REFUSED;
    }
    if (lowerMessage.includes('network') || lowerMessage.includes('econnreset') || lowerMessage.includes('enotfound')) {
      return ErrorCategory.NETWORK_ERROR;
    }
    if (lowerMessage.includes('not found') || lowerMessage.includes('enoent')) {
      return ErrorCategory.AI_CLI_NOT_FOUND;
    }

    return ErrorCategory.UNKNOWN_ERROR;
  }

  /**
   * 转换为 JSON（用于日志记录）
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      category: this.category,
      message: this.message,
      userMessage: this.userMessage,
      retryable: this.retryable,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message
      } : undefined
    };
  }
}

export default AppError;
