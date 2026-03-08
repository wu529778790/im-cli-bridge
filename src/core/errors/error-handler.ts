/**
 * 错误处理器
 * 统一处理应用中的各种错误
 */

import { AppError, ErrorCategory } from './app-error';
import { Logger } from '../../utils/logger';
import { EventEmitter } from '../event-emitter';

export interface ErrorHandlerConfig {
  /** 是否启用错误日志 */
  enableLogging?: boolean;
  /** 是否启用错误事件 */
  enableEvents?: boolean;
  /** 是否启用用户通知 */
  enableUserNotification?: boolean;
}

export interface UserNotification {
  userId: string;
  platform: string;
  message: string;
}

/**
 * 错误处理器类
 */
export class ErrorHandler {
  private logger: Logger;
  private eventEmitter: EventEmitter;
  private config: Required<ErrorHandlerConfig>;
  private stats: Map<ErrorCategory, number> = new Map();
  private userNotificationCallbacks: Array<(notification: UserNotification) => Promise<void>> = [];

  constructor(
    eventEmitter: EventEmitter,
    config: ErrorHandlerConfig = {}
  ) {
    this.eventEmitter = eventEmitter;
    this.logger = new Logger('ErrorHandler');
    this.config = {
      enableLogging: config.enableLogging ?? true,
      enableEvents: config.enableEvents ?? true,
      enableUserNotification: config.enableUserNotification ?? true
    };

    // 初始化统计
    for (const category of Object.values(ErrorCategory)) {
      this.stats.set(category, 0);
    }
  }

  /**
   * 处理错误
   * @param error 错误对象
   * @param context 错误上下文
   */
  async handle(error: unknown, context: string): Promise<void> {
    const appError = AppError.fromError(error, { context });

    // 记录统计
    this.incrementStats(appError.category);

    // 记录日志
    if (this.config.enableLogging) {
      this.logError(appError, context);
    }

    // 触发事件
    if (this.config.enableEvents) {
      await this.emitErrorEvent(appError, context);
    }

    // 根据错误类别执行特定的恢复操作
    await this.attemptRecovery(appError, context);
  }

  /**
   * 处理带用户上下文的错误
   * @param error 错误对象
   * @param context 错误上下文
   * @param userId 用户ID
   * @param platform 平台名称
   */
  async handleWithUserContext(
    error: unknown,
    context: string,
    userId: string,
    platform: string
  ): Promise<void> {
    const appError = AppError.fromError(error, { context, userId, platform });

    // 先处理错误
    await this.handle(appError, context);

    // 如果启用用户通知，发送用户友好消息
    if (this.config.enableUserNotification && appError.userMessage) {
      await this.notifyUser(userId, platform, appError.userMessage);
    }
  }

  /**
   * 尝试恢复
   */
  private async attemptRecovery(error: AppError, context: string): Promise<void> {
    this.logger.debug(`Attempting recovery for ${error.category}`);

    switch (error.category) {
      case ErrorCategory.RATE_LIMITED:
        await this.handleRateLimit(error, context);
        break;

      case ErrorCategory.AI_CLI_TIMEOUT:
        await this.handleAiCliTimeout(error, context);
        break;

      case ErrorCategory.AUTH_FAILED:
      case ErrorCategory.TOKEN_EXPIRED:
        await this.handleAuthError(error, context);
        break;

      case ErrorCategory.CONNECTION_REFUSED:
      case ErrorCategory.NETWORK_ERROR:
        await this.handleNetworkError(error, context);
        break;

      default:
        // 其他错误不进行自动恢复
        break;
    }
  }

  /**
   * 处理限流错误
   */
  private async handleRateLimit(error: AppError, context: string): Promise<void> {
    // 触发限流事件，让监听者知道需要暂停请求
    await this.eventEmitter.emit('rate_limit:exceeded', {
      context,
      timestamp: error.timestamp
    });

    this.logger.warn(`Rate limit exceeded in ${context}`);
  }

