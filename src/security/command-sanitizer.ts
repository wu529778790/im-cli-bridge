/**
 * 命令清理器
 * 检测和阻止潜在的恶意命令注入
 */

import { logger } from '../utils/logger';

export interface SanitizationResult {
  safe: boolean;
  command: string;
  args: string[];
  warning?: string;
  error?: string;
}

export interface SecurityRule {
  name: string;
  pattern: RegExp;
  description: string;
  severity: 'error' | 'warning';
}

/**
 * 命令清理器
 */
export class CommandSanitizer {
  private rules: SecurityRule[] = [];

  constructor() {
    this.initializeDefaultRules();
  }

  /**
   * 初始化默认安全规则
   */
  private initializeDefaultRules(): void {
    // 危险命令规则
    this.rules = [
      {
        name: 'rm_root',
        pattern: /\brm\s+(-rf?|-fr)\s+\/\b/,
        description: 'Attempting to remove root directory',
        severity: 'error'
      },
      {
        name: 'dd_overwrite',
        pattern: /\bdd\s+(if=\/dev\/zero|if=\/dev\/urandom)/,
        description: 'Attempting to overwrite disk with zeros',
        severity: 'error'
      },
      {
        name: 'mkfs',
        pattern: /\bmkfs\.(ext[234]|xfs|btrfs|vfat|ntfs)/,
        description: 'Attempting to create filesystem',
        severity: 'error'
      },
      {
        name: 'chmod_critical',
        pattern: /\bchmod\s+(000|777)\s+/,
        description: 'Attempting to remove all permissions or set world-writable',
        severity: 'warning'
      },
      {
        name: 'device_write',
        pattern: /\>\s*\/dev\/(sd[a-z]|tty|mem|kmem|port)/,
        description: 'Attempting to write directly to device',
        severity: 'error'
      },
      {
        name: 'shell_code_injection',
        pattern: /;\s*(rm|dd|mkfs|chmod|kill)\s+|\|\s*\bcurl\s+.*\|\s*(bash|sh|zsh)\b/,
        description: 'Potential shell code injection',
        severity: 'error'
      },
      {
        name: 'curl_pipe_shell',
        pattern: /\bcurl\s+.*\|\s*(bash|sh|zsh)\b/,
        description: 'Downloading and executing script via pipe',
        severity: 'warning'
      },
      {
        name: 'eval_command',
        pattern: /\beval\s*\(/,
        description: 'Using eval with arbitrary input',
        severity: 'warning'
      },
      {
        name: 'history_wipe',
        pattern: /\b(history\s+-c|echo\s+''>\s*~\/\.bash_history)/,
        description: 'Attempting to wipe command history',
        severity: 'warning'
      },
      {
        name: 'ssh_key_exfiltration',
        pattern: /\b(curl|nc|wget)\+.*\~\/\.ssh/,
        description: 'Attempting to exfiltrate SSH keys',
        severity: 'error'
      },
      {
        name: 'systemd_critical',
        pattern: /\bsystemctl\s+(stop|disable|mask)\s+(ssh|network|firewall)/,
        description: 'Attempting to disable critical system services',
        severity: 'error'
      },
      {
        name: ' iptables_flush',
        pattern: /\biptables\s+-F/,
        description: 'Attempting to flush firewall rules',
        severity: 'warning'
      },
      {
        name: 'sudo_root_shell',
        pattern: /\bsudo\s+(su|bash|sh)\s*$/,
        description: 'Attempting to get root shell',
        severity: 'warning'
      }
    ];
  }

  /**
   * 添加自定义安全规则
   */
  addRule(rule: SecurityRule): void {
    this.rules.push(rule);
    logger.debug(`Added security rule: ${rule.name}`);
  }

  /**
   * 移除安全规则
   */
  removeRule(name: string): void {
    this.rules = this.rules.filter(r => r.name !== name);
    logger.debug(`Removed security rule: ${name}`);
  }

  /**
   * 清理命令
   */
  sanitize(command: string, args: string[]): SanitizationResult {
    const fullCommand = `${command} ${args.join(' ')}`;
    const result: SanitizationResult = {
      safe: true,
      command,
      args: args.map(a => this.sanitizeArg(a))
    };

    // 检查所有安全规则
    for (const rule of this.rules) {
      if (rule.pattern.test(fullCommand)) {
        if (rule.severity === 'error') {
          result.safe = false;
          result.error = `Security rule '${rule.name}' violated: ${rule.description}`;
          logger.warn(`Command blocked: ${result.error}`);
          return result;
        } else {
          result.warning = `Security rule '${rule.name}' warning: ${rule.description}`;
          logger.warn(`Command warning: ${result.warning}`);
        }
      }
    }

    // 检查命令名称白名单
    const allowedCommands = [
      'claudecode', 'claude', 'cursor', 'codex', 'aider', 'gpt-cli',
      'git', 'npm', 'yarn', 'pnpm', 'bun', 'node',
      'ls', 'cd', 'pwd', 'cat', 'head', 'tail', 'grep', 'find',
      'echo', 'printf', 'date', 'uptime'
    ];

    const commandBase = command.split(' ')[0];
    const isBuiltIn = !commandBase.includes('/') && commandBase !== command;

    // 如果不是内置命令且不在白名单中，发出警告
    if (!isBuiltIn && !allowedCommands.includes(commandBase)) {
      result.warning = `Command '${commandBase}' is not in the allowed list`;
      logger.debug(`Sanitization warning: ${result.warning}`);
    }

    return result;
  }

  /**
   * 清理单个参数
   */
  private sanitizeArg(arg: string): string {
    // 移除可能危险的引号转义序列
    return arg
      .replace(/\\`/g, '')  // 移除反引号转义
      .replace(/\\\$/g, ''); // 移除美元符转义
  }

  /**
   * 验证命令字符串
   */
  validate(commandString: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 检查所有安全规则
    for (const rule of this.rules) {
      if (rule.pattern.test(commandString)) {
        if (rule.severity === 'error') {
          errors.push(rule.description);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 获取所有安全规则
   */
  getRules(): SecurityRule[] {
    return [...this.rules];
  }

  /**
   * 检查命令是否包含敏感操作
   */
  isSensitiveOperation(command: string, args: string[]): boolean {
    const sensitivePatterns = [
      /rm\s+/,
      /dd\s+/,
      /mkfs/,
      /chmod/,
      /chown/,
      /passwd/,
      /shadow/,
      /\.ssh/,
      /\/etc\//,
      /systemctl/
    ];

    const fullCommand = `${command} ${args.join(' ')}`;
    return sensitivePatterns.some(pattern => pattern.test(fullCommand));
  }
}

export default CommandSanitizer;
