import * as path from 'path';
import * as fs from 'fs';

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether the command is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Warning messages */
  warnings?: string[];
}

/**
 * Validation options
 */
export interface ValidationOptions {
  /** Whitelist of allowed commands (e.g., ['claude', 'git', 'npm']) */
  allowedCommands?: string[];
  /** Blacklist of dangerous commands (e.g., ['rm -rf', 'format', 'del']) */
  blockedCommands?: string[];
  /** Whitelist of allowed directories */
  allowedDirectories?: string[];
  /** Whether to allow path traversal (../) */
  allowPathTraversal?: boolean;
  /** Whether to allow destructive commands */
  allowDestructive?: boolean;
  /** Maximum command length */
  maxCommandLength?: number;
}

/**
 * Command validator for security and safety
 * Provides whitelist, blacklist, and path validation
 */
export class CommandValidator {
  private readonly options: Required<ValidationOptions>;

  private readonly DANGEROUS_PATTERNS = [
    /rm\s+-rf?\s+[\/\*]/,
    /rm\s+-rf?\s+\.\./,
    /format\s+[a-z]:/i,
    /del\s+\/[sSq]/,
    /shutdown\s+\/[sS]/,
    /reboot\s+\/[rR]/,
    /mkfs\./,
    /dd\s+if=/,
    />\s*\/[a-z]/,
    /curl.*\|\s*sh/,
    /wget.*\|\s*bash/,
    /chmod\s+000/,
    /chown\s+-R\s+root/
  ];

  private readonly DESTRUCTIVE_COMMANDS = [
    'rm',
    'rmdir',
    'del',
    'delete',
    'format',
    'mkfs',
    'dd',
    'shutdown',
    'reboot',
    'poweroff'
  ];

  constructor(options: ValidationOptions = {}) {
    this.options = {
      allowedCommands: options.allowedCommands || [],
      blockedCommands: options.blockedCommands || [],
      allowedDirectories: options.allowedDirectories || [],
      allowPathTraversal: options.allowPathTraversal ?? false,
      allowDestructive: options.allowDestructive ?? false,
      maxCommandLength: options.maxCommandLength ?? 10000
    };
  }

