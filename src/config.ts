try {
  await import('dotenv/config');
} catch {
  /* dotenv optional */
}

import { readFileSync, writeFileSync, accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, isAbsolute, basename } from 'node:path';
import { homedir } from 'node:os';
import { createLogger, type LogLevel } from './logger.js';
import { APP_HOME } from './constants.js';

const log = createLogger('config');

export type Platform = 'dingtalk' | 'feishu' | 'qq' | 'telegram' | 'wework' | 'workbuddy';

export type AiCommand = 'claude' | 'codex' | 'codebuddy';
const AI_COMMANDS: readonly AiCommand[] = ['claude', 'codex', 'codebuddy'];

export interface Config {
  enabledPlatforms: Platform[];

  // 运行时使用的凭证（来源可以是 env 或 config.json）
  telegramBotToken?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  weworkCorpId?: string;  // 企业微信 Bot ID
  weworkSecret?: string;   // 企业微信 Secret
  weworkWsUrl?: string;    // 企业微信 WebSocket URL（可选，默认使用官方服务）
  dingtalkClientId?: string;
  dingtalkClientSecret?: string;
  dingtalkCardTemplateId?: string;
  qqAppId?: string;
  qqSecret?: string;

  // 全局白名单（旧版兼容）
  allowedUserIds: string[];
  // 分平台白名单（新配置推荐）
  telegramAllowedUserIds: string[];
  feishuAllowedUserIds: string[];
  qqAllowedUserIds: string[];
  weworkAllowedUserIds: string[];
  dingtalkAllowedUserIds: string[];
  workbuddyAllowedUserIds: string[];

  aiCommand: AiCommand;
  codexCliPath: string;
  codebuddyCliPath: string;
  /** Claude 访问 API 的代理（如 http://127.0.0.1:7890） */
  claudeProxy?: string;
  /** Codex 访问 chatgpt.com 的代理（如 http://127.0.0.1:7890） */
  codexProxy?: string;
  claudeTimeoutMs: number;
  codexTimeoutMs: number;
  codebuddyTimeoutMs: number;
  claudeWorkDir: string;
  claudeModel?: string;
  logDir: string;
  logLevel: LogLevel;

  platforms: {
    telegram?: {
      enabled: boolean;
      aiCommand?: AiCommand;
      proxy?: string; // HTTP/HTTPS/SOCKS 代理地址，例如: http://127.0.0.1:7890 或 socks5://127.0.0.1:1080
      allowedUserIds: string[];
    };
    feishu?: {
      enabled: boolean;
      aiCommand?: AiCommand;
      allowedUserIds: string[];
    };
    qq?: {
      enabled: boolean;
      aiCommand?: AiCommand;
      allowedUserIds: string[];
    };
    wework?: {
      enabled: boolean;
      aiCommand?: AiCommand;
      allowedUserIds: string[];
    };
    dingtalk?: {
      enabled: boolean;
      aiCommand?: AiCommand;
      allowedUserIds: string[];
      cardTemplateId?: string;
    };
    workbuddy?: {
      enabled: boolean;
      aiCommand?: AiCommand;
      allowedUserIds: string[];
      accessToken?: string;
      refreshToken?: string;
      userId?: string;
      baseUrl?: string;
      guid?: string;
      workspacePath?: string;
    };
  };
}

export interface FilePlatformTelegram {
  enabled?: boolean;
  botToken?: string;
  aiCommand?: AiCommand;
  allowedUserIds?: string[];
  proxy?: string;
}

export interface FilePlatformFeishu {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  aiCommand?: AiCommand;
  allowedUserIds?: string[];
}

interface FilePlatformQQ {
  enabled?: boolean;
  appId?: string;
  secret?: string;
  aiCommand?: AiCommand;
  allowedUserIds?: string[];
}

interface FilePlatformWechat {
  enabled?: boolean;
  aiCommand?: AiCommand;
  userId?: string;
  allowedUserIds?: string[];
  workbuddyAccessToken?: string;
  workbuddyRefreshToken?: string;
  workbuddyBaseUrl?: string;
  workbuddyHostId?: string;
}

