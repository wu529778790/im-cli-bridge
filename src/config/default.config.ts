import { IConfig } from '../interfaces/config';

export const defaultConfig: IConfig = {
  server: { port: 3000, host: 'localhost' },
  feishu: {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || ''
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || ''
  },
  executor: {
    timeout: 60000,
    aiCommand: process.env.AI_COMMAND || 'claude',
    allowedCommands: ['*'],
    blockedCommands: ['rm -rf /', 'mkfs', 'dd if=/dev/zero', 'chmod 000']
  },
  logging: {
    level: (process.env.LOG_LEVEL || 'info') as IConfig['logging']['level']
  }
};

export default defaultConfig;
