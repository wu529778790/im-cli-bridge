/**
 * File-based storage implementation using JSON
 * Stores data in ~/.im-cli-bridge/data.json
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { IStorageExtended } from './storage.interface';

/**
 * FileStorage implements storage interface using a JSON file
 */
export class FileStorage implements IStorageExtended {
  private dataPath: string;
  private dataDir: string;
  private data: Record<string, any> = {};
  private initialized: boolean = false;

  constructor(dataPath?: string) {
    this.dataDir = dataPath || path.join(os.homedir(), '.im-cli-bridge');
    this.dataPath = path.join(this.dataDir, 'data.json');
  }

  /**
   * Initialize the storage by ensuring directory and file exist
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Ensure directory exists
      await fs.mkdir(this.dataDir, { recursive: true });

      // Try to read existing data
      try {
        const content = await fs.readFile(this.dataPath, 'utf-8');
        this.data = JSON.parse(content);
      } catch (error) {
        // File doesn't exist or is invalid, start with empty data
        this.data = {};
        await this.save();
      }

      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize storage: ${error}`);
    }
  }

  /**
   * Save data to file
   */
  private async save(): Promise<void> {
    try {
      const content = JSON.stringify(this.data, null, 2);
      await fs.writeFile(this.dataPath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save data: ${error}`);
    }
  }

  /**
   * Get a value by key
   */
  async get<T>(key: string): Promise<T | null> {
    await this.initialize();
    return this.data[key] ?? null;
  }

  /**
   * Set a value by key
   */
  async set<T>(key: string, value: T): Promise<void> {
    await this.initialize();
    this.data[key] = value;
    await this.save();
  }

  /**
   * Delete a value by key
   */
  async delete(key: string): Promise<void> {
    await this.initialize();
    delete this.data[key];
    await this.save();
  }

  /**
   * Check if a key exists
   */
  async has(key: string): Promise<boolean> {
    await this.initialize();
    return key in this.data;
  }

  /**
   * Get a value by nested path (e.g., 'sessions.sessionId')
   */
  async getByPath<T>(path: string): Promise<T | null> {
    await this.initialize();
    const keys = path.split('.');
    let current: any = this.data;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return null;
      }
    }

    return current ?? null;
  }

  /**
   * Set a value by nested path (e.g., 'sessions.sessionId')
   */
  async setByPath<T>(path: string, value: T): Promise<void> {
    await this.initialize();
    const keys = path.split('.');
    let current: any = this.data;

    // Navigate to the parent object, creating intermediate objects if needed
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    // Set the final key
    current[keys[keys.length - 1]] = value;
    await this.save();
  }

  /**
   * Delete a value by nested path
   */
  async deleteByPath(path: string): Promise<void> {
    await this.initialize();
    const keys = path.split('.');
    let current: any = this.data;

    // Navigate to the parent object
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        return; // Path doesn't exist, nothing to delete
      }
      current = current[key];
    }

    // Delete the final key
    delete current[keys[keys.length - 1]];
    await this.save();
  }

  /**
   * Get all keys
   */
  async keys(): Promise<string[]> {
    await this.initialize();
    return Object.keys(this.data);
  }

  /**
   * Get all data
   */
  async all(): Promise<Record<string, any>> {
    await this.initialize();
    return { ...this.data };
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    await this.initialize();
    this.data = {};
    await this.save();
  }
}
