import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createLogger, type LogLevel } from '../logger.js';
import { APP_HOME } from '../constants.js';
import type { AiCommand, FileConfig } from './types.js';

const log = createLogger('config');

export const CONFIG_PATH = join(APP_HOME, 'config.json');

export const CODEX_AUTH_PATHS = [
  join(homedir(), '.codex', 'auth.json'),
  join(homedir(), '.config', 'codex', 'auth.json'),
  join(homedir(), 'AppData', 'Roaming', 'codex', 'auth.json'),
];

const OLD_ROOT_KEYS = [
  'claudeWorkDir',
  'claudeTimeoutMs',
  'claudeModel',
] as const;

const AI_COMMANDS: readonly AiCommand[] = ['claude', 'codex', 'codebuddy'];

// Config cache with mtime tracking
let cachedConfig: { config: FileConfig; mtime: number } | null = null;
let cachedClaudeEnv: { env: Record<string, string>; mtime: number } | null = null;

function hasOldConfigFormat(raw: Record<string, unknown>): boolean {
  const hasOld = OLD_ROOT_KEYS.some((k) => raw[k] !== undefined && raw[k] !== null);
  const hasNew = raw.tools && typeof raw.tools === 'object' && (raw.tools as Record<string, unknown>).claude;
  return !!hasOld && !hasNew;
}

function migrateToNewConfigFormat(raw: Record<string, unknown>): Record<string, unknown> {
  const tools = (raw.tools as Record<string, unknown>) || {};
  const tc = (tools.claude as Record<string, unknown>) || {};
  const tcod = (tools.codex as Record<string, unknown>) || {};
  const tcb = (tools.codebuddy as Record<string, unknown>) || {};

  const migrated: Record<string, unknown> = { ...raw };
  migrated.tools = {
    claude: {
      ...tc,
      workDir: tc.workDir ?? raw.claudeWorkDir ?? process.cwd(),
      proxy: tc.proxy,
    },
    codex: {
      ...tcod,
      cliPath: tcod.cliPath ?? 'codex',
      workDir: tcod.workDir ?? raw.claudeWorkDir ?? process.cwd(),
      proxy: tcod.proxy,
    },
    codebuddy: {
      ...tcb,
      cliPath: tcb.cliPath ?? 'codebuddy',
    },
  };

  for (const k of OLD_ROOT_KEYS) {
    delete migrated[k];
  }
  return migrated;
}

export function loadFileConfig(): FileConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    const stats = statSync(CONFIG_PATH);
    const currentMtime = stats.mtimeMs;

    if (cachedConfig && cachedConfig.mtime === currentMtime) {
      return cachedConfig.config;
    }

    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return {};

    if (hasOldConfigFormat(raw)) {
      const migrated = migrateToNewConfigFormat(raw);
      const dir = dirname(CONFIG_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(CONFIG_PATH, JSON.stringify(migrated, null, 2), 'utf-8');
      try { chmodSync(CONFIG_PATH, 0o600); } catch { /* ignore */ }
      cachedConfig = { config: migrated as FileConfig, mtime: currentMtime };
      return migrated as FileConfig;
    }

    cachedConfig = { config: raw as FileConfig, mtime: currentMtime };
    return raw as FileConfig;
  } catch {
    return {};
  }
}

export function saveFileConfig(raw: FileConfig): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8');
  cachedConfig = null;
}

export function getClaudeConfigHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

export function loadClaudeSettingsEnv(): Record<string, string> {
  const home = getClaudeConfigHome();
  const paths = [
    join(home, '.claude', 'settings.json'),
    join(home, '.claude.json'),
  ];
  for (const p of paths) {
    try {
      if (existsSync(p)) {
        const stats = statSync(p);
        const currentMtime = stats.mtimeMs;
        if (cachedClaudeEnv && cachedClaudeEnv.mtime === currentMtime && cachedClaudeEnv.env) {
          return cachedClaudeEnv.env;
        }

        const raw = JSON.parse(readFileSync(p, 'utf-8'));
        const env = raw?.env;
        if (env && typeof env === 'object') {
          const result: Record<string, string> = {};
          for (const [k, v] of Object.entries(env)) {
            if (v != null && typeof k === 'string') {
              result[k] = String(v);
            }
          }
          cachedClaudeEnv = { env: result, mtime: currentMtime };
          return result;
        }
      }
    } catch {
      /* file not found or parse error, try next path */
    }
  }
  return {};
}

export function saveClaudeSettingsEnv(env: Record<string, string>): void {
  const home = getClaudeConfigHome();
  const claudeSettingsPath = join(home, '.claude', 'settings.json');
  const claudeDir = join(home, '.claude');

  try {
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }

    let existing: Record<string, unknown> = {};
    if (existsSync(claudeSettingsPath)) {
      try {
        existing = JSON.parse(readFileSync(claudeSettingsPath, 'utf-8'));
      } catch {
        // file format error, start fresh
      }
    }

    existing.env = { ...(existing.env as Record<string, unknown> | undefined), ...env };

    writeFileSync(claudeSettingsPath, JSON.stringify(existing, null, 2), 'utf-8');
    cachedClaudeEnv = null;
  } catch (error) {
    log.error('Failed to save Claude settings:', error);
    throw new Error(`Failed to save Claude settings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function normalizeAiCommand(value: unknown, fallback: AiCommand): AiCommand {
  return typeof value === 'string' && AI_COMMANDS.includes(value as AiCommand)
    ? (value as AiCommand)
    : fallback;
}

export function hasCodexAuth(): boolean {
  if (process.env.OPENAI_API_KEY) return true;
  return CODEX_AUTH_PATHS.some((p) => {
    try {
      return existsSync(p) && readFileSync(p, 'utf-8').trim().length > 0;
    } catch {
      return false;
    }
  });
}

export function parseCommaSeparated(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}
