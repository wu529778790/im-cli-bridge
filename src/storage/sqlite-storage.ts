/**
 * SQLite 存储实现
 * 使用 better-sqlite3 提供高性能的键值存储
 */

import Database from 'better-sqlite3';
import { IStorageExtended } from './storage.interface';
import { Logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export interface SqliteStorageConfig {
  /** 数据库文件路径 */
  dbPath?: string;
  /** 是否启用 WAL 模式 */
  enableWAL?: boolean;
  /** 内存模式（用于测试） */
  memory?: boolean;
}

/**
 * SQLite 存储类
 */
export class SqliteStorage implements IStorageExtended {
  private db!: Database.Database;
  private dbPath: string;
  private logger: Logger;
  private initialized: boolean = false;
  private config: Required<SqliteStorageConfig>;

  constructor(config: SqliteStorageConfig = {}) {
    this.logger = new Logger('SqliteStorage');
    this.config = {
      dbPath: config.dbPath || path.join(process.cwd(), 'data', 'storage.db'),
      enableWAL: config.enableWAL !== false,
      memory: config.memory || false
    };
    this.dbPath = this.config.memory ? ':memory:' : this.config.dbPath;
  }

  /**
   * 初始化存储
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // 确保数据目录存在
      if (!this.config.memory) {
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }
      }

      // 创建数据库连接
      this.db = new Database(this.dbPath);

      // 启用 WAL 模式以提高并发性能
      if (this.config.enableWAL) {
        this.db.pragma('journal_mode = WAL');
      }

      // 创建键值存储表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_updated_at ON kv_store(updated_at);
        CREATE INDEX IF NOT EXISTS idx_created_at ON kv_store(created_at);
      `);

      // 创建会话索引表（用于快速列出所有会话）
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS session_index (
          key TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_user_sessions ON session_index(user_id, created_at);
      `);

      this.initialized = true;
      this.logger.info(`SQLite storage initialized (${this.config.memory ? 'memory mode' : this.dbPath})`);
    } catch (error) {
      this.logger.error('Failed to initialize SQLite storage:', error);
      throw error;
    }
  }

  /**
   * 获取值
   */
  async get<T>(key: string): Promise<T | null> {
    this.ensureInitialized();

    try {
      const stmt = this.db.prepare('SELECT value FROM kv_store WHERE key = ?');
      const row = stmt.get(key) as { value: string } | undefined;

      if (!row) {
        return null;
      }

      return JSON.parse(row.value) as T;
    } catch (error) {
      this.logger.error(`Failed to get key '${key}':`, error);
      return null;
    }
  }

  /**
   * 设置值
   */
  async set<T>(key: string, value: T): Promise<void> {
    this.ensureInitialized();

    try {
      const now = Date.now();
      const valueJson = JSON.stringify(value);

      const stmt = this.db.prepare(`
        INSERT INTO kv_store (key, value, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `);

      stmt.run(key, valueJson, now, now);

      // 如果是会话相关的key，更新会话索引
      if (key.startsWith('session:')) {
        this.updateSessionIndex(key, valueJson);
      }
    } catch (error) {
      this.logger.error(`Failed to set key '${key}':`, error);
      throw error;
    }
  }

  /**
   * 删除值
   */
  async delete(key: string): Promise<void> {
    this.ensureInitialized();

    try {
      const stmt = this.db.prepare('DELETE FROM kv_store WHERE key = ?');
      stmt.run(key);

      // 同时删除会话索引
      if (key.startsWith('session:')) {
        const indexStmt = this.db.prepare('DELETE FROM session_index WHERE key = ?');
        indexStmt.run(key);
      }
    } catch (error) {
      this.logger.error(`Failed to delete key '${key}':`, error);
      throw error;
    }
  }

  /**
   * 检查键是否存在
   */
  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  /**
   * 通过路径获取值
   */
  async getByPath<T>(pathStr: string): Promise<T | null> {
    this.ensureInitialized();

    try {
      const keys = pathStr.split('.');
      const rootKey = keys[0];

      const value = await this.get<Record<string, unknown>>(rootKey);
      if (!value) {
        return null;
      }

      let current: unknown = value;
      for (let i = 1; i < keys.length; i++) {
        if (current && typeof current === 'object' && keys[i] in current) {
          current = (current as Record<string, unknown>)[keys[i]];
        } else {
          return null;
        }
      }

      return (current ?? null) as T;
    } catch (error) {
      this.logger.error(`Failed to get path '${pathStr}':`, error);
      return null;
    }
  }

  /**
   * 通过路径设置值
   */
  async setByPath<T>(pathStr: string, value: T): Promise<void> {
    this.ensureInitialized();

    try {
      const keys = pathStr.split('.');
      const rootKey = keys[0];

      // 获取或创建根对象
      let rootObj = await this.get<Record<string, unknown>>(rootKey);
      if (!rootObj) {
        rootObj = {};
      }

      // 导航到父对象
      let current = rootObj;
      for (let i = 1; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!(key in current) || typeof current[key] !== 'object') {
          current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
      }

      // 设置最终值
      current[keys[keys.length - 1]] = value;

      // 保存根对象
      await this.set(rootKey, rootObj);
    } catch (error) {
      this.logger.error(`Failed to set path '${pathStr}':`, error);
      throw error;
    }
  }

  /**
   * 通过路径删除值
   */
  async deleteByPath(pathStr: string): Promise<void> {
    this.ensureInitialized();

    try {
      const keys = pathStr.split('.');
      if (keys.length === 1) {
        await this.delete(keys[0]);
        return;
      }

      const rootKey = keys[0];
      const rootObj = await this.get<Record<string, unknown>>(rootKey);
      if (!rootObj) {
        return;
      }

      // 导航到父对象
      let current = rootObj;
      for (let i = 1; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!(key in current) || typeof current[key] !== 'object') {
          return;
        }
        current = current[key] as Record<string, unknown>;
      }

      // 删除最终值
      delete current[keys[keys.length - 1]];

      // 保存根对象
      await this.set(rootKey, rootObj);
    } catch (error) {
      this.logger.error(`Failed to delete path '${pathStr}':`, error);
      throw error;
    }
  }

  /**
   * 获取所有键
   */
  async keys(pattern?: string): Promise<string[]> {
    this.ensureInitialized();

    try {
      let query = 'SELECT key FROM kv_store';
      const params: string[] = [];

      if (pattern) {
        query += ' WHERE key LIKE ?';
        params.push(pattern);
      }

      const stmt = this.db.prepare(query);
      const rows = stmt.all(...params) as { key: string }[];

      return rows.map(row => row.key);
    } catch (error) {
      this.logger.error('Failed to get keys:', error);
      return [];
    }
  }

  /**
   * 获取所有数据
   */
  async all(): Promise<Record<string, unknown>> {
    this.ensureInitialized();

    try {
      const stmt = this.db.prepare('SELECT key, value FROM kv_store');
      const rows = stmt.all() as { key: string; value: string }[];

      const result: Record<string, unknown> = {};
      for (const row of rows) {
        try {
          result[row.key] = JSON.parse(row.value);
        } catch {
          // 跳过无法解析的值
        }
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to get all:', error);
      return {};
    }
  }

  /**
   * 清空所有数据
   */
  async clear(): Promise<void> {
    this.ensureInitialized();

    try {
      this.db.exec('DELETE FROM kv_store');
      this.db.exec('DELETE FROM session_index');
      this.logger.info('Cleared all data');
    } catch (error) {
      this.logger.error('Failed to clear:', error);
      throw error;
    }
  }

  /**
   * 更新会话索引
   */
  private updateSessionIndex(key: string, valueJson: string): void {
    try {
      const value = JSON.parse(valueJson);
      if (value.userId) {
        const now = Date.now();
        const stmt = this.db.prepare(`
          INSERT INTO session_index (key, user_id, created_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            user_id = excluded.user_id,
            created_at = excluded.created_at
        `);
        stmt.run(key, value.userId, value.createdAt || now);
      }
    } catch (error) {
      // 忽略索引更新失败
    }
  }

  /**
   * 获取用户的所有会话
   */
  async getUserSessions(userId: string): Promise<Array<{ key: string; value: unknown }>> {
    this.ensureInitialized();

    try {
      const stmt = this.db.prepare(`
        SELECT k.key, k.value
        FROM kv_store k
        INNER JOIN session_index s ON k.key = s.key
        WHERE s.user_id = ?
        ORDER BY s.created_at DESC
      `);

      const rows = stmt.all(userId) as { key: string; value: string }[];

      return rows.map(row => ({
        key: row.key,
        value: JSON.parse(row.value)
      }));
    } catch (error) {
      this.logger.error(`Failed to get sessions for user '${userId}':`, error);
      return [];
    }
  }

  /**
   * 清理过期数据
   */
  async cleanup(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    this.ensureInitialized();

    try {
      const cutoffTime = Date.now() - maxAge;

      const stmt = this.db.prepare('DELETE FROM kv_store WHERE updated_at < ?');
      const info = stmt.run(cutoffTime);

      // 同时清理会话索引
      const indexStmt = this.db.prepare(`
        DELETE FROM session_index
        WHERE key NOT IN (SELECT key FROM kv_store)
      `);
      indexStmt.run();

      this.logger.info(`Cleaned up ${info.changes} old records`);
      return info.changes;
    } catch (error) {
      this.logger.error('Failed to cleanup:', error);
      return 0;
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): { dbSize: number; totalKeys: number; } {
    this.ensureInitialized();

    try {
      // 获取键数量
      const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM kv_store');
      const { count } = countStmt.get() as { count: number };

      // 获取数据库大小
      let dbSize = 0;
      if (!this.config.memory) {
        const stats = fs.statSync(this.dbPath);
        dbSize = stats.size;
      }

      return { dbSize, totalKeys: count };
    } catch (error) {
      this.logger.error('Failed to get stats:', error);
      return { dbSize: 0, totalKeys: 0 };
    }
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.initialized = false;
      this.logger.info('SQLite connection closed');
    }
  }

  /**
   * 确保已初始化
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
  }
}

export default SqliteStorage;
