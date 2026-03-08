/**
 * 令牌桶限流算法
 * 用于平滑限制请求速率
 */

export interface TokenBucketConfig {
  /** 令牌生成速率（每秒） */
  rate: number;
  /** 桶容量 */
  capacity: number;
}

/**
 * 令牌桶类
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private config: TokenBucketConfig;

  constructor(config: TokenBucketConfig) {
    this.config = config;
    this.tokens = config.capacity;
    this.lastRefill = Date.now();
  }

  /**
   * 消费指定数量的令牌
   * @param tokens 要消费的令牌数量
   * @param maxWaitTime 最大等待时间（毫秒），0表示不等待
   * @returns Promise，当令牌可用时解析
   */
  async consume(tokens: number = 1, maxWaitTime: number = 0): Promise<void> {
    const now = Date.now();
    this.refill(now);

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }

    // 计算需要等待的时间
    const tokensNeeded = tokens - this.tokens;
    const waitTime = (tokensNeeded / this.config.rate) * 1000;

    // 如果设置了最大等待时间且超过，则拒绝
    if (maxWaitTime > 0 && waitTime > maxWaitTime) {
      throw new Error(`Rate limit exceeded: need ${waitTime}ms but max wait is ${maxWaitTime}ms`);
    }

    // 等待直到有足够的令牌
    await this.sleep(waitTime);
    this.refill(Date.now());
    this.tokens -= tokens;
  }

  /**
   * 尝试消费令牌（不等待）
   * @param tokens 要消费的令牌数量
   * @returns 是否成功消费
   */
  tryConsume(tokens: number = 1): boolean {
    const now = Date.now();
    this.refill(now);

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  /**
   * 获取当前可用令牌数
   */
  getAvailableTokens(): number {
    this.refill(Date.now());
    return this.tokens;
  }

  /**
   * 重置桶
   */
  reset(): void {
    this.tokens = this.config.capacity;
    this.lastRefill = Date.now();
  }

  /**
   * 补充令牌
   */
  private refill(now: number): void {
    const elapsed = (now - this.lastRefill) / 1000; // 转换为秒
    const tokensToAdd = Math.floor(elapsed * this.config.rate);

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.config.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * 睡眠指定时间
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default TokenBucket;
