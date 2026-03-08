/**
 * Main configuration interface for im-cli-bridge
 */

export interface IServerConfig {
  port: number;
  host: string;
}

export interface IFeishuConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  baseUrl: string;
}

export interface ITelegramConfig {
  botToken: string;
  webhookUrl?: string;
  pollTimeout: number;
}

export interface IExecutorConfig {
  timeout: number;
  maxConcurrent: number;
  aiCommand: string;
  allowedCommands: string[];
  blockedCommands: string[];
}

export interface ILoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  maxFiles: number;
  maxSize: string;
}

export interface IConfig {
  server: IServerConfig;
  feishu?: IFeishuConfig;
  telegram?: ITelegramConfig;
  executor: IExecutorConfig;
  logging: ILoggingConfig;
}
