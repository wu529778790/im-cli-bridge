/**
 * 限流器
 * 为不同的平台/资源提供独立的限流控制
 */

import { TokenBucket, TokenBucketConfig } from './token-bucket';
import { RetryPolicy, RetryPolicyConfig } from './retry-policy';
import { Logger } from '../logger';

export interface RateLimiterConfig {
  /** 是否启用限流 */
  enabled?: boolean;
  /** 平台特定的令牌桶配置 */
  platforms?: Record<string, TokenBucketConfig>;
  /** 默认的令牌桶配置 */
  defaultConfig?: TokenBucketConfig;
  /** 重试策略配置 */
  retryPolicy?: RetryPolicyConfig;
}

/**
 * 限流器类
 */
export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private retryPolicy: RetryPolicy;
  private logger: Logger;
  private config: Required<Pick<RateLimiterConfig, 'enabled'>> & RateLimiterConfig;

  // 平台默认限流配置（根据各平台的API限制）
  private static readonly PLATFORM_DEFAULTS: Record<string, TokenBucketConfig> = {
    telegram: { rate: 30, capacity: 100 }, // Telegram: 30 msg/sec
    feishu: { rate: 20, capacity: 50 }, // Feishu: 更保守的限制
    wechat: { rate: 10, capacity: 30 }, // WeChat: 更严格的限制
    default: { rate: 30, capacity: 100 }
  };

  constructor(config: RateLimiterConfig = {}) {
    this.logger = new Logger('RateLimiter');
    this.config = {
      enabled: config.enabled !== false,
      platforms: config.platforms || {},
      defaultConfig: config.defaultConfig || { rate: 30, capacity: 100 },
      retryPolicy: config.retryPolicy || {
        maxRetries: 3,
        initialDelay: 1000,
        backoffStrategy: 'exponential_with_jitter'
      }
    };
    this.retryPolicy = new RetryPolicy(this.config.retryPolicy!);
  }

  /**
   * 获取令牌（阻塞直到可用）
   * @param key 限流键（如平台名称、用户ID等）
   * @param tokens 需要的令牌数量
   */
  async acquire(key: string, tokens: number = 1): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const bucket = this.getOrCreateBucket(key);
    await bucket.consume(tokens);
    this.logger.debug(`Acquired ${tokens} token(s) for ${key}`);
  }

  /**
   * 尝试获取令牌（不阻塞）
   * @param key 限流键
   * @param tokens 需要的令牌数量
   * @returns 是否成功获取
   */
  tryAcquire(key: string, tokens: number = 1): boolean {
    if (!this.config.enabled) {
      return true;
    }

    const bucket = this.getOrCreateBucket(key);
    return bucket.tryConsume(tokens);
  }

  /**
   * 获取或创建令牌桶
   */
  private getOrCreateBucket(key: string): TokenBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      const config = this.getConfigForKey(key);
      bucket = new TokenBucket(config);
      this.buckets.set(key, bucket);
      this.logger.debug(`Created new token bucket for ${key}`, config);
    }
    return bucket;
  }

  /**
   * 获取指定键的配置
   */
  private getConfigForKey(key: string): TokenBucketConfig {
    // 优先使用用户指定的平台配置
    if (this.config.platforms && this.config.platforms[key]) {
      return this.config.platforms[key];
    }

    // 使用平台默认配置
    if (RateLimiter.PLATFORM_DEFAULTS[key]) {
      return RateLimiter.PLATFORM_DEFAULTS[key];
    }

    // 使用默认配置
    return this.config.defaultConfig!;
  }

  /**
   * 执行带限流和重试的操作
   * @param key 限流键
   * @param fn 要执行的函数
   * @param tokens 需要的令牌数量
   */
  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    tokens: number = 1
  ): Promise<T> {
    return this.retryPolicy.execute(async () => {
      await this.acquire(key, tokens);
      return fn();
    });
  }

  /**
   * 获取指定键的可用令牌数
   */
  getAvailableTokens(key: string): number {
    const bucket = this.buckets.get(key);
    return bucket ? bucket.getAvailableTokens() : 0;
  }

  /**
   * 重置指定键的令牌桶
   */
  reset(key: string): void {
    const bucket = this.buckets.get(key);
    if (bucket) {
      bucket.reset();
      this.logger.debug(`Reset token bucket for ${key}`);
    }
  }

  /**
   * 清除所有令牌桶
   */
  clear(): void {
    const count = this.buckets.size;
    this.buckets.clear();
    this.logger.info(`Cleared ${count} token bucket(s)`);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalBuckets: number;
    buckets: Array<{
      key: string;
      availableTokens: number;
      config: TokenBucketConfig;
    }>;
  } {
    const buckets: Array<{
      key: string;
      availableTokens: number;
      config: TokenBucketConfig;
    }> = [];

    for (const [key, bucket] of this.buckets.entries()) {
      buckets.push({
        key,
        availableTokens: bucket.getAvailableTokens(),
        config: this.getConfigForKey(key)
      });
    }

    return {
      totalBuckets: this.buckets.size,
      buckets
    };
  }

  /**
   * 启用或禁用限流
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.logger.info(`Rate limiter ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

export default RateLimiter;
