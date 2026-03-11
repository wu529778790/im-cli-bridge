import { createLogger } from '../logger.js';

const log = createLogger('Retry');

/** 抛出此错误时 withRetry 不再重试，直接穿透 */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelay = opts?.baseDelayMs ?? 500;
  const maxDelay = opts?.maxDelayMs ?? 5000;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof NonRetryableError || attempt >= maxRetries) throw err;
      const delay = Math.min(baseDelay * 2 ** attempt + Math.random() * 200, maxDelay);
      log.warn(`Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms: ${(err as Error)?.message ?? err}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