  /**
   * Validate a command and its arguments
   */
  validate(command: string, args: string[]): ValidationResult {
    const warnings: string[] = [];

    // Check command length
    if (command.length > this.options.maxCommandLength) {
      return {
        valid: false,
        error: `Command exceeds maximum length of ${this.options.maxCommandLength}`
      };
    }

    // Check total args length
    const totalLength = command.length + args.join(' ').length;
    if (totalLength > this.options.maxCommandLength) {
      return {
        valid: false,
        error: `Command and args exceed maximum length of ${this.options.maxCommandLength}`
      };
    }

    // Check whitelist
    if (this.options.allowedCommands.length > 0) {
      if (!this.isCommandAllowed(command)) {
        return {
          valid: false,
          error: `Command '${command}' is not in the allowed list`
        };
      }
    }

    // Check blacklist
    if (this.isCommandBlocked(command, args)) {
      return {
        valid: false,
        error: `Command '${command}' is blocked`
      };
    }

    // Check dangerous patterns
    const fullCommand = `${command} ${args.join(' ')}`;
    const dangerousMatch = this.checkDangerousPatterns(fullCommand);
    if (dangerousMatch) {
      return {
        valid: false,
        error: `Command matches dangerous pattern: ${dangerousMatch}`
      };
    }

    // Check destructive commands
    if (!this.options.allowDestructive && this.isDestructiveCommand(command)) {
      return {
        valid: false,
        error: `Destructive command '${command}' is not allowed`
      };
    }

    // Check path traversal in args
    if (!this.options.allowPathTraversal) {
      const pathTraversalCheck = this.checkPathTraversal(args);
      if (pathTraversalCheck) {
        return {
          valid: false,
          error: `Path traversal detected: ${pathTraversalCheck}`
        };
      }
    }

    // Check directory permissions
    const dirCheck = this.checkDirectories(args);
    if (!dirCheck.valid) {
      return dirCheck;
    }

    // Add warnings for potentially risky operations
    const riskyWarnings = this.checkRiskyOperations(command, args);
    warnings.push(...riskyWarnings);

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Check if command is in whitelist
   */
  private isCommandAllowed(command: string): boolean {
    const baseCommand = path.basename(command);
    return this.options.allowedCommands.some(allowed => {
      return allowed === baseCommand || allowed === command;
    });
  }

  /**
   * Check if command is in blacklist
   */
  private isCommandBlocked(command: string, args: string[]): boolean {
    const baseCommand = path.basename(command);
    const fullCommand = `${command} ${args.join(' ')}`;

    return this.options.blockedCommands.some(blocked => {
      // Check exact command match
      if (blocked === baseCommand || blocked === command) {
        return true;
      }

      // Check if command starts with blocked pattern
      if (fullCommand.startsWith(blocked)) {
        return true;
      }

      return false;
    });
  }

  /**
   * Check for dangerous command patterns
   */
  private checkDangerousPatterns(fullCommand: string): string | null {
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(fullCommand)) {
        return pattern.toString();
      }
    }
    return null;
  }

  /**
   * Check if command is destructive
   */
  private isDestructiveCommand(command: string): boolean {
    const baseCommand = path.basename(command).toLowerCase();
    return this.DESTRUCTIVE_COMMANDS.some(destructive =>
      baseCommand === destructive || baseCommand.startsWith(destructive + '.')
    );
  }

  /**
   * Check for path traversal attempts
   */
  private checkPathTraversal(args: string[]): string | null {
    for (const arg of args) {
      // Check for ../ patterns
      if (arg.includes('..')) {
        return arg;
      }

      // Check for encoded path traversal
      if (arg.includes('%2e%2e') || arg.includes('%252e')) {
        return arg;
      }
    }
    return null;
  }

  /**
   * Check if arguments reference allowed directories
   */
  private checkDirectories(args: string[]): ValidationResult {
    if (this.options.allowedDirectories.length === 0) {
      return { valid: true };
    }

    for (const arg of args) {
      // Skip flags and options
      if (arg.startsWith('-')) {
        continue;
      }

      // Check if arg looks like a path
      if (arg.includes('/') || arg.includes('\\')) {
        const resolvedPath = path.resolve(arg);
        const normalizedPath = path.normalize(resolvedPath);

        const isAllowed = this.options.allowedDirectories.some(allowedDir => {
          const resolvedAllowed = path.resolve(allowedDir);
          return normalizedPath.startsWith(resolvedAllowed);
        });

        if (!isAllowed) {
          return {
            valid: false,
            error: `Path '${arg}' is outside allowed directories`
          };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Check for potentially risky operations
   */
  private checkRiskyOperations(command: string, args: string[]): string[] {
    const warnings: string[] = [];
    const baseCommand = path.basename(command).toLowerCase();

    // Check for sudo/admin privileges
    if (baseCommand === 'sudo' || args.some(arg => arg === '--admin' || arg === '/admin')) {
      warnings.push('Command requires elevated privileges');
    }

    // Check for network operations
    if (['curl', 'wget', 'nc', 'netcat', 'telnet'].includes(baseCommand)) {
      warnings.push('Command will make network requests');
    }

    // Check for file modifications
    if (['mv', 'cp', 'rename', 'move'].includes(baseCommand)) {
      warnings.push('Command will modify files');
    }

    // Check for package installations
    if (['npm', 'yarn', 'pip', 'gem', 'cargo'].includes(baseCommand)) {
      if (args.includes('install') || args.includes('add')) {
        warnings.push('Command will install packages');
      }
    }

    return warnings;
  }

  /**
   * Sanitize command arguments by removing or escaping dangerous characters
   */
  sanitizeArgs(args: string[]): string[] {
    return args.map(arg => {
      // Remove null bytes and other dangerous characters
      return arg
        .replace(/\0/g, '')
        .replace(/[\x00-\x1F\x7F]/g, '');
    });
  }

  /**
   * Validate and sanitize a command
   */
  validateAndSanitize(command: string, args: string[]): {
    valid: boolean;
    error?: string;
    warnings?: string[];
    sanitizedCommand: string;
    sanitizedArgs: string[];
  } {
    // First validate
    const validation = this.validate(command, args);

    if (!validation.valid) {
      return {
        ...validation,
        sanitizedCommand: command,
        sanitizedArgs: args
      };
    }

    // Sanitize arguments
    const sanitizedArgs = this.sanitizeArgs(args);

    return {
      valid: true,
      warnings: validation.warnings,
      sanitizedCommand: command,
      sanitizedArgs
    };
  }
}

/**
 * Create a default validator with common safety rules
 */
export function createDefaultValidator(): CommandValidator {
  return new CommandValidator({
    allowPathTraversal: false,
    allowDestructive: false,
    maxCommandLength: 10000
  });
}

/**
 * Create a permissive validator for development environments
 */
export function createDevValidator(): CommandValidator {
  return new CommandValidator({
    allowPathTraversal: true,
    allowDestructive: true,
    maxCommandLength: 50000
  });
}
