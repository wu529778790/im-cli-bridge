export const defaultConfig = {
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
        timeout: 30000,
        maxConcurrent: 3,
        allowedCommands: ['*'],
        blockedCommands: [
            'rm -rf /',
            'mkfs',
            'dd if=/dev/zero',
            'chmod 000'
        ]
    },
    queue: {
        concurrency: 5,
        maxRetries: 3,
        retryDelay: 1000
    },
    watchdog: {
        enabled: true,
        timeout: 60000,
        checkInterval: 10000
    },
    storage: {
        type: 'sqlite',
        path: './data/storage.db'
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        maxFiles: 5,
        maxSize: '5m'
    }
};
export default defaultConfig;
//# sourceMappingURL=default.config.js.map