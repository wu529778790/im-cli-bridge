try {
  await import('dotenv/config');
} catch {
  /* dotenv optional */
}

import { readFileSync, writeFileSync, accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import type { LogLevel } from './logger.js';
import { APP_HOME } from './constants.js';

export type Platform = 'dingtalk' | 'feishu' | 'qq' | 'telegram' | 'wechat' | 'wework';

export type AiCommand = 'claude' | 'codex' | 'cursor';

export interface Config {
  enabledPlatforms: Platform[];

  // 运行时使用的凭证（来源可以是 env 或 config.json）
  telegramBotToken?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  wechatAppId?: string;
  wechatAppSecret?: string;
  wechatToken?: string;     // AGP 协议 token
  wechatJwtToken?: string;  // AGP 协议 jwtToken
  wechatLoginKey?: string;  // AGP 协议 loginKey
  wechatGuid?: string;      // AGP 协议 guid
  wechatUserId?: string;    // AGP 协议 userId
  wechatWsUrl?: string;
  weworkCorpId?: string;  // 企业微信 Bot ID
  weworkSecret?: string;   // 企业微信 Secret
  weworkWsUrl?: string;    // 企业微信 WebSocket URL（可选，默认使用官方服务）
  dingtalkClientId?: string;
  dingtalkClientSecret?: string;
  dingtalkCardTemplateId?: string;
  qqAppId?: string;
  qqSecret?: string;
  qqSandbox: boolean;

  // 全局白名单（旧版兼容）
  allowedUserIds: string[];
  // 分平台白名单（新配置推荐）
  telegramAllowedUserIds: string[];
  feishuAllowedUserIds: string[];
  qqAllowedUserIds: string[];
  wechatAllowedUserIds: string[];
  weworkAllowedUserIds: string[];
  dingtalkAllowedUserIds: string[];

  aiCommand: AiCommand;
  claudeCliPath: string;
  cursorCliPath: string;
  codexCliPath: string;
  /** Codex 访问 chatgpt.com 的代理（如 http://127.0.0.1:7890） */
  codexProxy?: string;
  claudeWorkDir: string;
  claudeSkipPermissions: boolean;
  defaultPermissionMode: 'ask' | 'accept-edits' | 'plan' | 'yolo';
  claudeTimeoutMs: number;
  claudeModel?: string;
  hookPort: number;
  logDir: string;
  logLevel: LogLevel;
  /** 是否使用 Agent SDK（进程内执行，无 spawn 开销，响应更快） */
  useSdkMode: boolean;

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
    qq?: {
      enabled: boolean;
      sandbox?: boolean;
      allowedUserIds: string[];
    };
    wechat?: {
      enabled: boolean;
      wsUrl?: string;
      token?: string;
      jwtToken?: string;
      loginKey?: string;
      guid?: string;
      userId?: string;
      allowedUserIds: string[];
    };
    wework?: {
      enabled: boolean;
      allowedUserIds: string[];
    };
    dingtalk?: {
      enabled: boolean;
      allowedUserIds: string[];
      cardTemplateId?: string;
    };
  };
}

export interface FilePlatformTelegram {
  enabled?: boolean;
  botToken?: string;
  allowedUserIds?: string[];
  proxy?: string;
}

export interface FilePlatformFeishu {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  allowedUserIds?: string[];
}

interface FilePlatformQQ {
  enabled?: boolean;
  appId?: string;
  secret?: string;
  sandbox?: boolean;
  allowedUserIds?: string[];
}

interface FilePlatformWechat {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  token?: string;      // AGP 协议 token
  jwtToken?: string;   // JWT Token，用于刷新 channel_token
  loginKey?: string;   // 4026 登录返回的 loginKey
  guid?: string;       // AGP 协议 guid
  userId?: string;     // AGP 协议 userId
  wsUrl?: string;
  allowedUserIds?: string[];
}

export interface FilePlatformWework {
  enabled?: boolean;
  corpId?: string;  // Bot ID
  secret?: string;
  wsUrl?: string;
  allowedUserIds?: string[];
}

