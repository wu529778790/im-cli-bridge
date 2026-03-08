/**
 * 消息类型定义
 */

/**
 * 命令类型枚举
 */
export enum CommandType {
  /** 普通命令 */
  COMMAND = 'command',
  /** Claude代码命令 */
  CLAUDE_CODE = 'claude_code',
  /** 系统命令 */
  SYSTEM = 'system',
  /** 帮助命令 */
  HELP = 'help',
  /** 未知命令 */
  UNKNOWN = 'unknown',
}

/**
 * 解析后的命令接口
 */
export interface ParsedCommand {
  /** 命令名称 */
  name: string;
  /** 命令参数 */
  args: string[];
  /** 原始命令文本 */
  raw: string;
  /** 命令类型 */
  type: CommandType;
  /** 命令前缀 */
  prefix?: string;
  /** 命令标志 */
  flags?: Record<string, boolean | string>;
  /** 命令选项 */
  options?: Record<string, string>;
}

/**
 * 消息解析结果接口
 */
export interface MessageParseResult {
  /** 解析是否成功 */
  success: boolean;
  /** 解析后的命令 */
  command?: ParsedCommand;
  /** 错误信息 */
  error?: string;
  /** 是否为命令消息 */
  isCommand: boolean;
  /** 原始消息 */
  originalMessage: string;
}

/**
 * 消息处理器接口
 */
export interface MessageHandler {
  /**
   * 处理消息
   * @param message 消息内容
   * @returns 处理结果
   */
  handle(message: string): Promise<MessageParseResult>;

  /**
   * 验证消息格式
   * @param message 消息内容
   * @returns 是否有效
   */
  validate(message: string): boolean;
}