  /**
   * 处理 AI CLI 超时
   */
  private async handleAiCliTimeout(error: AppError, context: string): Promise<void> {
    // 触发 AI CLI 重启事件
    await this.eventEmitter.emit('ai_cli:timeout', {
      context,
      timestamp: error.timestamp
    });

    this.logger.warn(`AI CLI timeout in ${context}, may need restart`);
  }

  /**
   * 处理认证错误
   */
  private async handleAuthError(error: AppError, context: string): Promise<void> {
    // 触发认证失败事件
    await this.eventEmitter.emit('auth:failed', {
      context,
      timestamp: error.timestamp
    });

    this.logger.error(`Authentication failed in ${context}`);
  }

  /**
   * 处理网络错误
   */
  private async handleNetworkError(error: AppError, context: string): Promise<void> {
    // 触发网络错误事件
    await this.eventEmitter.emit('network:error', {
      context,
      timestamp: error.timestamp,
      retryable: error.retryable
    });

    this.logger.warn(`Network error in ${context}: ${error.message}`);
  }

  /**
   * 记录错误日志
   */
  private logError(error: AppError, context: string): void {
    const logLevel = this.getLogLevel(error.category);
    const logData = {
      context,
      category: error.category,
      retryable: error.retryable,
      ...error.context,
      originalError: error.originalError?.message
    };

    switch (logLevel) {
      case 'error':
        this.logger.error(`[${error.category}] ${error.userMessage}`, logData);
        break;
      case 'warn':
        this.logger.warn(`[${error.category}] ${error.userMessage}`, logData);
        break;
      default:
        this.logger.info(`[${error.category}] ${error.userMessage}`, logData);
    }
  }

  /**
   * 获取日志级别
   */
  private getLogLevel(category: ErrorCategory): 'error' | 'warn' | 'info' {
    const errorLevels = [
      ErrorCategory.AUTH_FAILED,
      ErrorCategory.VALIDATION_ERROR,
      ErrorCategory.CONFIG_ERROR,
      ErrorCategory.AI_CLI_EXECUTION_FAILED
    ];

    return errorLevels.includes(category) ? 'error' : 'warn';
  }

  /**
   * 触发错误事件
   */
  private async emitErrorEvent(error: AppError, context: string): Promise<void> {
    await this.eventEmitter.emit('error', {
      category: error.category,
      message: error.userMessage,
      context,
      retryable: error.retryable,
      timestamp: error.timestamp,
      data: error.toJSON()
    });
  }

  /**
   * 通知用户
   */
  private async notifyUser(userId: string, platform: string, message: string): Promise<void> {
    const notification: UserNotification = { userId, platform, message };

    for (const callback of this.userNotificationCallbacks) {
      try {
        await callback(notification);
      } catch (error) {
        this.logger.error('Failed to send user notification:', error);
      }
    }
  }

  /**
   * 注册用户通知回调
   */
  onUserNotification(callback: (notification: UserNotification) => Promise<void>): void {
    this.userNotificationCallbacks.push(callback);
  }

  /**
   * 增加统计计数
   */
  private incrementStats(category: ErrorCategory): void {
    const current = this.stats.get(category) || 0;
    this.stats.set(category, current + 1);
  }

  /**
   * 获取错误统计
   */
  getStats(): Record<ErrorCategory, number> {
    const result: Record<ErrorCategory, number> = {} as any;
    for (const [category, count] of this.stats.entries()) {
      result[category] = count;
    }
    return result;
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    for (const category of Object.values(ErrorCategory)) {
      this.stats.set(category, 0);
    }
  }

  /**
   * 获取配置
   */
  getConfig(): Readonly<Required<ErrorHandlerConfig>> {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<ErrorHandlerConfig>): void {
    Object.assign(this.config, updates);
  }
}

export default ErrorHandler;
