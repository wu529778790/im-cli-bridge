/**
 * 指标收集模块
 * 收集和上报应用程序指标
 */

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface MetricValue {
  type: MetricType;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

export interface CounterOptions {
  help?: string;
  labels?: string[];
}

export interface HistogramOptions {
  help?: string;
  labels?: string[];
  buckets?: number[];
}

/**
 * 计数器
 */
export class Counter {
  private value: number = 0;
  private labelValues: Map<string, number> = new Map();

  constructor(private name: string, private options: CounterOptions = {}) {}

  inc(labels?: Record<string, string>, value: number = 1): void {
    if (!labels) {
      this.value += value;
    } else {
      const key = this.labelKey(labels);
      const current = this.labelValues.get(key) || 0;
      this.labelValues.set(key, current + value);
    }
  }

  reset(labels?: Record<string, string>): void {
    if (!labels) {
      this.value = 0;
    } else {
      this.labelValues.delete(this.labelKey(labels));
    }
  }

  get(): number {
    return this.value;
  }

  getLabels(): Map<string, number> {
    return new Map(this.labelValues);
  }

  private labelKey(labels: Record<string, string>): string {
    const parts = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
    return parts.join(',');
  }
}

/**
 * 仪表
 */
export class Gauge {
  private value: number = 0;
  private labelValues: Map<string, number> = new Map();

  constructor(private name: string, private options: CounterOptions = {}) {}

  set(value: number, labels?: Record<string, string>): void {
    if (!labels) {
      this.value = value;
    } else {
      this.labelValues.set(this.labelKey(labels), value);
    }
  }

  inc(labels?: Record<string, string>, value: number = 1): void {
    if (!labels) {
      this.value += value;
    } else {
      const key = this.labelKey(labels);
      const current = this.labelValues.get(key) || 0;
      this.labelValues.set(key, current + value);
    }
  }

  dec(labels?: Record<string, string>, value: number = 1): void {
    if (!labels) {
      this.value -= value;
    } else {
      const key = this.labelKey(labels);
      const current = this.labelValues.get(key) || 0;
      this.labelValues.set(key, current - value);
    }
  }

  get(): number {
    return this.value;
  }

  getLabels(): Map<string, number> {
    return new Map(this.labelValues);
  }

  private labelKey(labels: Record<string, string>): string {
    const parts = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
    return parts.join(',');
  }
}

/**
 * 直方图
 */
export class Histogram {
  private values: Map<string, number[]> = new Map();
  private defaultBuckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  private sum: number = 0;
  private count: number = 0;

  constructor(
    private name: string,
    private options: HistogramOptions = {}
  ) {
    this.options.buckets = options.buckets || this.defaultBuckets;
  }

  observe(value: number, labels?: Record<string, string>): void {
    const key = labels ? this.labelKey(labels) : '';

    if (!this.values.has(key)) {
      this.values.set(key, []);
    }

    const values = this.values.get(key)!;
    values.push(value);

    this.sum += value;
    this.count++;
  }

  reset(labels?: Record<string, string>): void {
    const key = labels ? this.labelKey(labels) : '';
    this.values.delete(key);
  }

  getStats(labels?: Record<string, string>): {
    min: number;
    max: number;
    mean: number;
    count: number;
    sum: number;
    p50: number;
    p95: number;
    p99: number;
  } {
    const key = labels ? this.labelKey(labels) : '';
    const values = this.values.get(key) || [];

    if (values.length === 0) {
      return { min: 0, max: 0, mean: 0, count: 0, sum: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const count = sorted.length;

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: sum / count,
      count,
      sum,
      p50: this.percentile(sorted, 0.5),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99)
    };
  }

  private percentile(sorted: number[], p: number): number {
    const pos = (sorted.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;

    if (base + 1 < sorted.length) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }

    return sorted[base];
  }

  private labelKey(labels: Record<string, string>): string {
    const parts = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
    return parts.join(',');
  }
}

/**
 * 指标收集器
 */
export class MetricsCollector {
  private counters: Map<string, Counter> = new Map();
  private gauges: Map<string, Gauge> = new Map();
  private histograms: Map<string, Histogram> = new Map();

  /**
   * 创建或获取计数器
   */
  counter(name: string, options?: CounterOptions): Counter {
    let counter = this.counters.get(name);
    if (!counter) {
      counter = new Counter(name, options);
      this.counters.set(name, counter);
    }
    return counter;
  }

  /**
   * 创建或获取仪表
   */
  gauge(name: string, options?: CounterOptions): Gauge {
    let gauge = this.gauges.get(name);
    if (!gauge) {
      gauge = new Gauge(name, options);
      this.gauges.set(name, gauge);
    }
    return gauge;
  }

  /**
   * 创建或获取直方图
   */
  histogram(name: string, options?: HistogramOptions): Histogram {
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = new Histogram(name, options);
      this.histograms.set(name, histogram);
    }
    return histogram;
  }

  /**
   * 增加计数器
   */
  increment(name: string, value: number = 1, labels?: Record<string, string>): void {
    const counter = this.counters.get(name);
    if (counter) {
      counter.inc(labels, value);
    }
  }

  /**
   * 设置仪表值
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.set(value, labels);
    }
  }

  /**
   * 记录直方图值
   */
  timing(name: string, value: number, labels?: Record<string, string>): void {
    const histogram = this.histograms.get(name);
    if (histogram) {
      histogram.observe(value, labels);
    }
  }

  /**
   * 获取所有指标
   */
  getAllMetrics(): Map<string, MetricValue[]> {
    const metrics = new Map<string, MetricValue[]>();

    // 收集计数器
    for (const [name, counter] of this.counters.entries()) {
      const values: MetricValue[] = [{
        type: 'counter',
        value: counter.get(),
        timestamp: Date.now()
      }];

      // 收集带标签的计数器
      for (const [key, value] of counter.getLabels().entries()) {
        values.push({
          type: 'counter',
          value,
          timestamp: Date.now(),
          tags: { labels: key }
        });
      }

      metrics.set(name, values);
    }

    // 收集仪表
    for (const [name, gauge] of this.gauges.entries()) {
      const values: MetricValue[] = [{
        type: 'gauge',
        value: gauge.get(),
        timestamp: Date.now()
      }];

      for (const [key, value] of gauge.getLabels().entries()) {
        values.push({
          type: 'gauge',
          value,
          timestamp: Date.now(),
          tags: { labels: key }
        });
      }

      metrics.set(name, values);
    }

    return metrics;
  }

  /**
   * 清除所有指标
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  /**
   * 获取统计摘要
   */
  getSummary(): {
    countersCount: number;
    gaugesCount: number;
    histogramsCount: number;
    metricNames: string[];
  } {
    return {
      countersCount: this.counters.size,
      gaugesCount: this.gauges.size,
      histogramsCount: this.histograms.size,
      metricNames: [
        ...Array.from(this.counters.keys()),
        ...Array.from(this.gauges.keys()),
        ...Array.from(this.histograms.keys())
      ]
    };
  }
}

// 默认指标收集器实例
const defaultCollector = new MetricsCollector();

/**
 * 增加计数器
 */
export function increment(name: string, value: number = 1, labels?: Record<string, string>): void {
  defaultCollector.increment(name, value, labels);
}

/**
 * 设置仪表值
 */
export function setGauge(name: string, value: number, labels?: Record<string, string>): void {
  defaultCollector.setGauge(name, value, labels);
}

/**
 * 记录计时
 */
export function timing(name: string, value: number, labels?: Record<string, string>): void {
  defaultCollector.timing(name, value, labels);
}

/**
 * 获取计数器
 */
export function counter(name: string, options?: CounterOptions): Counter {
  return defaultCollector.counter(name, options);
}

/**
 * 获取仪表
 */
export function gauge(name: string, options?: CounterOptions): Gauge {
  return defaultCollector.gauge(name, options);
}

/**
 * 获取直方图
 */
export function histogram(name: string, options?: HistogramOptions): Histogram {
  return defaultCollector.histogram(name, options);
}

export default MetricsCollector;