export interface FilePlatformWework {
  enabled?: boolean;
  corpId?: string;  // Bot ID
  secret?: string;
  aiCommand?: AiCommand;
  wsUrl?: string;
  allowedUserIds?: string[];
}

export interface FilePlatformDingtalk {
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
  aiCommand?: AiCommand;
  allowedUserIds?: string[];
  cardTemplateId?: string;
}

interface FilePlatformWorkBuddy {
  enabled?: boolean;
  aiCommand?: AiCommand;
  allowedUserIds?: string[];
  // WorkBuddy OAuth credentials
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
  baseUrl?: string;
  guid?: string;
  workspacePath?: string;
}

export interface FileToolClaude {
  cliPath?: string;
  workDir?: string;
  timeoutMs?: number;
  skipPermissions?: boolean;
  /** HTTP/HTTPS 代理，用于访问 Claude API（如 http://127.0.0.1:7890） */
  proxy?: string;
  /** Claude API 配置（优先级：环境变量 > tools.claude.env > ~/.claude/settings.json） */
  env?: Record<string, string>;
}

export interface FileToolCodex {
  cliPath?: string;
  workDir?: string;
  timeoutMs?: number;
  /** HTTP/HTTPS 代理，用于访问 chatgpt.com（如 http://127.0.0.1:7890） */
  proxy?: string;
}

export interface FileToolCodeBuddy {
  cliPath?: string;
  timeoutMs?: number;
}

export interface FileConfig {
  telegramBotToken?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  allowedUserIds?: string[];

  platforms?: {
    telegram?: FilePlatformTelegram;
    feishu?: FilePlatformFeishu;
    qq?: FilePlatformQQ;
    wechat?: FilePlatformWechat;
    wework?: FilePlatformWework;
    dingtalk?: FilePlatformDingtalk;
    workbuddy?: FilePlatformWorkBuddy;
  };

  env?: Record<string, string>;
  aiCommand?: string;
  tools?: {
    claude?: FileToolClaude;
    codex?: FileToolCodex;
    codebuddy?: FileToolCodeBuddy;
  };
  logDir?: string;
  logLevel?: LogLevel;
}

export const CONFIG_PATH = join(APP_HOME, 'config.json');
const CODEX_AUTH_PATHS = [
  join(homedir(), '.codex', 'auth.json'),
  join(homedir(), '.config', 'codex', 'auth.json'),
  join(homedir(), 'AppData', 'Roaming', 'codex', 'auth.json'),
];

const OLD_ROOT_KEYS = [
  'claudeWorkDir',
  'claudeTimeoutMs', 'claudeModel',
] as const;

function hasOldConfigFormat(raw: Record<string, unknown>): boolean {
  const hasOld = OLD_ROOT_KEYS.some((k) => raw[k] !== undefined && raw[k] !== null);
  const hasNew = raw.tools && typeof raw.tools === 'object' && (raw.tools as Record<string, unknown>).claude;
  return !!hasOld && !hasNew;
}

function normalizeAiCommand(value: unknown, fallback: AiCommand): AiCommand {
  return typeof value === 'string' && AI_COMMANDS.includes(value as AiCommand)
    ? (value as AiCommand)
    : fallback;
}

function hasCodexAuth(): boolean {
  if (process.env.OPENAI_API_KEY) return true;
  return CODEX_AUTH_PATHS.some((p) => {
    try {
      return existsSync(p) && readFileSync(p, 'utf-8').trim().length > 0;
    } catch {
      return false;
    }
  });
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
      timeoutMs: tc.timeoutMs ?? raw.claudeTimeoutMs ?? 600000,
      proxy: tc.proxy,
      // model 现在通过 env 配置，不再在这里处理
    },
    codex: {
      ...tcod,
      cliPath: tcod.cliPath ?? 'codex',
      workDir: tcod.workDir ?? raw.claudeWorkDir ?? process.cwd(),
      timeoutMs: tcod.timeoutMs ?? raw.claudeTimeoutMs ?? 600000,
      proxy: tcod.proxy,
    },
    codebuddy: {
      ...tcb,
      cliPath: tcb.cliPath ?? 'codebuddy',
      timeoutMs: tcb.timeoutMs ?? raw.claudeTimeoutMs ?? 600000,
    },
  };

  for (const k of OLD_ROOT_KEYS) {
    delete migrated[k];
  }
  return migrated;
}