export interface FilePlatformDingtalk {
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
  allowedUserIds?: string[];
  cardTemplateId?: string;
}

export interface FileToolClaude {
  cliPath?: string;
  workDir?: string;
  skipPermissions?: boolean;
  timeoutMs?: number;
  model?: string;
}

export interface FileToolCursor {
  cliPath?: string;
  /** 是否跳过权限确认（默认 true，与 tools.claude 共用权限服务器） */
  skipPermissions?: boolean;
}

export interface FileToolCodex {
  cliPath?: string;
  workDir?: string;
  /** 是否跳过权限确认（默认 true） */
  skipPermissions?: boolean;
  /** HTTP/HTTPS 代理，用于访问 chatgpt.com（如 http://127.0.0.1:7890） */
  proxy?: string;
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
  };

  env?: Record<string, string>;
  aiCommand?: string;
  tools?: {
    claude?: FileToolClaude;
    cursor?: FileToolCursor;
    codex?: FileToolCodex;
  };
  defaultPermissionMode?: 'ask' | 'accept-edits' | 'plan' | 'yolo';
  hookPort?: number;
  logDir?: string;
  logLevel?: LogLevel;
  useSdkMode?: boolean;
}

export const CONFIG_PATH = join(APP_HOME, 'config.json');
const CODEX_AUTH_PATHS = [
  join(homedir(), '.codex', 'auth.json'),
  join(homedir(), '.config', 'codex', 'auth.json'),
  join(homedir(), 'AppData', 'Roaming', 'codex', 'auth.json'),
];

const OLD_ROOT_KEYS = [
  'claudeWorkDir', 'claudeSkipPermissions', 'claudeCliPath', 'cursorCliPath',
  'claudeTimeoutMs', 'claudeModel',
] as const;

function hasOldConfigFormat(raw: Record<string, unknown>): boolean {
  const hasOld = OLD_ROOT_KEYS.some((k) => raw[k] !== undefined && raw[k] !== null);
  const hasNew = raw.tools && typeof raw.tools === 'object' && (raw.tools as Record<string, unknown>).claude;
  return !!hasOld && !hasNew;
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
  const tcur = (tools.cursor as Record<string, unknown>) || {};
  const tcod = (tools.codex as Record<string, unknown>) || {};

  const migrated: Record<string, unknown> = { ...raw };
  migrated.tools = {
    claude: {
      ...tc,
      cliPath: tc.cliPath ?? raw.claudeCliPath ?? 'claude',
      workDir: tc.workDir ?? raw.claudeWorkDir ?? process.cwd(),
      skipPermissions: tc.skipPermissions ?? raw.claudeSkipPermissions ?? true,
      timeoutMs: tc.timeoutMs ?? raw.claudeTimeoutMs ?? 600000,
      model: tc.model ?? raw.claudeModel,
    },
    cursor: {
      ...tcur,
      cliPath: tcur.cliPath ?? raw.cursorCliPath ?? 'agent',
      skipPermissions: tcur.skipPermissions ?? raw.claudeSkipPermissions ?? true,
    },
    codex: {
      ...tcod,
      cliPath: tcod.cliPath ?? 'codex',
      workDir: tcod.workDir ?? raw.claudeWorkDir ?? process.cwd(),
      skipPermissions: tcod.skipPermissions ?? raw.claudeSkipPermissions ?? true,
      proxy: tcod.proxy,
    },
  };

  for (const k of OLD_ROOT_KEYS) {
    delete migrated[k];
  }
  return migrated;
}

