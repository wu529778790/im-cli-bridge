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
            },
            required: ['appId', 'appSecret']
        },
        telegram: {
            type: 'object',
            properties: {
                botToken: { type: 'string' },
                webhookUrl: { type: 'string', format: 'uri' },
                pollTimeout: { type: 'number', minimum: 1 }
            },
            required: ['botToken']
        },
        executor: {
            type: 'object',
            properties: {
                timeout: { type: 'number', minimum: 1000 },
                maxConcurrent: { type: 'number', minimum: 1 },
                allowedCommands: { type: 'array', items: { type: 'string' } },
                blockedCommands: { type: 'array', items: { type: 'string' } }
            },
            required: ['timeout', 'maxConcurrent']
        },
        queue: {
            type: 'object',
            properties: {
                concurrency: { type: 'number', minimum: 1 },
                maxRetries: { type: 'number', minimum: 0 },
                retryDelay: { type: 'number', minimum: 0 }
            },
            required: ['concurrency', 'maxRetries']
        },
        watchdog: {
            type: 'object',
            properties: {
                enabled: { type: 'boolean' },
                timeout: { type: 'number', minimum: 1000 },
                checkInterval: { type: 'number', minimum: 100 }
            },
            required: ['enabled', 'timeout']
        },
        storage: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['sqlite', 'memory'] },
                path: { type: 'string' }
            },
            required: ['type']
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
    required: ['server', 'executor', 'queue', 'storage']
};
export function validateConfig(config) {
    const errors = [];
    // Basic validation
    if (!config.server || typeof config.server.port !== 'number') {
        errors.push('server.port is required and must be a number');
    }
    if (!config.executor || typeof config.executor.timeout !== 'number') {
        errors.push('executor.timeout is required and must be a number');
    }
    if (!config.queue || typeof config.queue.concurrency !== 'number') {
        errors.push('queue.concurrency is required and must be a number');
    }
    // Check for at least one IM client configuration
    if ((!config.feishu || !config.feishu.appId) &&
        (!config.telegram || !config.telegram.botToken)) {
        errors.push('At least one IM client (feishu or telegram) must be configured');
    }
    return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined
    };
}
export default configSchema;
//# sourceMappingURL=schema.js.map