/**
 * Data models for session management
 */

import type { SessionOptions } from '../interfaces/types';

/**
 * Session message structure
 */
export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Session data model
 */
export interface SessionData {
  /** Unique session identifier */
  sessionId: string;
  /** User ID from the IM platform */
  userId: string;
  /** IM platform (feishu, wechat, dingtalk) */
  platform: 'feishu' | 'wechat' | 'dingtalk';
  /** Claude model being used */
  model: string;
  /** Current working directory */
  cwd: string;
  /** Permission mode for tool execution */
  permissionMode: 'bypassPermissions' | 'default';
  /** Session creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Session messages history */
  messages: SessionMessage[];
  /** Session options */
  options: SessionOptions;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * User configuration model
 */
export interface UserConfig {
  /** User ID from the IM platform */
  userId: string;
  /** List of allowed commands (empty means all commands allowed) */
  allowedCommands: string[];
  /** Maximum execution time for commands (in seconds) */
  maxExecutionTime: number;
  /** Trust level for the user */
  trustLevel: 'low' | 'medium' | 'high';
  /** Custom settings */
  settings?: Record<string, any>;
}

/**
 * Storage interface for key-value operations
 */
export interface IStorage {
  /**
   * Get a value by key
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value by key
   */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Delete a value by key
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a key exists
   */
  has(key: string): Promise<boolean>;

  /**
   * Clear all data
   */
  clear?: () => Promise<void>;
}
