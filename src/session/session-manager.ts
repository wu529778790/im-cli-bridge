import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { createLogger } from '../logger.js';
import { APP_HOME } from '../constants.js';

const log = createLogger('Session');
const SESSIONS_FILE = join(APP_HOME, 'data', 'sessions.json');

interface UserSession {
  sessionId?: string;
  workDir: string;
  activeConvId?: string;
  totalTurns?: number;
  claudeModel?: string;
  threads?: Record<string, { sessionId?: string; totalTurns?: number; claudeModel?: string }>;
}

export class SessionManager {
  private sessions = new Map<string, UserSession>();
  private convSessionMap = new Map<string, string>();
  private defaultWorkDir: string;
  private allowedBaseDirs: string[];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(defaultWorkDir: string, allowedBaseDirs: string[]) {
    this.defaultWorkDir = defaultWorkDir;
    this.allowedBaseDirs = allowedBaseDirs;
    this.load();
  }

  getSessionIdForConv(userId: string, convId: string): string | undefined {
    const s = this.sessions.get(userId);
    if (s?.activeConvId === convId) return s.sessionId;
    return this.convSessionMap.get(`${userId}:${convId}`);
  }

  setSessionIdForConv(userId: string, convId: string, sessionId: string): void {
    const s = this.sessions.get(userId);
    if (s?.activeConvId === convId) {
      s.sessionId = sessionId;
      this.save();
    } else {
      this.convSessionMap.set(`${userId}:${convId}`, sessionId);
    }
  }

  getSessionIdForThread(_userId: string, _threadId: string): string | undefined {
    return undefined;
  }

  setSessionIdForThread(userId: string, threadId: string, sessionId: string): void {
    const s = this.sessions.get(userId);
    if (s && !s.threads) s.threads = {};
    const t = s?.threads?.[threadId];
    if (t) {
      t.sessionId = sessionId;
      this.save();
    }
  }

  getWorkDir(userId: string): string {
    return this.sessions.get(userId)?.workDir ?? this.defaultWorkDir;
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
      if (s.activeConvId && s.sessionId) {
        this.convSessionMap.set(`${userId}:${s.activeConvId}`, s.sessionId);
      }
      s.workDir = realPath;
      s.sessionId = undefined;
      s.activeConvId = randomBytes(4).toString('hex');
      // 清除旧的 convSessionMap 中的映射
      if (oldConvId) {
        this.convSessionMap.delete(`${userId}:${oldConvId}`);
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

  newSession(userId: string): boolean {
    const s = this.sessions.get(userId);
    if (s) {
      const oldSessionId = s.sessionId;
      const oldConvId = s.activeConvId;
      if (s.activeConvId && s.sessionId) {
        this.convSessionMap.set(`${userId}:${s.activeConvId}`, s.sessionId);
      }
      s.sessionId = undefined;
      s.activeConvId = randomBytes(4).toString('hex');
      s.totalTurns = 0;
      // 清除旧的 convSessionMap 中的映射，防止恢复旧的 sessionId
      if (oldConvId) {
        this.convSessionMap.delete(`${userId}:${oldConvId}`);
      }
      this.flushSync();
      log.info(`New session for user ${userId}: oldConvId=${oldConvId}, oldSessionId=${oldSessionId}, newConvId=${s.activeConvId}, sessionId=undefined`);
      return true;
    }
    return false;
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
    let resolved: string;

    // 处理 Windows 驱动器路径 (如 d:, d:/path, d:\path)
    const drivePathMatch = targetDir.match(/^([a-zA-Z]):(.*)$/);
    if (drivePathMatch) {
      const [, drive, rest] = drivePathMatch;
      // 使用 resolve 确保路径格式正确
      // 如果 rest 为空，则是驱动器根目录
      // 如果 rest 不为空，resolve 会正确处理斜杠
      const driveRoot = `${drive}:`;
      if (rest === '') {
        resolved = driveRoot;
      } else if (rest.startsWith('/') || rest.startsWith('\\')) {
        // 已是绝对路径，直接使用
        resolved = `${drive}${rest}`;
      } else {
        // 相对于驱动器根目录的路径，使用 resolve 处理
        resolved = resolve(driveRoot, rest);
      }
    } else if (targetDir === '~' || targetDir.startsWith('~/')) {
      // 处理家目录
      const home = process.env.USERPROFILE || process.env.HOME || '';
      resolved = join(home, targetDir.slice(1));
    } else if (targetDir.startsWith('/') || (targetDir.length >= 3 && targetDir[1] === ':' && (targetDir[2] === '\\' || targetDir[2] === '/'))) {
      // 绝对路径（包括 Windows 绝对路径）
      resolved = targetDir;
    } else {
      // 相对路径
      resolved = resolve(baseDir, targetDir);
    }

    if (!existsSync(resolved)) throw new Error(`目录不存在: ${resolved}`);
    const realPath = await realpath(resolved);
    const allowed = this.allowedBaseDirs.some(
      (base) => realPath === base || realPath.startsWith(base + '/') || realPath.startsWith(base + '\\')
    );
    if (!allowed) throw new Error(`目录不在允许范围内: ${realPath}`);
    return realPath;
  }

  private load(): void {
    try {
      if (existsSync(SESSIONS_FILE)) {
        const data = JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8')) as Record<string, UserSession>;
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v.workDir === 'string') {
            if (!v.activeConvId) v.activeConvId = randomBytes(4).toString('hex');
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
}
