/**
 * AsyncLock - 用于串行化异步操作的锁
 * 确保同一时间只有一个操作可以执行
 */

export class AsyncLock {
  private locked: boolean = false;
  private queue: Array<{
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    fn: () => Promise<any>;
  }> = [];

  /**
   * 获取锁并执行函数
   * @param fn 要执行的异步函数
   * @returns 函数执行结果
   */
  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    // 如果当前没有锁，直接执行
    if (!this.locked) {
      this.locked = true;
      try {
        const result = await fn();
        return result;
      } finally {
        this.processQueue();
      }
    }

    // 如果已有锁，加入队列等待
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ resolve, reject, fn });
    });
  }

  /**
   * 处理队列中的下一个任务
   */
  private processQueue(): void {
    if (this.queue.length === 0) {
      this.locked = false;
      return;
    }

    const next = this.queue.shift();
    if (!next) {
      this.locked = false;
      return;
    }

    next
      .fn()
      .then(next.resolve)
      .catch(next.reject)
      .finally(() => {
        this.processQueue();
      });
  }

  /**
   * 获取当前队列长度
   */
  get queueLength(): number {
    return this.queue.length;
  }

  /**
   * 检查是否被锁定
   */
  isLocked(): boolean {
    return this.locked;
  }
}

export default AsyncLock;
