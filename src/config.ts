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

  // 运行时使用的凭证（来源可以是 env 或 config.json）
  telegramBotToken?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;

  // 全局白名单（旧版兼容）
  allowedUserIds: string[];
  // 分平台白名单（新配置推荐）
  telegramAllowedUserIds: string[];
  feishuAllowedUserIds: string[];

  aiCommand: AiCommand;
  claudeCliPath: string;
  claudeWorkDir: string;
  allowedBaseDirs: string[];
  claudeSkipPermissions: boolean;
  defaultPermissionMode: 'ask' | 'accept-edits' | 'plan' | 'yolo';
  claudeTimeoutMs: number;
  claudeModel?: string;
  hookPort: number;
  logDir: string;
  logLevel: LogLevel;

  platforms: {
    telegram?: {
      enabled: boolean;
      proxy?: string; // HTTP/HTTPS/SOCKS 代理地址，例如: http://127.0.0.1:7890 或 socks5://127.0.0.1:1080
      allowedUserIds: string[];
    };
    feishu?: {
      enabled: boolean;
      allowedUserIds: string[];
    };
  };
}

interface FilePlatformTelegram {
  enabled?: boolean;
  botToken?: string;
  allowedUserIds?: string[];
  proxy?: string;
}

interface FilePlatformFeishu {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  allowedUserIds?: string[];
}

interface FileConfig {
  // 旧版扁平字段（兼容）
  telegramBotToken?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  allowedUserIds?: string[];

  // 新版分块字段
  platforms?: {
    telegram?: FilePlatformTelegram;
    feishu?: FilePlatformFeishu;
  };

  aiCommand?: string;
  claudeCliPath?: string;
  claudeWorkDir?: string;
  allowedBaseDirs?: string[];
  claudeSkipPermissions?: boolean;
  defaultPermissionMode?: 'ask' | 'accept-edits' | 'plan' | 'yolo';
  claudeTimeoutMs?: number;
  claudeModel?: string;
  hookPort?: number;
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
  // 环境变量已提供任一平台的凭证，则认为已配置
  if (process.env.TELEGRAM_BOT_TOKEN) return false;
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) return false;

  const file = loadFileConfig();
  const tg = file.platforms?.telegram;
  const fs = file.platforms?.feishu;

  const hasTelegram = !!tg?.botToken;
  const hasFeishu = !!(fs?.appId && fs?.appSecret);

  return !hasTelegram && !hasFeishu;
}

