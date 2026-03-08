/**
 * Watchdog 接口
 * 定义 Watchdog 的公共 API
 */

export interface IWatchdog {
  start(): void;
  reset(): void;
  stop(): void;
  isRunning(): boolean;
}