export function loadFileConfig(): FileConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return {};

    if (hasOldConfigFormat(raw)) {
      const migrated = migrateToNewConfigFormat(raw);
      const dir = dirname(CONFIG_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(CONFIG_PATH, JSON.stringify(migrated, null, 2), 'utf-8');
      return migrated as FileConfig;
    }
    return raw as FileConfig;
  } catch {
    return {};
  }
}

export function saveFileConfig(raw: FileConfig): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8');
}

/** 获取用户主目录（兼容不同运行环境，如 launchd、systemd 等） */
export function getClaudeConfigHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

/** 从 Claude Code 配置文件加载 env，支持多路径（与 Claude Code 共用） */
export function loadClaudeSettingsEnv(): Record<string, string> {
  const home = getClaudeConfigHome();
  const paths = [
    join(home, '.claude', 'settings.json'),
    join(home, '.claude.json'),
  ];
  for (const p of paths) {
    try {
      const raw = JSON.parse(readFileSync(p, 'utf-8'));
      const env = raw?.env;
      if (env && typeof env === 'object') {
        const result: Record<string, string> = {};
        for (const [k, v] of Object.entries(env)) {
          if (v != null && typeof k === 'string') {
            result[k] = String(v);
          }
        }
        return result;
      }
    } catch {
      /* 文件不存在或格式错误，尝试下一路径 */
    }
  }
  return {};
}

