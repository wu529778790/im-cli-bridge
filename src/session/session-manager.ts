import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve, win32 } from 'node:path';
import { createLogger } from '../logger.js';
import { APP_HOME } from '../constants.js';

const log = createLogger('Session');
const SESSIONS_FILE = join(APP_HOME, 'data', 'sessions.json');

type ToolId = 'claude' | 'codex' | 'codebuddy';
type ToolSessionIds = Partial<Record<ToolId, string>>;

interface UserSession {
  sessionIds?: ToolSessionIds;
  workDir: string;
  activeConvId?: string;
  totalTurns?: number;
  claudeModel?: string;
  threads?: Record<string, { sessionIds?: ToolSessionIds; totalTurns?: number; claudeModel?: string }>;
}

export function resolveWorkDirInput(baseDir: string, targetDir: string): string {
  const drivePathMatch = targetDir.match(/^([a-zA-Z]):(.*)$/);
  if (drivePathMatch) {
    const [, drive, rest] = drivePathMatch;
    if (rest === '') return `${drive}:\\`;
    if (rest.startsWith('/') || rest.startsWith('\\')) return win32.normalize(`${drive}:${rest}`);
    return win32.resolve(`${drive}:\\`, rest);
  }

  if (targetDir === '~' || targetDir.startsWith('~/')) {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    return join(home, targetDir.slice(1));
  }

  if (targetDir.startsWith('/') || (targetDir.length >= 3 && targetDir[1] === ':' && (targetDir[2] === '\\' || targetDir[2] === '/'))) {
    return targetDir;
  }

  return resolve(baseDir, targetDir);
}

export class SessionManager {
  private sessions = new Map<string, UserSession>();
  private convSessionMap = new Map<string, string>();
  private defaultWorkDir: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param defaultWorkDir 本次进程的默认工作目录（通常为进程启动时的 cwd）
   * @param previousDefaultWorkDir 旧版本/旧配置使用的默认目录（用于迁移仍跟随默认值的会话）
   */
  constructor(defaultWorkDir: string, previousDefaultWorkDir?: string) {
    this.defaultWorkDir = defaultWorkDir;
    this.load(previousDefaultWorkDir);
  }

  getSessionIdForConv(userId: string, convId: string, toolId: ToolId): string | undefined {
    const s = this.sessions.get(userId);
    if (s?.activeConvId === convId) return this.getToolSessionId(s, toolId);
    return this.convSessionMap.get(this.getConvSessionKey(userId, convId, toolId));
  }

  setSessionIdForConv(userId: string, convId: string, toolId: ToolId, sessionId: string): void {
    const s = this.sessions.get(userId);
    if (s?.activeConvId === convId) {
      this.setToolSessionId(s, toolId, sessionId);
      this.save();
    } else {
      this.convSessionMap.set(this.getConvSessionKey(userId, convId, toolId), sessionId);
    }
  }

  /** 清除指定会话的 sessionId（用于 SDK 报 "No conversation found" 时） */
  clearSessionForConv(userId: string, convId: string, toolId: ToolId): void {
    const s = this.sessions.get(userId);
    if (s?.activeConvId === convId) {
      this.clearToolSessionId(s, toolId);
      this.save();
    }
    this.convSessionMap.delete(this.getConvSessionKey(userId, convId, toolId));
    log.info(`Cleared ${toolId} session for user ${userId}, convId=${convId}`);
  }

  getSessionIdForThread(_userId: string, _threadId: string, _toolId: ToolId): string | undefined {
    return undefined;
  }

  setSessionIdForThread(userId: string, threadId: string, toolId: ToolId, sessionId: string): void {
    const s = this.sessions.get(userId);
    if (s && !s.threads) s.threads = {};
    const t = s?.threads?.[threadId];
    if (t) {
      if (!t.sessionIds) t.sessionIds = {};
      t.sessionIds[toolId] = sessionId;
      this.save();
    }
  }

  getWorkDir(userId: string): string {
    return this.sessions.get(userId)?.workDir ?? this.defaultWorkDir;
  }

  hasUserSession(userId: string): boolean {
    return this.sessions.has(userId);
  }

