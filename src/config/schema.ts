import { IConfig } from '../interfaces/config';

export const configSchema = {
  type: 'object',
  properties: {
    server: {
      type: 'object',
      properties: {
        port: { type: 'number', minimum: 1, maximum: 65535 },
        host: { type: 'string' }
      },
      required: ['port', 'host']
    },
    feishu: {
      type: 'object',
      properties: {
        appId: { type: 'string' },
        appSecret: { type: 'string' },
        encryptKey: { type: 'string' },
        verificationToken: { type: 'string' },
        baseUrl: { type: 'string', format: 'uri' }
      }
    },
    telegram: {
      type: 'object',
      properties: {
        botToken: { type: 'string' },
        webhookUrl: { type: 'string', format: 'uri' },
        pollTimeout: { type: 'number', minimum: 1 }
      }
    },
    executor: {
      type: 'object',
      properties: {
        timeout: { type: 'number', minimum: 1000 },
        maxConcurrent: { type: 'number', minimum: 1 },
        aiCommand: { type: 'string' },
        allowedCommands: { type: 'array', items: { type: 'string' } },
        blockedCommands: { type: 'array', items: { type: 'string' } }
      },
      required: ['timeout', 'aiCommand']
    },
    logging: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
        maxFiles: { type: 'number', minimum: 1 },
        maxSize: { type: 'string' }
      },
      required: ['level']
    }
  },
  required: ['server', 'executor', 'logging']
};

export function validateConfig(config: any): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];

  if (!config.server || typeof config.server?.port !== 'number') {
    errors.push('server.port is required and must be a number');
  }

  if (!config.executor?.aiCommand) {
    errors.push('executor.aiCommand is required');
  }

  if ((!config.feishu?.appId) && (!config.telegram?.botToken)) {
    errors.push('At least one IM client (feishu or telegram) must be configured');
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}

export default configSchema;
