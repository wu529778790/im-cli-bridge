/**
 * 敏感信息脱敏工具
 * 用于日志记录和错误报告中隐藏敏感信息
 */

export interface SanitizationRule {
  name: string;
  pattern: RegExp;
  replacement: string;
  description: string;
}

/**
 * 敏感信息脱敏器
 */
export class SensitiveDataSanitizer {
  private rules: SanitizationRule[] = [];

  constructor() {
    this.initializeDefaultRules();
  }

  /**
   * 初始化默认脱敏规则
   */
  private initializeDefaultRules(): void {
    this.rules = [
      // Telegram Bot Token
      {
        name: 'telegram_bot_token',
        pattern: /\b\d+:[A-Za-z0-9_-]{35}\b/g,
        replacement: 'TELEGRAM_BOT_TOKEN:***',
        description: 'Telegram bot token'
      },
      // Telegram Bot Token (alternative format)
      {
        name: 'telegram_bot_token_alt',
        pattern: /\bbot\d+:[A-Za-z0-9_-]{35}\b/g,
        replacement: 'TELEGRAM_BOT_TOKEN:***',
        description: 'Telegram bot token (alternative)'
      },
      // Feishu App Credentials
      {
        name: 'feishu_app_id',
        pattern: /\b(app_id|appId)["']?\s*[:=]\s*["']?[a-zA-Z0-9_-]{8,32}["']?\b/g,
        replacement: 'FEISHU_APP_ID:***',
        description: 'Feishu app ID'
      },
      {
        name: 'feishu_app_secret',
        pattern: /\b(app_secret|appSecret|app_secret)["']?\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,64}["']?\b/g,
        replacement: 'FEISHU_APP_SECRET:***',
        description: 'Feishu app secret'
      },
      {
        name: 'feishu_encrypt_key',
        pattern: /\b(encrypt_key|encryptKey)["']?\s*[:=]\s*["']?[a-zA-Z0-9_/+]{16,64}["']?\b/g,
        replacement: 'FEISHU_ENCRYPT_KEY:***',
        description: 'Feishu encrypt key'
      },
      // API Keys
      {
        name: 'openai_api_key',
        pattern: /\b(sk-|OPENAI_API_KEY|openai_api_key)["']?\s*[:=]\s*["']?[a-zA-Z0-9_-]{20,64}["']?\b/gi,
        replacement: 'API_KEY:***',
        description: 'OpenAI API key'
      },
      {
        name: 'anthropic_api_key',
        pattern: /\b(sk-ant-)[a-zA-Z0-9_-]{20,64}\b/gi,
        replacement: 'ANTHROPIC_API_KEY:***',
        description: 'Anthropic API key'
      },
      {
        name: 'generic_api_key',
        pattern: /\b(api[_-]?key|apikey|api-key)["']?\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,128}["']?\b/gi,
        replacement: 'API_KEY:***',
        description: 'Generic API key'
      },
      // JWT Tokens
      {
        name: 'jwt_token',
        pattern: /\b(ey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
        replacement: 'JWT:***',
        description: 'JWT token'
      },
      // Bearer Tokens
      {
        name: 'bearer_token',
        pattern: /\bBearer\s+[A-Za-z0-9_-]{10,}\b/gi,
        replacement: 'Bearer ***',
        description: 'Bearer token'
      },
      // Passwords
      {
        name: 'password',
        pattern: /\b(password|passwd|pwd)["']?\s*[:=]\s*["']?[^\s"']{4,}["']?\b/gi,
        replacement: 'PASSWORD:***',
        description: 'Password'
      },
      // URLs with potential sensitive data
      {
        name: 'sensitive_url',
        pattern: /\b(https?:\/\/)[^\s]*?(token|key|secret|password|credential)=[^\s]*\b/gi,
        replacement: 'SENSITIVE_URL:***',
        description: 'URL with sensitive parameters'
      },
      // IP 地址（可选，根据隐私需求）
      {
        name: 'ip_address',
        pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
        replacement: 'IP:***',
        description: 'IP address'
      },
      // Email 地址
      {
        name: 'email',
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        replacement: 'EMAIL:***',
        description: 'Email address'
      },
      // Phone numbers（简单模式）
      {
        name: 'phone',
        pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
        replacement: 'PHONE:***',
        description: 'Phone number'
      },
      // AWS Keys
      {
        name: 'aws_access_key',
        pattern: /\b(AWSA|ASIA)[A-Z0-9]{16,}\b/g,
        replacement: 'AWS_KEY:***',
        description: 'AWS access key'
      },
      // GitHub Tokens
      {
        name: 'github_token',
        pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/gi,
        replacement: 'GITHUB_TOKEN:***',
        description: 'GitHub token'
      },
      // Database connection strings
      {
        name: 'database_url',
        pattern: /\b(postgresql|mysql|mongodb|mssql|redis):\/\/[^\s]*\b/gi,
        replacement: 'DATABASE_URL:***',
        description: 'Database connection string'
      },
      // File paths with potential sensitive data
      {
        name: 'sensitive_file',
        pattern: /\b\/(root\/)?(\.ssh|\.aws|\.config|\.gnupg|\.kube)\/[^\s]*\b/gi,
        replacement: 'SENSITIVE_PATH:***',
        description: 'Sensitive file path'
      }
    ];
  }

  /**
   * 添加自定义脱敏规则
   */
  addRule(rule: SanitizationRule): void {
    this.rules.push(rule);
  }

  /**
   * 移除脱敏规则
   */
  removeRule(name: string): void {
    this.rules = this.rules.filter(r => r.name !== name);
  }

  /**
   * 脱敏字符串
   */
  sanitize(input: string): string {
    let result = input;

    for (const rule of this.rules) {
      result = result.replace(rule.pattern, rule.replacement);
    }

    return result;
  }

  /**
   * 脱敏对象（转换为字符串后处理）
   */
  sanitizeObject(obj: unknown): string {
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return this.sanitize(str);
  }

  /**
   * 脱敏错误对象
   */
  sanitizeError(error: Error): string {
    let message = error.message;
    let stack = error.stack;

    // 脱敏错误消息
    message = this.sanitize(message);

    // 脱敏堆栈跟踪（如果存在）
    if (stack) {
      stack = this.sanitize(stack);
    }

    // 重建错误信息
    let result = `${error.name}: ${message}`;
    if (stack) {
      result += `\n${stack}`;
    }

    return result;
  }

  /**
   * 创建一个包装对象，其 toString() 方法会自动脱敏
   */
  createProtected<T>(value: T): T & { toString: () => string } {
    const self = this;
    return Object.assign({}, value, {
      toString() {
        return self.sanitizeObject(value);
      }
    }) as T & { toString: () => string };
  }

  /**
   * 获取所有脱敏规则
   */
  getRules(): SanitizationRule[] {
    return [...this.rules];
  }

  /**
   * 检查字符串是否包含敏感信息
   */
  containsSensitiveData(input: string): boolean {
    for (const rule of this.rules) {
      if (rule.pattern.test(input)) {
        return true;
      }
    }
    return false;
  }
}

// 默认实例
const defaultSanitizer = new SensitiveDataSanitizer();

/**
 * 脱敏字符串（便捷函数）
 */
export function sanitize(input: string): string {
  return defaultSanitizer.sanitize(input);
}

/**
 * 脱敏错误对象（便捷函数）
 */
export function sanitizeError(error: Error): string {
  return defaultSanitizer.sanitizeError(error);
}

/**
 * 检查是否包含敏感信息（便捷函数）
 */
export function containsSensitiveData(input: string): boolean {
  return defaultSanitizer.containsSensitiveData(input);
}

export default SensitiveDataSanitizer;
