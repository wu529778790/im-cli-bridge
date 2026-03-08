import { IConfig } from '../interfaces/config';

export const defaultConfig: IConfig = {
  server: {
    port: 3000,
    host: 'localhost'
  },
  feishu: {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    encryptKey: process.env.FEISHU_ENCRYPT_KEY || '',
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || '',
    baseUrl: 'https://open.feishu.cn'
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '',
    pollTimeout: 10
  },
  executor: {
    timeout: 60000,
    maxConcurrent: 3,
    aiCommand: process.env.AI_COMMAND || 'claude',
    allowedCommands: ['*'],
    blockedCommands: [
      'rm -rf /',
      'mkfs',
      'dd if=/dev/zero',
      'chmod 000'
    ]
  },
  logging: {
    level: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
    maxFiles: 5,
    maxSize: '5m'
  }
};

export default defaultConfig;
