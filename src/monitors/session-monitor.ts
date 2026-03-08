/**
 * Session 监控 - 轮询 Claude JSONL，按字节偏移增量读取
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { TranscriptParser, ParsedEntry } from './transcript-parser';
import { getSessionMapPath, getClaudeProjectsPath } from '../utils/config-path';

export interface NewMessage {
  sessionId: string;
  windowId: string;
  text: string;
  role: 'user' | 'assistant';
  isComplete: boolean;
}

interface TrackedSession {
  sessionId: string;
  filePath: string;
  lastByteOffset: number;
}

interface SessionMapEntry {
  session_id: string;
  cwd?: string;
  window_name?: string;
}

export type NewMessageCallback = (msg: NewMessage) => void | Promise<void>;

export class SessionMonitor {
  private sessionName: string;
  private projectsPath: string;
  private sessionMapPath: string;
  private pollIntervalMs: number;
  private logger: Logger;
  private tracked: Map<string, TrackedSession> = new Map();
  private running = false;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private callback: NewMessageCallback | null = null;
  private windowToSession: Map<string, string> = new Map();
  private listWindows: () => Promise<Array<{ windowId: string; cwd: string }>>;

  constructor(options: {
    sessionName?: string;
    projectsPath?: string;
    sessionMapPath?: string;
    pollIntervalSec?: number;
    listWindows: () => Promise<Array<{ windowId: string; cwd: string }>>;
  }) {
    this.sessionName = options.sessionName || process.env.TMUX_SESSION_NAME || 'im-cli-bridge';
    this.projectsPath = options.projectsPath || getClaudeProjectsPath();
    this.sessionMapPath = options.sessionMapPath || getSessionMapPath();
    this.pollIntervalMs = (options.pollIntervalSec ?? 2) * 1000;
    this.listWindows = options.listWindows;
    this.logger = new Logger('SessionMonitor');
  }

  setMessageCallback(cb: NewMessageCallback): void {
    this.callback = cb;
  }

  private loadSessionMap(): Map<string, string> {
    const out = new Map<string, string>();
    try {
      const raw = fs.readFileSync(this.sessionMapPath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, SessionMapEntry>;
      const prefix = `${this.sessionName}:`;
      for (const [key, info] of Object.entries(data)) {
        if (!key.startsWith(prefix) || !info?.session_id) continue;
        const windowId = key.slice(prefix.length);
        out.set(windowId, info.session_id);
      }
    } catch {
      // no session map yet
    }
    return out;
  }

  private async getActiveCwds(): Promise<Set<string>> {
    const windows = await this.listWindows();
    const cwds = new Set<string>();
    for (const w of windows) {
      try {
        cwds.add(path.resolve(w.cwd));
      } catch {
        cwds.add(w.cwd);
      }
    }
    return cwds;
  }

  private async scanSessions(): Promise<Array<{ sessionId: string; filePath: string }>> {
    const activeCwds = await this.getActiveCwds();
    if (activeCwds.size === 0) return [];

    const result: Array<{ sessionId: string; filePath: string }> = [];

    if (!fs.existsSync(this.projectsPath)) return [];

    const dirs = fs.readdirSync(this.projectsPath);
    for (const dirName of dirs) {
      const projectDir = path.join(this.projectsPath, dirName);
      const stat = fs.statSync(projectDir);
      if (!stat.isDirectory()) continue;

      const indexPath = path.join(projectDir, 'sessions-index.json');
      let originalPath = '';
      const indexedIds = new Set<string>();

      if (fs.existsSync(indexPath)) {
        try {
          const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
          originalPath = indexData.originalPath || '';
          const entries = indexData.entries || [];
          for (const e of entries) {
            const sessionId = e.sessionId || '';
            const fullPath = e.fullPath || '';
            const projectPath = e.projectPath || originalPath;
            if (!sessionId || !fullPath) continue;
            let normPp: string;
            try {
              normPp = path.resolve(projectPath);
            } catch {
              normPp = projectPath;
            }
            if (!activeCwds.has(normPp)) continue;
            indexedIds.add(sessionId);
            const fp = path.resolve(projectDir, fullPath);
            if (fs.existsSync(fp)) {
              result.push({ sessionId, filePath: fp });
            }
          }
        } catch (e) {
          this.logger.debug('Error reading sessions-index', e);
        }
      }

      const jsonlFiles = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
      for (const f of jsonlFiles) {
        const sessionId = path.basename(f, '.jsonl');
        if (indexedIds.has(sessionId)) continue;
        const fp = path.join(projectDir, f);
        result.push({ sessionId, filePath: fp });
      }
    }

    return result;
  }

  private readNewLines(
    tracked: TrackedSession
  ): { entries: Record<string, unknown>[]; newOffset: number } {
    const entries: Record<string, unknown>[] = [];
    let newOffset = tracked.lastByteOffset;

    try {
      const fd = fs.openSync(tracked.filePath, 'r');
      const size = fs.statSync(tracked.filePath).size;

      if (tracked.lastByteOffset > size) {
        fs.closeSync(fd);
        return { entries, newOffset: 0 };
      }

      const buf = Buffer.alloc(size - tracked.lastByteOffset);
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, tracked.lastByteOffset) as number;
      fs.closeSync(fd);

      const chunk = buf.slice(0, bytesRead).toString('utf-8');
      const lines = chunk.split('\n');
      let offset = tracked.lastByteOffset;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineWithNewline = i < lines.length - 1 ? line + '\n' : line;
        const lineLen = Buffer.byteLength(lineWithNewline, 'utf-8');

        const parsed = TranscriptParser.parseLine(line);
        if (parsed) {
          entries.push(parsed);
          newOffset = offset + lineLen;
        } else if (line.trim()) {
          break;
        }
        offset += lineLen;
      }
    } catch (e) {
      this.logger.debug('readNewLines error', e);
    }

    return { entries, newOffset };
  }

  private sessionIdToWindowId(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [wid, sid] of this.windowToSession) {
      out.set(sid, wid);
    }
    return out;
  }

  private async poll(): Promise<void> {
    this.windowToSession = this.loadSessionMap();
    const activeSessionIds = new Set(this.windowToSession.values());
    if (activeSessionIds.size === 0) return;

    const sessions = await this.scanSessions();
    const sidToWid = this.sessionIdToWindowId();

    for (const { sessionId, filePath } of sessions) {
      if (!activeSessionIds.has(sessionId)) continue;

      let tracked = this.tracked.get(sessionId);
      if (!tracked) {
        let fileSize = 0;
        try {
          fileSize = fs.statSync(filePath).size;
        } catch {
          fileSize = 0;
        }
        tracked = { sessionId, filePath, lastByteOffset: fileSize };
        this.tracked.set(sessionId, tracked);
        this.logger.debug(`Started tracking session ${sessionId}`);
        continue;
      }

      const st = fs.statSync(filePath);
      const prevMtime = (tracked as any)._mtime ?? 0;
      if (st.size <= tracked.lastByteOffset && st.mtimeMs <= prevMtime) continue;
      (tracked as any)._mtime = st.mtimeMs;

      const { entries, newOffset } = this.readNewLines(tracked);
      tracked.lastByteOffset = newOffset;

      if (entries.length === 0) continue;

      const parsed = TranscriptParser.parseEntries(entries);
      const windowId = sidToWid.get(sessionId) || '';

      for (const p of parsed) {
        if (!p.text) continue;
        if (p.role === 'user') continue;
        const msg: NewMessage = {
          sessionId,
          windowId,
          text: p.text,
          role: p.role,
          isComplete: true
        };
        if (this.callback) {
          try {
            await this.callback(msg);
          } catch (e) {
            this.logger.error('Message callback error', e);
          }
        }
      }
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.info(`Session monitor started, polling every ${this.pollIntervalMs / 1000}s`);
    this.timerId = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.logger.info('Session monitor stopped');
  }
}
