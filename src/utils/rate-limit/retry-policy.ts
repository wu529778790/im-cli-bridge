/**
 * 重试策略
 * 定义重试行为和退避算法
 */

export type BackoffStrategy = 'fixed' | 'linear' | 'exponential' | 'exponential_with_jitter';

export interface RetryPolicyConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始重试延迟（毫秒） */
  initialDelay: number;
  /** 最大重试延迟（毫秒） */
  maxDelay?: number;
  /** 退避策略 */
  backoffStrategy?: BackoffStrategy;
  /** 可重试的错误判断函数 */
  retryable?: (error: Error) => boolean;
  /** 重试超时时间（毫秒），0表示无限制 */
  timeout?: number;
}

/**
 * 重试策略类
 */
export class RetryPolicy {
  private config: Required<Omit<RetryPolicyConfig, 'retryable' | 'timeout'>> & {
    retryable: (error: Error) => boolean;
    timeout: number;
  };

  constructor(config: RetryPolicyConfig) {
    this.config = {
      maxRetries: config.maxRetries,
      initialDelay: config.initialDelay,
      maxDelay: config.maxDelay || 60 * 1000, // 默认最大1分钟
      backoffStrategy: config.backoffStrategy || 'exponential',
      retryable: config.retryable || this.defaultRetryable,
      timeout: config.timeout || 0
    };
  }

  /**
   * 执行带重试的异步操作
   * @param fn 要执行的函数
   * @returns Promise，当函数成功或达到最大重试次数时解析
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // 检查是否可重试
        if (!this.config.retryable(lastError)) {
          throw lastError;
        }

        // 检查是否达到最大重试次数
        if (attempt === this.config.maxRetries) {
          break;
        }

        // 检查是否超时
        if (this.config.timeout > 0) {
          const elapsed = Date.now() - startTime;
          if (elapsed >= this.config.timeout) {
            throw new Error(`Retry timeout after ${elapsed}ms`);
          }
        }

        // 计算延迟并等待
        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }

    throw lastError || new Error('Retry failed with unknown error');
  }

  /**
   * 计算重试延迟
   */
  private calculateDelay(attempt: number): number {
    const strategy = this.config.backoffStrategy;
    const baseDelay = this.config.initialDelay;
    const maxDelay = this.config.maxDelay;

    let delay: number;

    switch (strategy) {
      case 'fixed':
        delay = baseDelay;
        break;

      case 'linear':
        delay = baseDelay * (attempt + 1);
        break;

      case 'exponential':
        delay = baseDelay * Math.pow(2, attempt);
        break;

      case 'exponential_with_jitter':
        const exponentialDelay = baseDelay * Math.pow(2, attempt);
        // 添加 ±25% 的随机抖动
        const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
        delay = exponentialDelay + jitter;
        break;

      default:
        delay = baseDelay;
    }

    return Math.min(delay, maxDelay);
  }

  /**
   * 默认的可重试错误判断
   */
  private defaultRetryable(error: Error): boolean {
    // 网络错误
    if (error.message.includes('ECONNRESET')) return true;
    if (error.message.includes('ETIMEDOUT')) return true;
    if (error.message.includes('ENOTFOUND')) return true;
    if (error.message.includes('ECONNREFUSED')) return true;

    // HTTP 429 Too Many Requests
    if (error.message.includes('429')) return true;

    // HTTP 5xx 服务器错误
    if (error.message.includes('503')) return true;
    if (error.message.includes('502')) return true;
    if (error.message.includes('504')) return true;

    // Telegram/Feishu 特定错误
    if (error.message.includes('Too Many Requests')) return true;
    if (error.message.includes('flood wait')) return true; // Telegram

    return false;
  }

  /**
   * 睡眠指定时间
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取配置
   */
  getConfig(): Readonly<RetryPolicyConfig> {
    return { ...this.config };
  }
}

export default RetryPolicy;