/** 确保 cursor/codex 有 skipPermissions（缺失时从 claude 继承并写回） */
function ensureToolsSkipPermissions(raw: Record<string, unknown>): boolean {
  const tools = raw.tools as Record<string, unknown> | undefined;
  if (!tools || typeof tools !== 'object') return false;
  const tc = (tools.claude as Record<string, unknown>) || {};
  const fallback = tc.skipPermissions ?? true;
  let changed = false;
  if (tools.cursor && typeof tools.cursor === 'object') {
    const cur = tools.cursor as Record<string, unknown>;
    if (cur.skipPermissions === undefined) {
      cur.skipPermissions = fallback;
      changed = true;
    }
  }
  if (tools.codex && typeof tools.codex === 'object') {
    const cod = tools.codex as Record<string, unknown>;
    if (cod.skipPermissions === undefined) {
      cod.skipPermissions = fallback;
      changed = true;
    }
  }
  if (changed) {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8');
  }
  return changed;
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
    ensureToolsSkipPermissions(raw);
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
function getClaudeConfigHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

/** 从 Claude Code 配置文件加载 env，支持多路径（与 Claude Code 共用） */
function loadClaudeSettingsEnv(): Record<string, string> {
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

/** 检查是否已配置 Claude API 凭证 */
export function hasClaudeCredentials(): boolean {
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
  if (process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET) return false;
  if (process.env.WECHAT_TOKEN && process.env.WECHAT_GUID && process.env.WECHAT_USER_ID) return false;
  if (process.env.WEWORK_CORP_ID && process.env.WEWORK_SECRET) return false;
  if (process.env.DINGTALK_CLIENT_ID && process.env.DINGTALK_CLIENT_SECRET) return false;

  const file = loadFileConfig();
  const tg = file.platforms?.telegram;
  const fs = file.platforms?.feishu;
  const qq = file.platforms?.qq;
  const wc = file.platforms?.wechat;
  const ww = file.platforms?.wework;
  const dt = file.platforms?.dingtalk;

  const hasTelegram = !!tg?.botToken;
  const hasFeishu = !!(fs?.appId && fs?.appSecret);
  const hasQQ = !!(qq?.appId && qq?.secret);
  // 微信支持 AGP 协议（token + guid + userId）或标准协议（appId + appSecret）
  const hasWechat = !!(wc?.token && wc?.guid && wc?.userId) || !!(wc?.appId && wc?.appSecret);
  // 企业微信只需要 corpId 和 secret
  const hasWework = !!(ww?.corpId && ww?.secret);
  const hasDingtalk = !!(dt?.clientId && dt?.clientSecret);

  return !hasTelegram && !hasFeishu && !hasQQ && !hasWechat && !hasWework && !hasDingtalk;
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
  if (file.env) mergeEnv(file.env as Record<string, unknown>);

  // 从 Claude Code 配置合并 API 凭证（~/.claude/settings.json 或 ~/.claude.json，最低优先级）
  const claudeEnv = loadClaudeSettingsEnv();
  mergeEnv(claudeEnv);

  const fileTelegram = file.platforms?.telegram;
  const fileFeishu = file.platforms?.feishu;
  const fileQQ = file.platforms?.qq;
  const fileWechat = file.platforms?.wechat;
  const fileWework = file.platforms?.wework;
  const fileDingtalk = file.platforms?.dingtalk;

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
  const qqSandbox =
    process.env.QQ_BOT_SANDBOX !== undefined
      ? process.env.QQ_BOT_SANDBOX === '1' || process.env.QQ_BOT_SANDBOX === 'true'
      : fileQQ?.sandbox ?? false;

  // 微信支持两种协议：
  // 1. AGP 协议：token + guid + userId（推荐）
  // 2. 标准协议：appId + appSecret
  const wechatToken =
    process.env.WECHAT_TOKEN ??
    fileWechat?.token;
  const wechatJwtToken = fileWechat?.jwtToken;
  const wechatLoginKey = fileWechat?.loginKey;
  const wechatGuid =
    process.env.WECHAT_GUID ??
    fileWechat?.guid;
  const wechatUserId =
    process.env.WECHAT_USER_ID ??
    fileWechat?.userId;

  const wechatAppId =
    process.env.WECHAT_APP_ID ??
    fileWechat?.appId;
  const wechatAppSecret =
    process.env.WECHAT_APP_SECRET ??
    fileWechat?.appSecret;
  const wechatWsUrl =
    process.env.WECHAT_WS_URL ??
    fileWechat?.wsUrl;

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

  // 2. 计算启用平台
  const enabledPlatforms: Platform[] = [];

  const telegramEnabledFlag = fileTelegram?.enabled;
  const feishuEnabledFlag = fileFeishu?.enabled;
  const qqEnabledFlag = fileQQ?.enabled;
  const wechatEnabledFlag = fileWechat?.enabled;
  const weworkEnabledFlag = fileWework?.enabled;
  const dingtalkEnabledFlag = fileDingtalk?.enabled;

  const telegramEnabled =
    !!telegramBotToken && (telegramEnabledFlag !== false);
  const feishuEnabled =
    !!(feishuAppId && feishuAppSecret) && (feishuEnabledFlag !== false);
  const qqEnabled =
    !!(qqAppId && qqSecret) && (qqEnabledFlag !== false);
  // 微信启用条件：AGP 协议凭证 或 标准协议凭证
  const hasWechatAGPCreds = !!(wechatToken && wechatGuid && wechatUserId);
  const hasWechatStandardCreds = !!(wechatAppId && wechatAppSecret);
  const wechatEnabled =
    (hasWechatAGPCreds || hasWechatStandardCreds) && (wechatEnabledFlag !== false);
  // 企业微信只需要 corpId (botId) 和 secret
  const weworkEnabled =
    !!(weworkCorpId && weworkSecret) && (weworkEnabledFlag !== false);
  const dingtalkEnabled =
    !!(dingtalkClientId && dingtalkClientSecret) && (dingtalkEnabledFlag !== false);

  if (telegramEnabled) enabledPlatforms.push('telegram');
  if (feishuEnabled) enabledPlatforms.push('feishu');
  if (qqEnabled) enabledPlatforms.push('qq');
  if (wechatEnabled) enabledPlatforms.push('wechat');
  if (weworkEnabled) enabledPlatforms.push('wework');
  if (dingtalkEnabled) enabledPlatforms.push('dingtalk');

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

  const wechatAllowedUserIds =
    process.env.WECHAT_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.WECHAT_ALLOWED_USER_IDS)
      : fileWechat?.allowedUserIds ?? allowedUserIds;

  const weworkAllowedUserIds =
    process.env.WEWORK_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.WEWORK_ALLOWED_USER_IDS)
      : fileWework?.allowedUserIds ?? allowedUserIds;

  const dingtalkAllowedUserIds =
    process.env.DINGTALK_ALLOWED_USER_IDS !== undefined
      ? parseCommaSeparated(process.env.DINGTALK_ALLOWED_USER_IDS)
      : fileDingtalk?.allowedUserIds ?? allowedUserIds;

  // 5. AI / 工作目录 / 安全配置（从 tools 读取）
  const aiCommand = (process.env.AI_COMMAND ?? file.aiCommand ?? 'claude') as AiCommand;
  const tc = file.tools?.claude ?? {};
  const tcur = file.tools?.cursor ?? {};
  const tcod = file.tools?.codex ?? {};

  const claudeCliPath = process.env.CLAUDE_CLI_PATH ?? tc.cliPath ?? 'claude';
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
  let cursorCliPath = process.env.CURSOR_CLI_PATH ?? tcur.cliPath ?? 'agent';
  if (process.platform === 'win32' && cursorCliPath === 'agent') {
    const winAgentPath = join(process.env.LOCALAPPDATA || '', 'cursor-agent', 'agent.cmd');
    try {
      accessSync(winAgentPath, constants.F_OK);
      cursorCliPath = winAgentPath;
    } catch {
      /* 使用默认 agent */
    }
  }
  const claudeWorkDir = process.env.CLAUDE_WORK_DIR ?? tc.workDir ?? process.cwd();

  // 按当前 AI 工具选择 skipPermissions：claude 用 tools.claude，cursor 用 tools.cursor（fallback claude），codex 用 tools.codex（fallback claude）
  const claudeSkipPermissions = (() => {
    if (process.env.CLAUDE_SKIP_PERMISSIONS !== undefined) return process.env.CLAUDE_SKIP_PERMISSIONS === 'true';
    if (process.env.CURSOR_SKIP_PERMISSIONS !== undefined && aiCommand === 'cursor') return process.env.CURSOR_SKIP_PERMISSIONS === 'true';
    if (aiCommand === 'cursor') return tcur.skipPermissions ?? tc.skipPermissions ?? true;
    if (aiCommand === 'codex') return tcod.skipPermissions ?? tc.skipPermissions ?? true;
    return tc.skipPermissions ?? true;
  })();

  const defaultPermissionMode = (file.defaultPermissionMode ?? 'ask') as 'ask' | 'accept-edits' | 'plan' | 'yolo';

  const claudeTimeoutMs =
    process.env.CLAUDE_TIMEOUT_MS !== undefined
      ? parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 600000
      : tc.timeoutMs ?? 600000;

  const hookPort =
    process.env.HOOK_PORT !== undefined
      ? parseInt(process.env.HOOK_PORT, 10) || 35801
      : file.hookPort ?? 35801;

  // 当使用 Claude 时，强制使用 SDK 模式（更快，无需安装 CLI）
  // 使用其他工具（codex/cursor）时，才根据配置决定
  const useSdkMode = aiCommand === 'claude' || (
    process.env.USE_SDK_MODE !== undefined
      ? process.env.USE_SDK_MODE === 'true'
      : file.useSdkMode ?? true
  );

  // 6. 校验 Claude API 凭证（SDK 模式需要）
  // 支持：官方 API Key、Auth Token、或自定义 API（第三方模型等，BASE_URL + token）
  if (aiCommand === 'claude' && useSdkMode) {
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
        '方式 3：编辑 ~/.open-im/config.json 的 env 字段',
        '  或 ~/.claude/settings.json（与 Claude Code 共用）',
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
      console.warn(
        '\n⚠ Codex 模式：未检测到 OPENAI_API_KEY 或 Codex 登录态。首次使用请先运行 codex login，\n' +
        '  或在 ~/.open-im/config.json 的 env 中添加 "OPENAI_API_KEY": "你的 API Key"。\n'
      );
    }
  }

  // 8. 校验 Cursor CLI（使用 cursor 时）
  if (aiCommand === 'cursor') {
    if (isAbsolute(cursorCliPath) || cursorCliPath.includes('/') || cursorCliPath.includes('\\')) {
      try {
        accessSync(cursorCliPath, constants.F_OK);
      } catch {
        throw new Error(`Cursor CLI 不可执行: ${cursorCliPath}`);
      }
    } else {
      const checkCommand = process.platform === 'win32' ? 'where' : 'which';
      try {
        execFileSync(checkCommand, [cursorCliPath], {
          stdio: 'pipe',
          windowsHide: process.platform === 'win32',
        });
      } catch {
        const installGuide = [
        '',
        '━━━ Cursor CLI 未安装 ━━━',
        '',
        '使用 Cursor 需要先安装 Cursor Agent CLI。',
        '',
        '安装方法：',
        '',
        '  macOS/Linux: curl https://cursor.com/install -fsSL | bash',
        '  Windows: irm \'https://cursor.com/install?win32=true\' | iex',
        '',
        '安装后运行 agent --version 验证。',
        '',
      ].join('\n');
      throw new Error(installGuide);
      }
    }
    // 提示 Cursor 认证：需 agent login 或 CURSOR_API_KEY
    if (!process.env.CURSOR_API_KEY) {
      console.warn(
        '\n⚠ Cursor 模式：未检测到 CURSOR_API_KEY。首次使用请先运行 agent login，\n' +
        '  或在 ~/.open-im/config.json 的 env 中添加 "CURSOR_API_KEY": "你的 API Key"。\n'
      );
    }
  }

  // 9. 校验 Claude CLI（SDK 模式不需要 CLI）
  if (aiCommand === 'claude' && !useSdkMode) {
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
        execFileSync(checkCommand, [claudeCliPath], {
          stdio: 'pipe',
          windowsHide: process.platform === 'win32',
        });
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
          '安装后重新运行，例如：',
          '  open-im dev',
          '  或 open-im start',
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
    qq: qqEnabled
      ? {
          enabled: true,
          sandbox: qqSandbox,
          allowedUserIds: qqAllowedUserIds,
        }
      : {
          enabled: false,
          sandbox: qqSandbox,
          allowedUserIds: qqAllowedUserIds,
        },
    wechat: wechatEnabled
      ? {
          enabled: true,
          wsUrl: wechatWsUrl,
          token: wechatToken,
          jwtToken: wechatJwtToken,
          loginKey: wechatLoginKey,
          guid: wechatGuid,
          userId: wechatUserId,
          allowedUserIds: wechatAllowedUserIds,
        }
      : {
          enabled: false,
          wsUrl: wechatWsUrl,
          token: wechatToken,
          jwtToken: wechatJwtToken,
          loginKey: wechatLoginKey,
          guid: wechatGuid,
          userId: wechatUserId,
          allowedUserIds: wechatAllowedUserIds,
        },
    wework: weworkEnabled
      ? {
          enabled: true,
          allowedUserIds: weworkAllowedUserIds,
        }
      : {
          enabled: false,
          allowedUserIds: weworkAllowedUserIds,
        },
    dingtalk: dingtalkEnabled
      ? {
          enabled: true,
          allowedUserIds: dingtalkAllowedUserIds,
          cardTemplateId: dingtalkCardTemplateId,
        }
      : {
          enabled: false,
          allowedUserIds: dingtalkAllowedUserIds,
          cardTemplateId: dingtalkCardTemplateId,
        },
  };

  return {
    enabledPlatforms,
    telegramBotToken: telegramBotToken ?? '',
    feishuAppId: feishuAppId ?? '',
    feishuAppSecret: feishuAppSecret ?? '',
    qqAppId: qqAppId ?? '',
    qqSecret: qqSecret ?? '',
    qqSandbox,
    wechatAppId: wechatAppId ?? '',
    wechatAppSecret: wechatAppSecret ?? '',
    wechatToken: wechatToken,
    wechatJwtToken: wechatJwtToken,
    wechatLoginKey: wechatLoginKey,
    wechatGuid: wechatGuid,
    wechatUserId: wechatUserId,
    wechatWsUrl: wechatWsUrl,
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
    wechatAllowedUserIds,
    weworkAllowedUserIds,
    dingtalkAllowedUserIds,
    aiCommand,
    claudeCliPath,
    cursorCliPath,
    codexCliPath,
    codexProxy,
    claudeWorkDir,
    claudeSkipPermissions,
    defaultPermissionMode,
    claudeTimeoutMs,
    claudeModel: process.env.CLAUDE_MODEL ?? tc.model,
    hookPort,
    logDir,
    logLevel,
    useSdkMode,
    platforms,
  };
}

/** 获取已配置凭证的平台列表（用于多通道启动时让用户选择），顺序：Telegram、飞书、企业微信、微信 */
export function getPlatformsWithCredentials(config: Config): Platform[] {
  const r: Platform[] = [];
  if (config.telegramBotToken) r.push('telegram');
  if (config.feishuAppId && config.feishuAppSecret) r.push('feishu');
  if (config.qqAppId && config.qqSecret) r.push('qq');
  if (config.weworkCorpId && config.weworkSecret) r.push('wework');
  if (config.dingtalkClientId && config.dingtalkClientSecret) r.push('dingtalk');
  const hasWechat =
    (config.wechatToken && config.wechatGuid && config.wechatUserId) ||
    (config.wechatAppId && config.wechatAppSecret);
  if (hasWechat) r.push('wechat');
  return r;
}
