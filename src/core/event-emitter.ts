/**
 * 事件发射器 - 简单的发布订阅模式
 */

import { EventType, EventCallback } from '../interfaces/types';
import { Logger } from '../utils/logger';

export class EventEmitter {
  private listeners: Map<EventType, Set<EventCallback>> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = new Logger('EventEmitter');
  }

  /**
   * 注册事件监听器
   */
  on(event: EventType, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    this.logger.debug(`Registered listener for event: ${event}`);
  }

  /**
   * 移除事件监听器
   */
  off(event: EventType, callback: EventCallback): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
      this.logger.debug(`Removed listener for event: ${event}`);

      // 如果该事件没有监听器了，删除该事件
      if (callbacks.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * 触发事件
   */
  async emit(event: EventType, data?: any): Promise<void> {
    const callbacks = this.listeners.get(event);
    if (!callbacks || callbacks.size === 0) {
      this.logger.debug(`No listeners for event: ${event}`);
      return;
    }

    this.logger.debug(`Emitting event: ${event}`, data);

    // 并行执行所有回调
    const promises = Array.from(callbacks).map(async (callback) => {
      try {
        await callback(data);
      } catch (error) {
        this.logger.error(`Error in event listener for ${event}:`, error);
        // 触发错误事件
        if (event !== 'error') {
          await this.emit('error', {
            event,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * 移除某个事件的所有监听器
   */
  removeAllListeners(event?: EventType): void {
    if (event) {
      this.listeners.delete(event);
      this.logger.debug(`Removed all listeners for event: ${event}`);
    } else {
      this.listeners.clear();
      this.logger.debug('Removed all listeners');
    }
  }

  /**
   * 获取某个事件的监听器数量
   */
  listenerCount(event: EventType): number {
    return this.listeners.get(event)?.size || 0;
  }

  /**
   * 检查是否有某个事件的监听器
   */
  hasListeners(event: EventType): boolean {
    const callbacks = this.listeners.get(event);
    return callbacks ? callbacks.size > 0 : false;
  }
}