/** 保存环境变量到 Claude Code 配置文件（~/.claude/settings.json） */
export function saveClaudeSettingsEnv(env: Record<string, string>): void {
  const home = getClaudeConfigHome();
  const claudeSettingsPath = join(home, '.claude', 'settings.json');
  const claudeDir = join(home, '.claude');

  try {
    // 确保 .claude 目录存在
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }

    // 读取现有配置
    let existing: Record<string, unknown> = {};
    if (existsSync(claudeSettingsPath)) {
      try {
        existing = JSON.parse(readFileSync(claudeSettingsPath, 'utf-8'));
      } catch {
        // 文件格式错误，从空对象开始
      }
    }

    // 更新 env 字段
    existing.env = { ...(existing.env as Record<string, unknown> | undefined), ...env };

    // 写入文件
    writeFileSync(claudeSettingsPath, JSON.stringify(existing, null, 2), 'utf-8');
  } catch (error) {
    log.error('Failed to save Claude settings:', error);
    throw new Error(`Failed to save Claude settings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 检查是否已配置 Claude API 凭证 */
function hasClaudeCredentials(): boolean {
  return !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    process.env.ANTHROPIC_BASE_URL // 使用自定义 API（如第三方模型）时可能不需要标准凭证
  );
}

/** 检测是否需要交互式配置（无 token 且无环境变量） */
export function needsSetup(): boolean {
  // 环境变量已提供任一平台的凭证，则认为已配置
  if (process.env.TELEGRAM_BOT_TOKEN) return false;
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) return false;
  if (process.env.QQ_BOT_APPID && process.env.QQ_BOT_SECRET) return false;
  if (
    process.env.WECHAT_WORKBUDDY_ACCESS_TOKEN &&
    process.env.WECHAT_WORKBUDDY_REFRESH_TOKEN
  ) {
    return false;
  }
  if (process.env.WEWORK_CORP_ID && process.env.WEWORK_SECRET) return false;
  if (process.env.DINGTALK_CLIENT_ID && process.env.DINGTALK_CLIENT_SECRET) return false;

  const file = loadFileConfig();
  const tg = file.platforms?.telegram;
  const fs = file.platforms?.feishu;
  const qq = file.platforms?.qq;
  const ww = file.platforms?.wework;
  const dt = file.platforms?.dingtalk;
  const wb = file.platforms?.workbuddy;
  // Also check legacy platforms.wechat for migration path
  const legacyWc = (file.platforms as Record<string, unknown>)?.wechat as FilePlatformWechat | undefined;

  const hasTelegram = !!tg?.botToken;
  const hasFeishu = !!(fs?.appId && fs?.appSecret);
  const hasQQ = !!(qq?.appId && qq?.secret);
  const hasWework = !!(ww?.corpId && ww?.secret);
  const hasDingtalk = !!(dt?.clientId && dt?.clientSecret);
  const hasWorkBuddy = !!(wb?.accessToken && wb?.refreshToken && wb?.userId);
  const hasLegacyWechat = !!(legacyWc?.workbuddyAccessToken && legacyWc?.workbuddyRefreshToken);

  return !hasTelegram && !hasFeishu && !hasQQ && !hasWework && !hasDingtalk && !hasWorkBuddy && !hasLegacyWechat;
}

function parseCommaSeparated(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(): Config {
  const file = loadFileConfig();

  // 将配置文件中的 env 设置到环境变量（优先级低于现有环境变量）
  const mergeEnv = (env: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(env)) {
      if (!(key in process.env) && value != null && typeof key === 'string') {
        process.env[key] = String(value);
      }
    }
  };
  // 1. 全局 env（最低优先级之一）
  if (file.env) mergeEnv(file.env as Record<string, unknown>);

  // 2. tools.claude.env（优先级高于 Claude settings）
  const claudeToolEnv = file.tools?.claude?.env;
  if (claudeToolEnv) mergeEnv(claudeToolEnv as Record<string, unknown>);

  // 3. 从 Claude Code 配置合并（最低优先级）
  const claudeSettingsEnv = loadClaudeSettingsEnv();
  mergeEnv(claudeSettingsEnv);

  const fileTelegram = file.platforms?.telegram;
  const fileFeishu = file.platforms?.feishu;
  const fileQQ = file.platforms?.qq;
  const fileWework = file.platforms?.wework;
  const fileDingtalk = file.platforms?.dingtalk;
  // Auto-migrate legacy platforms.wechat WorkBuddy credentials → platforms.workbuddy
  const legacyWechat = (file.platforms as Record<string, unknown>)?.wechat as FilePlatformWechat | undefined;
  const fileWorkBuddy = file.platforms?.workbuddy ?? (
    legacyWechat?.workbuddyAccessToken && legacyWechat?.workbuddyRefreshToken
      ? {
          accessToken: legacyWechat.workbuddyAccessToken,
          refreshToken: legacyWechat.workbuddyRefreshToken,
          userId: legacyWechat.userId,
          baseUrl: legacyWechat.workbuddyBaseUrl,
        }
      : undefined
  );

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

  const qqAppId =
    process.env.QQ_BOT_APPID ??
    fileQQ?.appId;
  const qqSecret =
    process.env.QQ_BOT_SECRET ??
    fileQQ?.secret;

  const weworkCorpId =
    process.env.WEWORK_CORP_ID ??
    fileWework?.corpId;
  const weworkSecret =
    process.env.WEWORK_SECRET ??
    fileWework?.secret;
  const weworkWsUrl =
    process.env.WEWORK_WS_URL ??
    fileWework?.wsUrl;

  const dingtalkClientId =
    process.env.DINGTALK_CLIENT_ID ??
    fileDingtalk?.clientId;
  const dingtalkClientSecret =
    process.env.DINGTALK_CLIENT_SECRET ??
    fileDingtalk?.clientSecret;
  const dingtalkCardTemplateId =
    process.env.DINGTALK_CARD_TEMPLATE_ID ??
    fileDingtalk?.cardTemplateId;

  // WorkBuddy credentials
  const workbuddyAccessToken =
    process.env.WORKBUDDY_ACCESS_TOKEN ??
    fileWorkBuddy?.accessToken;
  const workbuddyRefreshToken =
    process.env.WORKBUDDY_REFRESH_TOKEN ??
    fileWorkBuddy?.refreshToken;
  const workbuddyUserId =
    process.env.WORKBUDDY_USER_ID ??
    fileWorkBuddy?.userId;
  const workbuddyBaseUrl =
    process.env.WORKBUDDY_BASE_URL ??
    fileWorkBuddy?.baseUrl;
  const workbuddyGuid =
    process.env.WORKBUDDY_GUID ??
    fileWorkBuddy?.guid;
  const workbuddyWorkspacePath =
    process.env.WORKBUDDY_WORKSPACE_PATH ??
    fileWorkBuddy?.workspacePath;

  // 2. 计算启用平台
  const enabledPlatforms: Platform[] = [];

  const telegramEnabledFlag = fileTelegram?.enabled;
  const feishuEnabledFlag = fileFeishu?.enabled;
  const qqEnabledFlag = fileQQ?.enabled;
  const weworkEnabledFlag = fileWework?.enabled;
  const dingtalkEnabledFlag = fileDingtalk?.enabled;
  const workbuddyEnabledFlag = fileWorkBuddy?.enabled;

  const telegramEnabled =
    !!telegramBotToken && (telegramEnabledFlag !== false);
  const feishuEnabled =
    !!(feishuAppId && feishuAppSecret) && (feishuEnabledFlag !== false);
  const qqEnabled =
    !!(qqAppId && qqSecret) && (qqEnabledFlag !== false);
  const weworkEnabled =
    !!(weworkCorpId && weworkSecret) && (weworkEnabledFlag !== false);
  const dingtalkEnabled =
    !!(dingtalkClientId && dingtalkClientSecret) && (dingtalkEnabledFlag !== false);
  const workbuddyEnabled =
    !!(workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId) && (workbuddyEnabledFlag !== false);

  if (telegramEnabled) enabledPlatforms.push('telegram');
  if (feishuEnabled) enabledPlatforms.push('feishu');
  if (qqEnabled) enabledPlatforms.push('qq');
  if (weworkEnabled) enabledPlatforms.push('wework');
  if (dingtalkEnabled) enabledPlatforms.push('dingtalk');
  if (workbuddyEnabled) enabledPlatforms.push('workbuddy');

  if (enabledPlatforms.length === 0) {
    throw new Error('至少需要配置 Telegram、Feishu、WeChat、WeWork 或 DingTalk 其中一个平台（可以通过环境变量或 config.json）');
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

  const qqAllowedUserIds =
    process.env.QQ_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.QQ_ALLOWED_USER_IDS)
      : fileQQ?.allowedUserIds ?? allowedUserIds;

  const weworkAllowedUserIds =
    process.env.WEWORK_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.WEWORK_ALLOWED_USER_IDS)
      : fileWework?.allowedUserIds ?? allowedUserIds;

  const dingtalkAllowedUserIds =
    process.env.DINGTALK_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.DINGTALK_ALLOWED_USER_IDS)
      : fileDingtalk?.allowedUserIds ?? allowedUserIds;

  const workbuddyAllowedUserIds =
    process.env.WORKBUDDY_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.WORKBUDDY_ALLOWED_USER_IDS)
      : fileWorkBuddy?.allowedUserIds ?? allowedUserIds;

  // 5. AI / 工作目录 / 安全配置（从 tools 读取）
  const aiCommand = normalizeAiCommand(process.env.AI_COMMAND ?? file.aiCommand, 'claude');
  const tc = file.tools?.claude ?? {};
  const tcod = file.tools?.codex ?? {};
  const tcb = file.tools?.codebuddy ?? {};

  const claudeProxy = process.env.CLAUDE_PROXY ?? tc.proxy;
  const codexProxy = process.env.CODEX_PROXY ?? tcod.proxy;
  let codexCliPath = process.env.CODEX_CLI_PATH ?? tcod.cliPath ?? 'codex';
  if (process.platform === 'win32' && codexCliPath === 'codex') {
    const npmPaths = [
      join(process.env.APPDATA || '', 'npm', 'codex.cmd'),
      join(process.env.LOCALAPPDATA || '', 'npm', 'codex.cmd'),
    ];
    for (const p of npmPaths) {
      try {
        accessSync(p, constants.F_OK);
        codexCliPath = p;
        break;
      } catch {
        /* 尝试下一个路径 */
      }
    }
  }
  let codebuddyCliPath = process.env.CODEBUDDY_CLI_PATH ?? tcb.cliPath ?? 'codebuddy';
  if (process.platform === 'win32' && codebuddyCliPath === 'codebuddy') {
    const npmPaths = [
      join(process.env.APPDATA || '', 'npm', 'codebuddy.cmd'),
      join(process.env.LOCALAPPDATA || '', 'npm', 'codebuddy.cmd'),
    ];
    for (const p of npmPaths) {
      try {
        accessSync(p, constants.F_OK);
        codebuddyCliPath = p;
        break;
      } catch {
        /* 尝试下一个路径 */
      }
    }
  }
  const claudeWorkDir = process.env.CLAUDE_WORK_DIR ?? tc.workDir ?? process.cwd();

  const claudeTimeoutMs =
    process.env.CLAUDE_TIMEOUT_MS !== undefined
      ? parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 600000
      : tc.timeoutMs ?? 600000;
  const codexTimeoutMs =
    process.env.CODEX_TIMEOUT_MS !== undefined
      ? parseInt(process.env.CODEX_TIMEOUT_MS, 10) || 600000
      : tcod.timeoutMs ?? 600000;
  const codebuddyTimeoutMs =
    process.env.CODEBUDDY_TIMEOUT_MS !== undefined
      ? parseInt(process.env.CODEBUDDY_TIMEOUT_MS, 10) || 600000
      : tcb.timeoutMs ?? 600000;

  // 6. 校验 Claude API 凭证（SDK 模式需要）
  // 支持：官方 API Key、Auth Token、或自定义 API（第三方模型等，BASE_URL + token）
  if (aiCommand === 'claude') {
    const hasCreds = !!(
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN ||
      process.env.ANTHROPIC_BASE_URL
    );

    if (!hasCreds) {
      const errorMsg = [
        '',
        '━━━ 未配置 Claude API 凭证 ━━━',
        '',
        '使用 Claude 需要配置以下之一：',
        '  - 官方 API：ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN',
        '  - 第三方/自定义 API：ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN + ANTHROPIC_MODEL',
        '',
        '方式 1：环境变量',
        '  export ANTHROPIC_API_KEY="sk-ant-..."',
        '  或 export ANTHROPIC_AUTH_TOKEN="your-token"',
        '  或 export ANTHROPIC_BASE_URL="https://your-api" ANTHROPIC_MODEL="glm-4.7"',
        '',
        '方式 2：运行配置向导',
        '  open-im init',
        '',
        '方式 3：编辑配置文件',
        '  ~/.open-im/config.json: tools.claude.env.ANTHROPIC_MODEL = "..."',
        '  ~/.claude/settings.json: env.ANTHROPIC_MODEL = "..."（与 Claude Code 共用）',
        '',
      ].join('\n');
      throw new Error(errorMsg);
    }
  }

  // 7. 校验 Codex CLI（使用 codex 时）
  if (aiCommand === 'codex') {
    if (isAbsolute(codexCliPath) || codexCliPath.includes('/') || codexCliPath.includes('\\')) {
      try {
        accessSync(codexCliPath, constants.F_OK);
      } catch {
        throw new Error(`Codex CLI 不可执行: ${codexCliPath}`);
      }
    } else {
      const checkCommand = process.platform === 'win32' ? 'where' : 'which';
      try {
        execFileSync(checkCommand, [codexCliPath], {
          stdio: 'pipe',
          windowsHide: process.platform === 'win32',
        });
      } catch {
        const installGuide = [
          '',
          '━━━ Codex CLI 未安装 ━━━',
          '',
          '使用 Codex 需要先安装 OpenAI Codex CLI。',
          '',
          '安装方法：',
          '',
          '  npm install -g @openai/codex',
          '',
          '或: brew install --cask codex',
          '',
          '安装后运行 codex login 登录，并用 codex exec --help 验证。',
          '',
        ].join('\n');
        throw new Error(installGuide);
      }
    }
    if (!hasCodexAuth()) {
      log.warn(
        'Codex 模式：未检测到 OPENAI_API_KEY 或 Codex 登录态。首次使用请先运行 codex login，' +
        '或在 ~/.open-im/config.json 的 env 中添加 "OPENAI_API_KEY": "你的 API Key"。'
      );
    }
  }

  // 8. 校验 CodeBuddy CLI（使用 codebuddy 时）
  if (aiCommand === 'codebuddy') {
    if (isAbsolute(codebuddyCliPath) || codebuddyCliPath.includes('/') || codebuddyCliPath.includes('\\')) {
      try {
        accessSync(codebuddyCliPath, constants.F_OK);
      } catch {
        throw new Error(`CodeBuddy CLI 不可执行: ${codebuddyCliPath}`);
      }
    } else {
      const checkCommand = process.platform === 'win32' ? 'where' : 'which';
      try {
        execFileSync(checkCommand, [codebuddyCliPath], {
          stdio: 'pipe',
          windowsHide: process.platform === 'win32',
        });
      } catch {
        const installGuide = [
          '',
          '━━━ CodeBuddy CLI 未安装 ━━━',
          '',
          '使用 CodeBuddy 需要先安装 CodeBuddy Code CLI。',
          '',
          '安装方法：',
          '',
          '  npm install -g @tencent-ai/codebuddy-code',
          '',
          '安装后运行 codebuddy --version 验证，再执行 codebuddy login 登录。',
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
          aiCommand: normalizeAiCommand(file.platforms?.telegram?.aiCommand, aiCommand),
          proxy: process.env.TELEGRAM_PROXY ?? file.platforms?.telegram?.proxy,
          allowedUserIds: telegramAllowedUserIds,
        }
      : {
          enabled: false,
          aiCommand: normalizeAiCommand(file.platforms?.telegram?.aiCommand, aiCommand),
          proxy: process.env.TELEGRAM_PROXY ?? file.platforms?.telegram?.proxy,
          allowedUserIds: telegramAllowedUserIds,
        },
    feishu: feishuEnabled
      ? {
          enabled: true,
          aiCommand: normalizeAiCommand(file.platforms?.feishu?.aiCommand, aiCommand),
          allowedUserIds: feishuAllowedUserIds,
        }
      : {
          enabled: false,
          aiCommand: normalizeAiCommand(file.platforms?.feishu?.aiCommand, aiCommand),
          allowedUserIds: feishuAllowedUserIds,
        },
    qq: qqEnabled
      ? {
          enabled: true,
          aiCommand: normalizeAiCommand(file.platforms?.qq?.aiCommand, aiCommand),
          allowedUserIds: qqAllowedUserIds,
        }
      : {
          enabled: false,
          aiCommand: normalizeAiCommand(file.platforms?.qq?.aiCommand, aiCommand),
          allowedUserIds: qqAllowedUserIds,
        },
    wework: weworkEnabled
      ? {
          enabled: true,
          aiCommand: normalizeAiCommand(file.platforms?.wework?.aiCommand, aiCommand),
          allowedUserIds: weworkAllowedUserIds,
        }
      : {
          enabled: false,
          aiCommand: normalizeAiCommand(file.platforms?.wework?.aiCommand, aiCommand),
          allowedUserIds: weworkAllowedUserIds,
        },
    dingtalk: dingtalkEnabled
      ? {
          enabled: true,
          aiCommand: normalizeAiCommand(file.platforms?.dingtalk?.aiCommand, aiCommand),
          allowedUserIds: dingtalkAllowedUserIds,
          cardTemplateId: dingtalkCardTemplateId,
        }
      : {
          enabled: false,
          aiCommand: normalizeAiCommand(file.platforms?.dingtalk?.aiCommand, aiCommand),
          allowedUserIds: dingtalkAllowedUserIds,
          cardTemplateId: dingtalkCardTemplateId,
        },
    workbuddy: workbuddyEnabled
      ? {
          enabled: true,
          aiCommand: normalizeAiCommand(file.platforms?.workbuddy?.aiCommand, aiCommand),
          allowedUserIds: workbuddyAllowedUserIds,
          accessToken: workbuddyAccessToken,
          refreshToken: workbuddyRefreshToken,
          userId: workbuddyUserId,
          baseUrl: workbuddyBaseUrl,
          guid: workbuddyGuid,
          workspacePath: workbuddyWorkspacePath,
        }
      : {
          enabled: false,
          aiCommand: normalizeAiCommand(file.platforms?.workbuddy?.aiCommand, aiCommand),
          allowedUserIds: workbuddyAllowedUserIds,
          accessToken: workbuddyAccessToken,
          refreshToken: workbuddyRefreshToken,
          userId: workbuddyUserId,
          baseUrl: workbuddyBaseUrl,
          guid: workbuddyGuid,
          workspacePath: workbuddyWorkspacePath,
        },
  };

  return {
    enabledPlatforms,
    telegramBotToken: telegramBotToken ?? '',
    feishuAppId: feishuAppId ?? '',
    feishuAppSecret: feishuAppSecret ?? '',
    qqAppId: qqAppId ?? '',
    qqSecret: qqSecret ?? '',
    weworkCorpId: weworkCorpId ?? '',
    weworkSecret: weworkSecret ?? '',
    weworkWsUrl: weworkWsUrl,
    dingtalkClientId: dingtalkClientId ?? '',
    dingtalkClientSecret: dingtalkClientSecret ?? '',
    dingtalkCardTemplateId: dingtalkCardTemplateId ?? '',
    allowedUserIds,
    telegramAllowedUserIds,
    feishuAllowedUserIds,
    qqAllowedUserIds,
    weworkAllowedUserIds,
    dingtalkAllowedUserIds,
    workbuddyAllowedUserIds,
    aiCommand,
    codexCliPath,
    codebuddyCliPath,
    claudeProxy,
    codexProxy,
    claudeWorkDir,
    claudeTimeoutMs,
    codexTimeoutMs,
    codebuddyTimeoutMs,
    claudeModel: process.env.ANTHROPIC_MODEL,
    logDir,
    logLevel,
    platforms,
  };
}

/** 获取已配置凭证的平台列表 */
export function getPlatformsWithCredentials(config: Config): Platform[] {
  const r: Platform[] = [];
  if (config.telegramBotToken) r.push('telegram');
  if (config.feishuAppId && config.feishuAppSecret) r.push('feishu');
  if (config.qqAppId && config.qqSecret) r.push('qq');
  if (config.weworkCorpId && config.weworkSecret) r.push('wework');
  if (config.dingtalkClientId && config.dingtalkClientSecret) r.push('dingtalk');
  const wb = config.platforms.workbuddy;
  if (wb?.accessToken && wb?.refreshToken) r.push('workbuddy');
  return r;
}

export function resolvePlatformAiCommand(config: Config, platform: Platform): AiCommand {
  return config.platforms[platform]?.aiCommand ?? config.aiCommand;
}

export function getConfiguredAiCommands(config: Config): AiCommand[] {
  const commands = new Set<AiCommand>([config.aiCommand]);
  for (const platform of config.enabledPlatforms) {
    commands.add(resolvePlatformAiCommand(config, platform));
  }
  return Array.from(commands);
}
