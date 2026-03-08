/**
 * 配置接口
 */

export interface IConfig {
  server: { port: number; host: string };
  feishu?: { appId: string; appSecret: string };
  telegram?: { botToken: string; webhookUrl?: string };
  executor: {
    timeout: number;
    aiCommand: string;
    allowedCommands: string[];
    blockedCommands: string[];
  };
  logging: { level: 'debug' | 'info' | 'warn' | 'error' };
}
