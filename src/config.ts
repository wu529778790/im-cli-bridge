try {
  await import('dotenv/config');
} catch {
  /* dotenv optional */
}

import { readFileSync, accessSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import type { LogLevel } from './logger.js';
import { APP_HOME } from './constants.js';

export type Platform = 'feishu' | 'telegram';

export type AiCommand = 'claude' | 'codex' | 'cursor';

export interface Config {
  enabledPlatforms: Platform[];
  telegramBotToken: string;
  allowedUserIds: string[];
  aiCommand: AiCommand;
  claudeCliPath: string;
  claudeWorkDir: string;
  allowedBaseDirs: string[];
  claudeSkipPermissions: boolean;
  claudeTimeoutMs: number;
  claudeModel?: string;
  logDir: string;
  logLevel: LogLevel;
}

interface FileConfig {
  telegramBotToken?: string;
  allowedUserIds?: string[];
  aiCommand?: string;
  claudeCliPath?: string;
  claudeWorkDir?: string;
  allowedBaseDirs?: string[];
  claudeSkipPermissions?: boolean;
  claudeTimeoutMs?: number;
  claudeModel?: string;
  logDir?: string;
  logLevel?: LogLevel;
}

const CONFIG_PATH = join(APP_HOME, 'config.json');

function loadFileConfig(): FileConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/** 检测是否需要交互式配置（无 token 且无环境变量） */
export function needsSetup(): boolean {
  if (process.env.TELEGRAM_BOT_TOKEN) return false;
  const file = loadFileConfig();
  return !file.telegramBotToken;
}

function parseCommaSeparated(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(): Config {
  const file = loadFileConfig();
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? file.telegramBotToken ?? '';
  const enabledPlatforms: Platform[] = telegramBotToken ? ['telegram'] : [];

  if (enabledPlatforms.length === 0) {
    throw new Error('至少需要配置 TELEGRAM_BOT_TOKEN');
  }

  const allowedUserIds =
    process.env.ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.ALLOWED_USER_IDS)
      : file.allowedUserIds ?? [];

  const aiCommand = (process.env.AI_COMMAND ?? file.aiCommand ?? 'claude') as AiCommand;
  const claudeCliPath = process.env.CLAUDE_CLI_PATH ?? file.claudeCliPath ?? 'claude';
  const claudeWorkDir = process.env.CLAUDE_WORK_DIR ?? file.claudeWorkDir ?? process.cwd();

  const allowedBaseDirs =
    process.env.ALLOWED_BASE_DIRS !== undefined
      ? parseCommaSeparated(process.env.ALLOWED_BASE_DIRS)
      : file.allowedBaseDirs ?? [];
  if (allowedBaseDirs.length === 0) allowedBaseDirs.push(claudeWorkDir);

  const claudeSkipPermissions =
    process.env.CLAUDE_SKIP_PERMISSIONS !== undefined
      ? process.env.CLAUDE_SKIP_PERMISSIONS === 'true'
      : file.claudeSkipPermissions ?? true;

  const claudeTimeoutMs =
    process.env.CLAUDE_TIMEOUT_MS !== undefined
      ? parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 600000
      : file.claudeTimeoutMs ?? 600000;

  if (aiCommand === 'claude') {
    if (isAbsolute(claudeCliPath) || claudeCliPath.includes('/')) {
      try {
        accessSync(claudeCliPath, constants.F_OK | constants.X_OK);
      } catch {
        throw new Error(`Claude CLI 不可执行: ${claudeCliPath}`);
      }
    } else {
      try {
        execFileSync('which', [claudeCliPath], { stdio: 'pipe' });
      } catch {
        throw new Error(`Claude CLI 在 PATH 中未找到: ${claudeCliPath}`);
      }
    }
  }

  const logDir = process.env.LOG_DIR ?? file.logDir ?? join(APP_HOME, 'logs');
  const logLevel = (process.env.LOG_LEVEL?.toUpperCase() ?? file.logLevel ?? 'INFO') as LogLevel;

  return {
    enabledPlatforms,
    telegramBotToken,
    allowedUserIds,
    aiCommand,
    claudeCliPath,
    claudeWorkDir,
    allowedBaseDirs,
    claudeSkipPermissions,
    claudeTimeoutMs,
    claudeModel: process.env.CLAUDE_MODEL ?? file.claudeModel,
    logDir,
    logLevel,
  };
}
