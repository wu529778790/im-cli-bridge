import type { LogLevel } from '../logger.js';

export type Platform = 'dingtalk' | 'feishu' | 'qq' | 'telegram' | 'wework' | 'workbuddy';

export type AiCommand = 'claude' | 'codex' | 'codebuddy';

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
  claudeWorkDir: string;
  claudeModel?: string;
  /** 是否跳过 AI 工具的权限确认（默认 true） */
  skipPermissions?: boolean;
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

export interface FilePlatformQQ {
  enabled?: boolean;
  appId?: string;
  secret?: string;
  aiCommand?: AiCommand;
  allowedUserIds?: string[];
}

export interface FilePlatformWechat {
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

export interface FilePlatformWorkBuddy {
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
  skipPermissions?: boolean;
  /** HTTP/HTTPS 代理，用于访问 Claude API（如 http://127.0.0.1:7890） */
  proxy?: string;
  /** Claude API 配置（优先级：环境变量 > tools.claude.env > ~/.claude/settings.json） */
  env?: Record<string, string>;
}

export interface FileToolCodex {
  cliPath?: string;
  workDir?: string;
  /** HTTP/HTTPS 代理，用于访问 chatgpt.com（如 http://127.0.0.1:7890） */
  proxy?: string;
}

export interface FileToolCodeBuddy {
  cliPath?: string;
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
