/**
 * 按用户存储权限模式，支持运行时切换
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { APP_HOME } from '../constants.js';
import { createLogger } from '../logger.js';
import type { PermissionMode } from './types.js';
import { PERMISSION_MODES } from './types.js';

const log = createLogger('PermissionMode');
const MODE_FILE = join(APP_HOME, 'data', 'permission-modes.json');

let modes = new Map<string, PermissionMode>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function isValidMode(v: unknown): v is PermissionMode {
  return typeof v === 'string' && PERMISSION_MODES.includes(v as PermissionMode);
}

function load(): void {
  try {
    if (existsSync(MODE_FILE)) {
      const data = JSON.parse(readFileSync(MODE_FILE, 'utf-8')) as Record<string, unknown>;
      modes = new Map(
        Object.entries(data).filter(([, v]) => isValidMode(v)) as [string, PermissionMode][]
      );
    }
  } catch {
    modes = new Map();
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const dir = dirname(MODE_FILE);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const obj: Record<string, string> = {};
      for (const [k, v] of modes) obj[k] = v;
      writeFileSync(MODE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      log.error('Failed to save permission modes:', err);
    }
  }, 300);
}

/** 初始化（启动时调用） */
export function initPermissionModes(): void {
  load();
}

/** 获取用户当前权限模式 */
export function getPermissionMode(userId: string, defaultMode: PermissionMode = 'ask'): PermissionMode {
  return modes.get(userId) ?? defaultMode;
}

/** 设置用户权限模式 */
export function setPermissionMode(userId: string, mode: PermissionMode): void {
  modes.set(userId, mode);
  scheduleSave();
  log.info(`Permission mode for ${userId}: ${mode}`);
}
