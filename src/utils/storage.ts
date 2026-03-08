/**
 * 简单的本地存储工具
 * 使用文件系统持久化数据
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface StorageOptions {
  dataDir?: string;
}

export class Storage<T = any> {
  private dataDir: string;
  private data: Map<string, T> = new Map();

  constructor(private key: string, options: StorageOptions = {}) {
    this.dataDir = options.dataDir || path.join(process.cwd(), 'data');
  }

  /**
   * 初始化存储，从文件加载数据
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const filePath = this.getFilePath();
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      this.data = new Map(Object.entries(data));
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`Failed to load storage for ${this.key}:`, error);
      }
      this.data = new Map();
    }
  }

  /**
   * 保存数据到文件
   */
  async save(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const filePath = this.getFilePath();
      const data = Object.fromEntries(this.data);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Failed to save storage for ${this.key}:`, error);
      throw error;
    }
  }

  /**
   * 获取值
   */
  get(key: string): T | undefined {
    return this.data.get(key);
  }

  /**
   * 设置值
   */
  async set(key: string, value: T): Promise<void> {
    this.data.set(key, value);
    await this.save();
  }

  /**
   * 删除值
   */
  async delete(key: string): Promise<void> {
    this.data.delete(key);
    await this.save();
  }

  /**
   * 检查键是否存在
   */
  has(key: string): boolean {
    return this.data.has(key);
  }

  /**
   * 获取所有键
   */
  keys(): string[] {
    return Array.from(this.data.keys());
  }

  /**
   * 获取所有值
   */
  values(): T[] {
    return Array.from(this.data.values());
  }

  /**
   * 清空所有数据
   */
  async clear(): Promise<void> {
    this.data.clear();
    await this.save();
  }

  /**
   * 获取数据数量
   */
  size(): number {
    return this.data.size;
  }

  /**
   * 获取存储文件路径
   */
  private getFilePath(): string {
    return path.join(this.dataDir, `${this.key}.json`);
  }
}
