/**
 * 配置接口定义
 */

/**
 * 执行器配置接口
 */
export interface ExecutorConfig {
  /** 默认工作目录 */
  defaultWorkingDirectory?: string;
  /** 默认超时时间（毫秒） */
  defaultTimeout?: number;
  /** 最大并发执行数 */
  maxConcurrent?: number;
  /** 允许的命令列表 */
  allowedCommands?: string[];
  /** 禁止的命令列表 */
  blockedCommands?: string[];
  /** 是否启用沙箱 */
  sandboxEnabled?: boolean;
  /** 沙箱配置 */
  sandboxConfig?: {
    /** 允许的路径 */
    allowedPaths?: string[];
    /** 拒绝的路径 */
    deniedPaths?: string[];
    /** 允许的环境变量 */
    allowedEnvVars?: string[];
  };
  /** Shell类型 */
  shell?: string;
  /** 环境变量 */
  env?: Record<string, string>;
}

/**
 * 平台配置接口
 */
export interface PlatformConfig {
  /** 平台类型 */
  platform: 'feishu' | 'dingtalk' | 'wechat' | 'slack';
  /** 应用ID */
  appId: string;
  /** 应用密钥 */
  appSecret: string;
  /** 加密密钥 */
  encryptKey?: string;
  /** 验证令牌 */
  verifyToken?: string;
  /** API端点 */
  apiEndpoint?: string;
  /** 事件端点 */
  eventEndpoint?: string;
  /** 是否启用事件订阅 */
  eventsEnabled?: boolean;
  /** 订阅的事件列表 */
  subscribedEvents?: string[];
  /** 自定义配置 */
  customConfig?: Record<string, any>;
}

/**
 * 日志配置接口
 */
export interface LogConfig {
  /** 日志级别 */
  level?: 'debug' | 'info' | 'warn' | 'error';
  /** 日志文件路径 */
  filePath?: string;
  /** 最大文件大小（MB） */
  maxSize?: number;
  /** 最大文件数量 */
  maxFiles?: number;
  /** 是否输出到控制台 */
  console?: boolean;
  /** 日志格式 */
  format?: 'json' | 'text';
}

/**
 * 安全配置接口
 */
export interface SecurityConfig {
  /** 是否启用认证 */
  authEnabled?: boolean;
  /** 允许的用户ID列表 */
  allowedUsers?: string[];
  /** 允许的群组ID列表 */
  allowedGroups?: string[];
  /** 管理员用户ID列表 */
  adminUsers?: string[];
  /** 命令白名单 */
  commandWhitelist?: string[];
  /** 命令黑名单 */
  commandBlacklist?: string[];
  /** 最大执行次数（每分钟） */
  maxExecutionsPerMinute?: number;
  /** 是否启用速率限制 */
  rateLimitEnabled?: boolean;
}

/**
 * 桥接配置接口
 */
export interface BridgeConfig {
  /** 服务端口 */
  port?: number;
  /** 服务主机 */
  host?: string;
  /** 平台配置 */
  platform: PlatformConfig;
  /** 执行器配置 */
  executor: ExecutorConfig;
  /** 日志配置 */
  logging?: LogConfig;
  /** 安全配置 */
  security?: SecurityConfig;
  /** 是否启用调试模式 */
  debug?: boolean;
  /** 会话超时时间（毫秒） */
  sessionTimeout?: number;
  /** 最大会话数 */
  maxSessions?: number;
  /** 存储路径 */
  storagePath?: string;
  /** 自定义配置 */
  customConfig?: Record<string, any>;
}
