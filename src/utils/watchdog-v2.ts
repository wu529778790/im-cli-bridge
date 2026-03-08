/**
 * 增强的 Watchdog
 * 支持多服务健康检查和智能恢复策略
 */

import { logger } from './logger';
import { IWatchdog } from './watchdog.interface';

export interface HealthCheck {
  /** 健康检查名称 */
  name: string;
  /** 检查函数，返回 true 表示健康 */
  check: () => Promise<boolean>;
  /** 检查间隔（毫秒） */
  interval: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 连续失败次数阈值 */
  failureThreshold?: number;
}

export interface RecoveryAction {
  /** 恢复动作名称 */
  name: string;
  /** 执行恢复动作 */
  action: () => Promise<void>;
}

export interface EnhancedWatchdogOptions {
  /** 服务名称 */
  name?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 超时回调 */
  onTimeout?: () => void | Promise<void>;
  /** 健康检查列表 */
  healthChecks?: HealthCheck[];
  /** 恢复动作映射 */
  recoveryActions?: Map<string, RecoveryAction>;
  /** 检查间隔（毫秒） */
  checkInterval?: number;
}

/**
 * 增强的 Watchdog 类
 */
export class EnhancedWatchdog implements IWatchdog {
  private name: string;
  private lastReset: number = Date.now();
  private running: boolean = false;
  private timeoutId: NodeJS.Timeout | null = null;
  private checkTimerId: NodeJS.Timeout | null = null;
  private healthChecks: Map<string, {
    check: HealthCheck;
    failureCount: number;
    lastCheck: number;
    lastStatus: boolean;
  }> = new Map();
  private recoveryActions: Map<string, RecoveryAction>;
  private checkInterval: number;
  private options: Omit<EnhancedWatchdogOptions, 'healthChecks' | 'recoveryActions'>;

  constructor(options: EnhancedWatchdogOptions = {}) {
    this.name = options.name || 'EnhancedWatchdog';
    this.options = {
      name: this.name,
      timeout: options.timeout || 60000,
      onTimeout: options.onTimeout,
      checkInterval: options.checkInterval || 10000
    };
    this.recoveryActions = options.recoveryActions || new Map();
    this.checkInterval = options.checkInterval || 10000;

    // 注册健康检查
    if (options.healthChecks) {
      for (const hc of options.healthChecks) {
        this.registerHealthCheck(hc);
      }
    }
  }

  /**
   * 启动 Watchdog
   */
  start(): void {
    if (this.running) {
      logger.warn(`${this.name} is already running`);
      return;
    }

    this.running = true;
    this.lastReset = Date.now();
    this.scheduleTimeout();
    this.startHealthChecks();

    logger.info(`${this.name} started with timeout: ${this.options.timeout}ms`);
  }

  /**
   * 重置 Watchdog（表示服务正常）
   */
  reset(): void {
    if (!this.running) {
      logger.warn(`${this.name} is not running, cannot reset`);
      return;
    }

    this.lastReset = Date.now();

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.scheduleTimeout();
    logger.debug(`${this.name} reset`);
  }

  /**
   * 停止 Watchdog
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.checkTimerId) {
      clearInterval(this.checkTimerId);
      this.checkTimerId = null;
    }

    logger.info(`${this.name} stopped`);
  }

  /**
   * 注册健康检查
   */
  registerHealthCheck(check: HealthCheck): void {
    this.healthChecks.set(check.name, {
      check,
      failureCount: 0,
      lastCheck: 0,
      lastStatus: true
    });

    logger.debug(`${this.name}: Registered health check '${check.name}'`);
  }

  /**
   * 移除健康检查
   */
  unregisterHealthCheck(name: string): void {
    this.healthChecks.delete(name);
    logger.debug(`${this.name}: Unregistered health check '${name}'`);
  }

