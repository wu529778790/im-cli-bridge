import { createWriteStream, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { WriteStream } from 'node:fs';
import { sanitize } from './sanitize.js';
import { APP_HOME } from './constants.js';

const DEFAULT_LOG_DIR = join(APP_HOME, 'logs');
const MAX_LOG_FILES = 10;
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;
export type LogLevel = keyof typeof LOG_LEVELS;

let logDir = DEFAULT_LOG_DIR;
let minLevel: number = LOG_LEVELS.DEBUG;

let logStream: WriteStream;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function getLogFileName(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`;
}

function rotateOldLogs() {
  try {
    const files = readdirSync(logDir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => ({ name: f, time: statSync(join(logDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (let i = MAX_LOG_FILES; i < files.length; i++) {
      unlinkSync(join(logDir, files[i].name));
    }
  } catch {
    /* ignore */
  }
}

export function initLogger(dir?: string, level?: LogLevel) {
  if (dir) logDir = dir;
  if (level) minLevel = LOG_LEVELS[level] ?? LOG_LEVELS.DEBUG;
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  rotateOldLogs();
  logStream = createWriteStream(join(logDir, getLogFileName()), { flags: 'a' });
}

function write(level: keyof typeof LOG_LEVELS, tag: string, msg: string, ...args: unknown[]) {
  if (LOG_LEVELS[level] < minLevel) return;
  const d = new Date();
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const extra = args.length > 0 ? ' ' + args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ') : '';
  const line = sanitize(`${ts} [${level}] [${tag}] ${msg}${extra}\n`);
  if (level === 'ERROR') process.stderr.write(line);
  else process.stdout.write(line);
  logStream?.write(line);
}

export function createLogger(tag: string) {
  return {
    info: (msg: string, ...args: unknown[]) => write('INFO', tag, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => write('WARN', tag, msg, ...args),
    error: (msg: string, ...args: unknown[]) => write('ERROR', tag, msg, ...args),
    debug: (msg: string, ...args: unknown[]) => write('DEBUG', tag, msg, ...args),
  };
}

export function closeLogger() {
  logStream?.end();
}
