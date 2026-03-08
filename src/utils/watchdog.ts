import { logger } from './logger';
import { IWatchdog } from './watchdog.interface';

export interface WatchdogOptions {
  timeout: number; // milliseconds
  onTimeout: () => void | Promise<void>;
  name?: string;
}

export class Watchdog implements IWatchdog {
  private timeoutId: NodeJS.Timeout | null = null;
  private lastReset: number = Date.now();
  private options: WatchdogOptions;
  private running: boolean = false;

  constructor(options: WatchdogOptions) {
    this.options = {
      name: 'Watchdog',
      ...options
    };
  }

  start(): void {
    if (this.running) {
      logger.warn(`${this.options.name} is already running`);
      return;
    }

    this.running = true;
    this.lastReset = Date.now();
    this.scheduleTimeout();
    logger.info(`${this.options.name} started with timeout: ${this.options.timeout}ms`);
  }

  reset(): void {
    if (!this.running) {
      logger.warn(`${this.options.name} is not running, cannot reset`);
      return;
    }

    this.lastReset = Date.now();

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.scheduleTimeout();
    logger.debug(`${this.options.name} reset`);
  }

  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    logger.info(`${this.options.name} stopped`);
  }

  private scheduleTimeout(): void {
    this.timeoutId = setTimeout(async () => {
      const elapsed = Date.now() - this.lastReset;
      logger.warn(`${this.options.name} timeout! Elapsed: ${elapsed}ms`);

      try {
        await this.options.onTimeout();
      } catch (error) {
        logger.error(`${this.options.name} timeout handler failed`, error);
      }

      // Reschedule if still running
      if (this.running) {
        this.scheduleTimeout();
      }
    }, this.options.timeout);
  }

  getLastResetTime(): number {
    return this.lastReset;
  }

  isRunning(): boolean {
    return this.running;
  }
}

export default Watchdog;