function parseCommaSeparated(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(): Config {
  const file = loadFileConfig();

  const fileTelegram = file.platforms?.telegram;
  const fileFeishu = file.platforms?.feishu;

  // 1. 加载各平台凭证（env 优先，其次新结构，最后旧字段）
  const telegramBotToken =
    process.env.TELEGRAM_BOT_TOKEN ??
    fileTelegram?.botToken ??
    file.telegramBotToken;

  const feishuAppId =
    process.env.FEISHU_APP_ID ??
    fileFeishu?.appId ??
    file.feishuAppId;
  const feishuAppSecret =
    process.env.FEISHU_APP_SECRET ??
    fileFeishu?.appSecret ??
    file.feishuAppSecret;

  // 2. 计算启用平台
  const enabledPlatforms: Platform[] = [];

  const telegramEnabledFlag = fileTelegram?.enabled;
  const feishuEnabledFlag = fileFeishu?.enabled;

  const telegramEnabled =
    !!telegramBotToken && (telegramEnabledFlag !== false);
  const feishuEnabled =
    !!(feishuAppId && feishuAppSecret) && (feishuEnabledFlag !== false);

  if (telegramEnabled) enabledPlatforms.push('telegram');
  if (feishuEnabled) enabledPlatforms.push('feishu');

  if (enabledPlatforms.length === 0) {
    throw new Error('至少需要配置 Telegram 或 Feishu 其中一个平台（可以通过环境变量或 config.json）');
  }

  // 3. 全局白名单（旧字段，向后兼容，主要用于作为 per-platform 的兜底）
  const allowedUserIds: string[] =
    process.env.ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.ALLOWED_USER_IDS)
      : file.allowedUserIds ?? [];

  // 4. 分平台白名单（新字段）
  const telegramAllowedUserIds =
    process.env.TELEGRAM_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.TELEGRAM_ALLOWED_USER_IDS)
      : fileTelegram?.allowedUserIds ?? allowedUserIds;

  const feishuAllowedUserIds =
    process.env.FEISHU_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.FEISHU_ALLOWED_USER_IDS)
      : fileFeishu?.allowedUserIds ?? allowedUserIds;

  // 5. AI / 工作目录 / 安全配置
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

  const defaultPermissionMode = (file.defaultPermissionMode ?? 'ask') as 'ask' | 'accept-edits' | 'plan' | 'yolo';

  const claudeTimeoutMs =
    process.env.CLAUDE_TIMEOUT_MS !== undefined
      ? parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 600000
      : file.claudeTimeoutMs ?? 600000;

  const hookPort =
    process.env.HOOK_PORT !== undefined
      ? parseInt(process.env.HOOK_PORT, 10) || 35801
      : file.hookPort ?? 35801;

  // 6. 校验 Claude CLI
  if (aiCommand === 'claude') {
    if (isAbsolute(claudeCliPath) || claudeCliPath.includes('/') || claudeCliPath.includes('\\')) {
      try {
        accessSync(claudeCliPath, constants.F_OK | constants.X_OK);
      } catch {
        throw new Error(`Claude CLI 不可执行: ${claudeCliPath}`);
      }
    } else {
      // 检查命令是否存在（Windows 用 where，Unix 用 which）
      const checkCommand = process.platform === 'win32' ? 'where' : 'which';
      try {
        execFileSync(checkCommand, [claudeCliPath], { stdio: 'pipe' });
      } catch {
        const installGuide = [
          '',
          '━━━ Claude CLI 未安装 ━━━',
          '',
          'open-im 需要 Claude Code CLI 才能运行。',
          '',
          '安装方法：',
          '',
          '  npm install -g @anthropic-ai/claude-code',
          '',
          '或者：',
          '  1. 访问 https://claude.ai/download',
          '  2. 下载并安装 Claude Code',
          '',
          '安装后重新运行：',
          '  open-im run',
          '',
        ].join('\n');
        throw new Error(installGuide);
      }
    }
  }

  // 7. 日志与平台配置
  const logDir = process.env.LOG_DIR ?? file.logDir ?? join(APP_HOME, 'logs');
  const logLevel = (process.env.LOG_LEVEL?.toUpperCase() ?? file.logLevel ?? 'INFO') as LogLevel;

  const platforms: Config['platforms'] = {
    telegram: telegramEnabled
      ? {
          enabled: true,
          proxy: process.env.TELEGRAM_PROXY ?? file.platforms?.telegram?.proxy,
          allowedUserIds: telegramAllowedUserIds,
        }
      : {
          enabled: false,
          proxy: process.env.TELEGRAM_PROXY ?? file.platforms?.telegram?.proxy,
          allowedUserIds: telegramAllowedUserIds,
        },
    feishu: feishuEnabled
      ? {
          enabled: true,
          allowedUserIds: feishuAllowedUserIds,
        }
      : {
          enabled: false,
          allowedUserIds: feishuAllowedUserIds,
        },
  };

  return {
    enabledPlatforms,
    telegramBotToken: telegramBotToken ?? '',
    feishuAppId: feishuAppId ?? '',
    feishuAppSecret: feishuAppSecret ?? '',
    allowedUserIds,
    telegramAllowedUserIds,
    feishuAllowedUserIds,
    aiCommand,
    claudeCliPath,
    claudeWorkDir,
    allowedBaseDirs,
    claudeSkipPermissions,
    defaultPermissionMode,
    claudeTimeoutMs,
    claudeModel: process.env.CLAUDE_MODEL ?? file.claudeModel,
    hookPort,
    logDir,
    logLevel,
    platforms,
  };
}
