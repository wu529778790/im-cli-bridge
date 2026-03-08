/**
 * Storage interface for data persistence
 * Provides a key-value storage abstraction with support for nested paths
 */

import type { IStorage } from './models';

/**
 * Extended storage interface with additional utility methods
 */
export interface IStorageExtended extends IStorage {
  /**
   * Get a value by nested path (e.g., 'sessions.sessionId')
   */
  getByPath<T>(path: string): Promise<T | null>;

  /**
   * Set a value by nested path (e.g., 'sessions.sessionId')
   */
  setByPath<T>(path: string, value: T): Promise<void>;

  /**
   * Delete a value by nested path
   */
  deleteByPath(path: string): Promise<void>;

  /**
   * Get all keys
   */
  keys(): Promise<string[]>;

  /**
   * Get all data
   */
  all(): Promise<Record<string, any>>;
}