  /**
   * 注册恢复动作
   */
  registerRecoveryAction(serviceName: string, action: RecoveryAction): void {
    this.recoveryActions.set(serviceName, action);
    logger.debug(`${this.name}: Registered recovery action for '${serviceName}'`);
  }

  /**
   * 获取最后重置时间
   */
  getLastResetTime(): number {
    return this.lastReset;
  }

  /**
   * 获取健康状态
   */
  getHealthStatus(): Map<string, {
    healthy: boolean;
    failureCount: number;
    lastCheck: number;
  }> {
    const status = new Map();

    for (const [name, data] of this.healthChecks.entries()) {
      status.set(name, {
        healthy: data.lastStatus,
        failureCount: data.failureCount,
        lastCheck: data.lastCheck
      });
    }

    return status;
  }

  /**
   * 检查是否运行中
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 安排超时检查
   */
  private scheduleTimeout(): void {
    if (!this.running) return;

    this.timeoutId = setTimeout(async () => {
      const elapsed = Date.now() - this.lastReset;
      logger.warn(`${this.name} timeout! Elapsed: ${elapsed}ms`);

      try {
        if (this.options.onTimeout) {
          await this.options.onTimeout();
        }
      } catch (error) {
        logger.error(`${this.name} timeout handler failed`, error);
      }

      // 重新安排超时检查（如果还在运行）
      if (this.running) {
        this.scheduleTimeout();
      }
    }, this.options.timeout);
  }

  /**
   * 启动健康检查定时器
   */
  private startHealthChecks(): void {
    this.checkTimerId = setInterval(async () => {
      await this.performHealthChecks();
    }, this.checkInterval);

    logger.debug(`${this.name}: Started health checks (interval: ${this.checkInterval}ms)`);
  }

  /**
   * 执行所有健康检查
   */
  private async performHealthChecks(): Promise<void> {
    const unhealthyServices: string[] = [];

    for (const [name, data] of this.healthChecks.entries()) {
      const threshold = data.check.failureThreshold || 3;

      try {
        const timeout = data.check.timeout || 5000;
        const healthy = await this.withTimeout(timeout, data.check.check());

        data.lastCheck = Date.now();
        data.lastStatus = healthy;

        if (healthy) {
          data.failureCount = 0;
        } else {
          data.failureCount++;

          if (data.failureCount >= threshold) {
            unhealthyServices.push(name);
          }
        }

        logger.debug(`${this.name}: Health check '${name}' - ${healthy ? 'OK' : 'FAILED'} (${data.failureCount}/${threshold})`);
      } catch (error) {
        data.failureCount++;
        data.lastCheck = Date.now();
        data.lastStatus = false;
        logger.error(`${this.name}: Health check '${name}' error:`, error);
        logger.debug(`${this.name}: Health check '${name}' - FAILED (${data.failureCount}/${threshold})`);
      }
    }

    // 处理不健康的服务
    if (unhealthyServices.length > 0) {
      await this.handleUnhealthyServices(unhealthyServices);
    }
  }

  /**
   * 处理不健康的服务
   */
  private async handleUnhealthyServices(services: string[]): Promise<void> {
    logger.warn(`${this.name}: Unhealthy services detected: ${services.join(', ')}`);

    for (const service of services) {
      const action = this.recoveryActions.get(service);
      if (action) {
        logger.info(`${this.name}: Attempting recovery for '${service}' using '${action.name}'`);
        try {
          await action.action();
          // 重置失败计数
          const data = this.healthChecks.get(service);
          if (data) {
            data.failureCount = 0;
          }
        } catch (error) {
          logger.error(`${this.name}: Recovery action '${action.name}' failed:`, error);
        }
      } else {
        logger.warn(`${this.name}: No recovery action found for '${service}'`);
      }
    }
  }

  /**
   * 带超时的 Promise 执行
   */
  private async withTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Health check timeout after ${ms}ms`)), ms)
      )
    ]);
  }
}

export default EnhancedWatchdog;