  getConvId(userId: string): string {
    const s = this.sessions.get(userId);
    if (s) {
      if (!s.activeConvId) {
        s.activeConvId = randomBytes(4).toString('hex');
        this.save();
      }
      return s.activeConvId;
    }
    const convId = randomBytes(4).toString('hex');
    this.sessions.set(userId, { workDir: this.defaultWorkDir, activeConvId: convId });
    this.save();
    return convId;
  }

  async setWorkDir(userId: string, workDir: string): Promise<string> {
    const currentDir = this.getWorkDir(userId);
    const realPath = await this.resolveAndValidate(currentDir, workDir);
    const s = this.sessions.get(userId);
    if (s) {
      const oldConvId = s.activeConvId;
      this.persistActiveConvSessions(userId, s);
      s.workDir = realPath;
      s.sessionIds = {};
      s.activeConvId = randomBytes(4).toString('hex');
      if (oldConvId) {
        this.clearConvSessionMappings(userId, oldConvId);
      }
    } else {
      this.sessions.set(userId, {
        workDir: realPath,
        activeConvId: randomBytes(4).toString('hex'),
      });
    }
    this.flushSync();
    log.info(`WorkDir changed for user ${userId}: ${realPath}, oldConvId=${s?.activeConvId}`);
    return realPath;
  }

  /**
   * 服务启动时调用：清除所有用户的 CLI sessionId。
   * Codex/CodeBuddy 的 session 是进程级别的，服务重启后旧 session 一定无效。
   */
  clearAllCliSessionIds(): void {
    let changed = false;
    for (const [, s] of this.sessions) {
      for (const toolId of ['codex', 'codebuddy'] as const) {
        if (this.getToolSessionId(s, toolId) !== undefined) {
          this.clearToolSessionId(s, toolId);
          changed = true;
        }
      }
      if (s.threads) {
        for (const t of Object.values(s.threads)) {
          for (const toolId of ['codex', 'codebuddy'] as const) {
            if (t.sessionIds?.[toolId] !== undefined) {
              delete t.sessionIds[toolId];
              changed = true;
            }
          }
        }
      }
    }
    for (const key of [...this.convSessionMap.keys()]) {
      if (key.endsWith(':codex') || key.endsWith(':codebuddy')) {
        this.convSessionMap.delete(key);
        changed = true;
      }
    }
    if (changed) {
      this.flushSync();
      log.info('Cleared CLI session IDs for codex/codebuddy on startup');
    }
  }

  newSession(userId: string): boolean {
    const s = this.sessions.get(userId);
    if (s) {
      const oldSessionIds = { ...(s.sessionIds ?? {}) };
      const oldConvId = s.activeConvId;
      this.persistActiveConvSessions(userId, s);
      s.sessionIds = {};
      s.activeConvId = randomBytes(4).toString('hex');
      s.totalTurns = 0;
      if (oldConvId) {
        this.clearConvSessionMappings(userId, oldConvId);
      }
      this.flushSync();
      log.info(
        `New session for user ${userId}: oldConvId=${oldConvId}, oldSessionIds=${JSON.stringify(oldSessionIds)}, newConvId=${s.activeConvId}, sessionIds={}`
      );
      return true;
    }
    return false;
  }

  clearActiveToolSession(userId: string, toolId: ToolId): boolean {
    const s = this.sessions.get(userId);
    if (!s) return false;

    const activeConvId = s.activeConvId;
    const hadSession = this.getToolSessionId(s, toolId) !== undefined;
    this.clearToolSessionId(s, toolId);
    if (activeConvId) {
      this.convSessionMap.delete(this.getConvSessionKey(userId, activeConvId, toolId));
    }
    this.flushSync();
    log.info(`Cleared active ${toolId} session for user ${userId}, convId=${activeConvId ?? 'none'}`);
    return hadSession;
  }

  addTurns(userId: string, turns: number): number {
    const s = this.sessions.get(userId);
    if (!s) return 0;
    s.totalTurns = (s.totalTurns ?? 0) + turns;
    this.save();
    return s.totalTurns;
  }

  addTurnsForThread(userId: string, threadId: string, turns: number): number {
    const s = this.sessions.get(userId);
    const t = s?.threads?.[threadId];
    if (!t) return 0;
    t.totalTurns = (t.totalTurns ?? 0) + turns;
    this.save();
    return t.totalTurns;
  }

