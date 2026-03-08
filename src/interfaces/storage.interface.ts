/**
 * 存储接口定义
 */

/**
 * 会话数据接口
 */
export interface SessionData {
  /** 会话ID */
  sessionId: string;
  /** 用户ID */
  userId: string;
  /** 聊天ID */
  chatId: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 会话状态 */
  status: 'active' | 'idle' | 'closed';
  /** 会话上下文 */
  context?: {
    /** 当前工作目录 */
    workingDirectory?: string;
    /** 环境变量 */
    environment?: Record<string, string>;
    /** 历史命令 */
    commandHistory?: string[];
    /** 自定义数据 */
    [key: string]: any;
  };
  /** 元数据 */
  metadata?: {
    /** 执行次数 */
    executionCount?: number;
    /** 最后活动时间 */
    lastActivityAt?: number;
    /** 扩展字段 */
    [key: string]: any;
  };
}

/**
 * 存储项接口
 */
export interface StorageItem<T = any> {
  /** 键 */
  key: string;
  /** 值 */
  value: T;
  /** 过期时间（毫秒时间戳） */
  expiresAt?: number;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/**
 * 存储查询选项
 */
export interface StorageQueryOptions {
  /** 是否包含过期项 */
  includeExpired?: boolean;
  /** 是否按更新时间排序 */
  sortByUpdated?: boolean;
  /** 限制返回数量 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
}

/**
 * 存储统计信息
 */
export interface StorageStats {
  /** 总项数 */
  totalItems: number;
  /** 活跃会话数 */
  activeSessions: number;
  /** 存储大小（字节） */
  storageSize: number;
  /** 最旧的会话时间 */
  oldestSession?: number;
  /** 最新的会话时间 */
  newestSession?: number;
}

/**
 * 存储接口
 */
export interface Storage {
  /**
   * 获取值
   * @param key 键
   * @returns 值或undefined
   */
  get<T = any>(key: string): Promise<T | undefined>;

  /**
   * 设置值
   * @param key 键
   * @param value 值
   * @param ttl 过期时间（秒）
   */
  set<T = any>(key: string, value: T, ttl?: number): Promise<void>;

  /**
   * 删除值
   * @param key 键
   */
  delete(key: string): Promise<boolean>;

  /**
   * 检查键是否存在
   * @param key 键
   * @returns 是否存在
   */
  has(key: string): Promise<boolean>;

  /**
   * 清空所有数据
   */
  clear(): Promise<void>;

  /**
   * 获取所有键
   * @param pattern 键模式（可选）
   * @returns 键数组
   */
  keys(pattern?: string): Promise<string[]>;

  /**
   * 获取所有值
   * @param options 查询选项
   * @returns 存储项数组
   */
  values<T = any>(options?: StorageQueryOptions): Promise<StorageItem<T>[]>;

  /**
   * 获取存储大小
   * @returns 项数量
   */
  size(): Promise<number>;

  /**
   * 获取统计信息
   * @returns 统计信息
   */
  stats(): Promise<StorageStats>;

  /**
   * 批量设置
   * @param items 键值对数组
   */
  setMany<T = any>(items: Array<{ key: string; value: T; ttl?: number }>): Promise<void>;

  /**
   * 批量获取
   * @param keys 键数组
   * @returns 值数组
   */
  getMany<T = any>(keys: string[]): Promise<(T | undefined)[]>;

  /**
   * 批量删除
   * @param keys 键数组
   * @returns 删除的数量
   */
  deleteMany(keys: string[]): Promise<number>;
}
