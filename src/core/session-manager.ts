/**
 * 会话管理器 - 管理用户会话
 */

import { v4 as uuidv4 } from 'uuid';
import { Session, SessionOptions } from '../interfaces/types';
import { SessionData, IStorage } from '../storage/models';
import { Logger } from '../utils/logger';
import * as path from 'path';
import * as os from 'os';

export class SessionManager {
  private logger: Logger;
  private storage: IStorage;
  private sessions: Map<string, SessionData> = new Map();
  private userSessions: Map<string, string> = new Map(); // userId -> sessionId

  constructor(storage: IStorage) {
    this.logger = new Logger('SessionManager');
    this.storage = storage;
  }

  /**
   * 初始化会话管理器
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing session manager...');
    // 可以在这里加载持久化的会话数据
    await this.loadSessions();
    this.logger.info(`Session manager initialized with ${this.sessions.size} sessions`);
  }

  /**
   * 创建新会话
   * @param userId 用户ID
   * @param options 会话选项
   */
  async createSession(userId: string, options?: SessionOptions): Promise<SessionData> {
    const sessionId = uuidv4();
    const now = Date.now();

    const sessionData: SessionData = {
      sessionId,
      userId,
      platform: 'feishu', // 默认平台，可以根据需要调整
      model: options?.model || 'claude-3-5-sonnet-20241022',
      cwd: options?.workingDirectory || os.homedir(),
      permissionMode: 'bypassPermissions',
      createdAt: now,
      updatedAt: now,
      messages: [],
      options: options || {},
      metadata: {}
    };

    // 保存到内存
    this.sessions.set(sessionId, sessionData);
    this.userSessions.set(userId, sessionId);

    // 持久化
    await this.saveSession(sessionId);

    this.logger.info(`Created new session ${sessionId} for user ${userId}`);
    return sessionData;
  }

  /**
   * 获取用户的当前会话
   * @param userId 用户ID
   */
  getCurrentSession(userId: string): SessionData | null {
    const sessionId = this.userSessions.get(userId);
    if (!sessionId) {
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      // 清理无效的映射
      this.userSessions.delete(userId);
      return null;
    }

    return session;
  }

  /**
   * 获取指定会话
   * @param sessionId 会话ID
   */
  getSession(sessionId: string): SessionData | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * 更新会话
   * @param sessionId 会话ID
   * @param updates 更新内容
   */
  async updateSession(sessionId: string, updates: Partial<SessionData>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // 更新会话数据
    Object.assign(session, updates, {
      updatedAt: Date.now()
    });

    // 持久化
    await this.saveSession(sessionId);

    this.logger.debug(`Updated session ${sessionId}`);
  }

  /**
   * 添加消息到会话
   * @param sessionId 会话ID
   * @param role 消息角色
   * @param content 消息内容
   */
  async addMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const message = {
      role,
      content,
      timestamp: Date.now()
    };

    session.messages.push(message);
    session.updatedAt = Date.now();

    // 持久化
    await this.saveSession(sessionId);

    this.logger.debug(`Added ${role} message to session ${sessionId}`);
  }

  /**
   * 清空会话消息
   * @param sessionId 会话ID
   */
  async clearMessages(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.messages = [];
    session.updatedAt = Date.now();

    // 持久化
    await this.saveSession(sessionId);

    this.logger.info(`Cleared messages in session ${sessionId}`);
  }

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // 从用户会话映射中移除
    this.userSessions.delete(session.userId);

    // 从内存中移除
    this.sessions.delete(sessionId);

    // 从存储中删除
    await this.storage.delete(`session:${sessionId}`);

    this.logger.info(`Deleted session ${sessionId}`);
  }

  /**
   * 恢复历史会话
   * @param userId 用户ID
   * @param sessionId 会话ID
   */
  async resumeSession(userId: string, sessionId: string): Promise<SessionData> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.userId !== userId) {
      throw new Error(`Session ${sessionId} does not belong to user ${userId}`);
    }

    // 设置为用户的当前会话
    this.userSessions.set(userId, sessionId);

    this.logger.info(`Resumed session ${sessionId} for user ${userId}`);
    return session;
  }

  /**
   * 获取用户的所有会话
   * @param userId 用户ID
   */
  getUserSessions(userId: string): SessionData[] {
    const userSessions: SessionData[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        userSessions.push(session);
      }
    }
    return userSessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * 获取会话状态信息
   * @param sessionId 会话ID
   */
  getSessionStatus(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return 'Session not found';
    }

    return [
      `Session ID: ${session.sessionId}`,
      `User: ${session.userId}`,
      `Model: ${session.model}`,
      `Working Directory: ${session.cwd}`,
      `Messages: ${session.messages.length}`,
      `Created: ${new Date(session.createdAt).toLocaleString()}`,
      `Updated: ${new Date(session.updatedAt).toLocaleString()}`
    ].join('\n');
  }

  /**
   * 持久化会话到存储
   * @param sessionId 会话ID
   */
  private async saveSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      await this.storage.set(`session:${sessionId}`, session);
    } catch (error) {
      this.logger.error(`Failed to save session ${sessionId}:`, error);
    }
  }

  /**
   * 从存储加载会话
   */
  private async loadSessions(): Promise<void> {
    try {
      // 这里需要根据实际的存储实现来加载所有会话
      // 由于IStorage接口没有列举键的方法，我们需要依赖其他机制
      // 可以使用一个索引来跟踪所有会话ID

      const sessionIndex = await this.storage.get<string[]>('session:index');
      if (!sessionIndex) {
        return;
      }

      for (const sessionId of sessionIndex) {
        const session = await this.storage.get<SessionData>(`session:${sessionId}`);
        if (session) {
          this.sessions.set(sessionId, session);
          this.userSessions.set(session.userId, sessionId);
        }
      }
    } catch (error) {
      this.logger.error('Failed to load sessions:', error);
    }
  }

  /**
   * 更新会话索引
   */
  private async updateSessionIndex(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await this.storage.set('session:index', sessionIds);
  }

  /**
   * 清理过期会话
   * @param maxAge 最大年龄(毫秒)
   */
  async cleanupOldSessions(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.updatedAt > maxAge) {
        toDelete.push(sessionId);
      }
    }

    for (const sessionId of toDelete) {
      await this.deleteSession(sessionId);
    }

    if (toDelete.length > 0) {
      this.logger.info(`Cleaned up ${toDelete.length} old sessions`);
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): { totalSessions: number; totalMessages: number } {
    let totalMessages = 0;
    for (const session of this.sessions.values()) {
      totalMessages += session.messages.length;
    }

    return {
      totalSessions: this.sessions.size,
      totalMessages
    };
  }
}