  getModel(userId: string, threadId?: string): string | undefined {
    const s = this.sessions.get(userId);
    if (threadId) {
      const t = s?.threads?.[threadId];
      if (t?.claudeModel) return t.claudeModel;
    }
    return s?.claudeModel;
  }

  setModel(userId: string, model: string | undefined, threadId?: string): void {
    const s = this.sessions.get(userId);
    if (threadId) {
      const t = s?.threads?.[threadId];
      if (t) {
        t.claudeModel = model;
        this.save();
        return;
      }
    }
    if (s) s.claudeModel = model;
    else this.sessions.set(userId, { workDir: this.defaultWorkDir, activeConvId: randomBytes(4).toString('hex'), claudeModel: model });
    this.save();
  }

  private async resolveAndValidate(baseDir: string, targetDir: string): Promise<string> {
    const resolved = resolveWorkDirInput(baseDir, targetDir);
    if (!existsSync(resolved)) throw new Error(`目录不存在: \`${resolved}\``);
    const real = await realpath(resolved);
    // Block access to sensitive system directories
    const blockedPrefixes = process.platform === 'win32'
      ? ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData']
      : ['/etc', '/proc', '/sys', '/dev', '/boot', '/root', '/sbin', '/usr/sbin'];
    for (const prefix of blockedPrefixes) {
      if (real.toLowerCase().startsWith(prefix.toLowerCase())) {
        throw new Error(`不允许访问系统目录: \`${real}\``);
      }
    }
    return real;
  }

  private load(previousDefaultWorkDir?: string): void {
    try {
      if (existsSync(SESSIONS_FILE)) {
        const data = JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8')) as Record<string, UserSession>;
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v.workDir === 'string') {
            // 如果该会话目录等于旧默认目录，则迁移到新的默认目录（认为用户没有手动 /cd 过）
            if (previousDefaultWorkDir && v.workDir === previousDefaultWorkDir) {
              v.workDir = this.defaultWorkDir;
            }
            if (!v.activeConvId) v.activeConvId = randomBytes(4).toString('hex');
            if (!v.sessionIds) v.sessionIds = {};
            if ('sessionId' in (v as object)) {
              log.warn(`Legacy shared sessionId found for user ${k}; clearing it to avoid cross-tool resume conflicts`);
            }
            delete (v as UserSession & { sessionId?: string }).sessionId;
            if (v.threads) {
              for (const thread of Object.values(v.threads)) {
                if (!thread.sessionIds) thread.sessionIds = {};
                if ('sessionId' in (thread as object)) {
                  log.warn(`Legacy thread sessionId found for user ${k}; clearing it during session migration`);
                }
                delete (thread as { sessionId?: string }).sessionId;
              }
            }
            this.sessions.set(k, v);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  private save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.doFlush();
    }, 500);
  }

  private flushSync(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.doFlush();
  }

  destroy(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.doFlush();
  }

  private doFlush(): void {
    try {
      const dir = dirname(SESSIONS_FILE);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const obj: Record<string, UserSession> = {};
      for (const [k, v] of this.sessions) obj[k] = v;
      writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      log.error('Failed to save sessions:', err);
    }
  }

  private getConvSessionKey(userId: string, convId: string, toolId: ToolId): string {
    return `${userId}:${convId}:${toolId}`;
  }

  private getToolSessionId(session: UserSession, toolId: ToolId): string | undefined {
    return session.sessionIds?.[toolId];
  }

  private setToolSessionId(session: UserSession, toolId: ToolId, sessionId: string): void {
    if (!session.sessionIds) session.sessionIds = {};
    session.sessionIds[toolId] = sessionId;
  }

  private clearToolSessionId(session: UserSession, toolId: ToolId): void {
    if (!session.sessionIds) return;
    delete session.sessionIds[toolId];
  }

  private persistActiveConvSessions(userId: string, session: UserSession): void {
    if (!session.activeConvId || !session.sessionIds) return;
    for (const [toolId, sessionId] of Object.entries(session.sessionIds)) {
      if (sessionId) {
        this.convSessionMap.set(this.getConvSessionKey(userId, session.activeConvId, toolId as ToolId), sessionId);
      }
    }
  }

  private clearConvSessionMappings(userId: string, convId: string): void {
    for (const toolId of ['claude', 'codex', 'codebuddy'] as const) {
      this.convSessionMap.delete(this.getConvSessionKey(userId, convId, toolId));
    }
  }
}
