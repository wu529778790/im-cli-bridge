export declare const configSchema: {
    type: string;
    properties: {
        server: {
            type: string;
            properties: {
                port: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                host: {
                    type: string;
                };
            };
            required: string[];
        };
        feishu: {
            type: string;
            properties: {
                appId: {
                    type: string;
                };
                appSecret: {
                    type: string;
                };
                encryptKey: {
                    type: string;
                };
                verificationToken: {
                    type: string;
                };
                baseUrl: {
                    type: string;
                    format: string;
                };
            };
            required: string[];
        };
        telegram: {
            type: string;
            properties: {
                botToken: {
                    type: string;
                };
                webhookUrl: {
                    type: string;
                    format: string;
                };
                pollTimeout: {
                    type: string;
                    minimum: number;
                };
            };
            required: string[];
        };
        executor: {
            type: string;
            properties: {
                timeout: {
                    type: string;
                    minimum: number;
                };
                maxConcurrent: {
                    type: string;
                    minimum: number;
                };
                allowedCommands: {
                    type: string;
                    items: {
                        type: string;
                    };
                };
                blockedCommands: {
                    type: string;
                    items: {
                        type: string;
                    };
                };
            };
            required: string[];
        };
        queue: {
            type: string;
            properties: {
                concurrency: {
                    type: string;
                    minimum: number;
                };
                maxRetries: {
                    type: string;
                    minimum: number;
                };
                retryDelay: {
                    type: string;
                    minimum: number;
                };
            };
            required: string[];
        };
        watchdog: {
            type: string;
            properties: {
                enabled: {
                    type: string;
                };
                timeout: {
                    type: string;
                    minimum: number;
                };
                checkInterval: {
                    type: string;
                    minimum: number;
                };
            };
            required: string[];
        };
        storage: {
            type: string;
            properties: {
                type: {
                    type: string;
                    enum: string[];
                };
                path: {
                    type: string;
                };
            };
            required: string[];
        };
        logging: {
            type: string;
            properties: {
                level: {
                    type: string;
                    enum: string[];
                };
                maxFiles: {
                    type: string;
                    minimum: number;
                };
                maxSize: {
                    type: string;
                };
            };
            required: string[];
        };
    };
    required: string[];
};
export declare function validateConfig(config: any): {
    valid: boolean;
    errors?: string[];
};
export default configSchema;
//# sourceMappingURL=schema.d.ts.map