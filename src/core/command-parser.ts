/**
 * 命令解析器 - 解析斜杠命令
 */

import { ParsedCommand, CommandType } from '../interfaces/types';
import { Logger } from '../utils/logger';

export class CommandParser {
  private logger: Logger;
  private commands: Set<CommandType>;

  constructor() {
    this.logger = new Logger('CommandParser');
    this.commands = new Set([
      'help',
      'new',
      'clear',
      'status',
      'cd',
      'model',
      'resume'
    ]);
  }

  /**
   * 解析命令
   * @param input 用户输入的文本
   * @returns 解析后的命令或null(如果不是命令)
   */
  parse(input: string): ParsedCommand | null {
    const trimmed = input.trim();

    // 检查是否是斜杠命令
    if (!trimmed.startsWith('/')) {
      return null;
    }

    // 提取命令部分
    const parts = trimmed.slice(1).split(/\s+/);
    const commandName = parts[0].toLowerCase() as CommandType;
    const args = parts.slice(1);

    // 验证是否是有效命令
    if (!this.commands.has(commandName)) {
      this.logger.warn(`Unknown command: ${commandName}`);
      return null;
    }

    const parsed: ParsedCommand = {
      type: commandName,
      raw: trimmed,
    };

    if (args.length > 0) {
      parsed.args = args;
    }

    this.logger.debug(`Parsed command: ${JSON.stringify(parsed)}`);
    return parsed;
  }

  /**
   * 检查是否是命令
   * @param input 用户输入的文本
   */
  isCommand(input: string): boolean {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return false;
    }

    const commandName = trimmed.slice(1).split(/\s+/)[0].toLowerCase();
    return this.commands.has(commandName as CommandType);
  }

  /**
   * 获取支持的命令列表
   */
  getSupportedCommands(): CommandType[] {
    return Array.from(this.commands);
  }

  /**
   * 添加自定义命令
   * @param command 命令名称
   */
  addCommand(command: CommandType): void {
    this.commands.add(command);
    this.logger.debug(`Added command: ${command}`);
  }

  /**
   * 移除命令
   * @param command 命令名称
   */
  removeCommand(command: CommandType): void {
    this.commands.delete(command);
    this.logger.debug(`Removed command: ${command}`);
  }

  /**
   * 获取命令帮助信息
   * @param command 命令名称(可选)
   */
  getHelp(command?: CommandType): string {
    const helpTexts: Record<CommandType, string> = {
      help: '/help - 显示帮助信息',
      new: '/new - 创建新会话',
      clear: '/clear - 清空当前会话消息',
      status: '/status - 显示当前会话状态',
      cd: '/cd <path> - 切换工作目录',
      model: '/model <name> - 切换AI模型',
      resume: '/resume [id] - 恢复历史会话'
    };

    if (command) {
      return helpTexts[command] || '未知命令';
    }

    return '支持的命令:\n' + Object.values(helpTexts).join('\n');
  }
}
