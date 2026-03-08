/**
 * Telegram消息格式化器
 * 用于将普通文本转换为Telegram Markdown格式
 * 支持代码块、加粗、斜体等格式
 * 并处理特殊字符转义
 */

import { logger } from '../../utils/logger';

/**
 * Markdown格式选项
 */
export interface MarkdownFormatOptions {
  /** 是否转义特殊字符 */
  escape?: boolean;
  /** 是否支持HTML */
  html?: boolean;
  /** 代码块语言 */
  language?: string;
}

/**
 * 消息格式化器类
 */
export class MessageFormatter {
  // Telegram MarkdownV2需要转义的特殊字符
  private static readonly MARKDOWN_SPECIAL_CHARS = [
    '_',
    '*',
    '[',
    ']',
    '(',
    ')',
    '~',
    '`',
    '>',
    '#',
    '+',
    '-',
    '=',
    '|',
    '{',
    '}',
    '.',
    '!',
  ];

  // 需要在代码块中转义的字符
  private static readonly CODE_BLOCK_SPECIAL_CHARS = ['`', '\\'];

  /**
   * 格式化为Markdown
   */
  formatMarkdown(text: string, options: MarkdownFormatOptions = {}): string {
    const { escape = true } = options;

    try {
      // 处理代码块
      let formatted = this.processCodeBlocks(text);

      // 处理行内代码
      formatted = this.processInlineCode(formatted);

      // 处理其他格式
      if (escape) {
        formatted = this.escapeMarkdown(formatted);
      }

      return formatted;
    } catch (error) {
      logger.error('Error formatting markdown:', error);
      return text; // 返回原始文本
    }
  }

  /**
   * 转义Markdown特殊字符
   */
  escapeMarkdown(text: string): string {
    // 先保护代码块
    const codeBlocks: string[] = [];
    let protectedText = text.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    // 保护行内代码
    const inlineCodes: string[] = [];
    protectedText = protectedText.replace(/`[^`]+`/g, (match) => {
      inlineCodes.push(match);
      return `__INLINE_CODE_${inlineCodes.length - 1}__`;
    });

    // 转义特殊字符
    for (const char of MessageFormatter.MARKDOWN_SPECIAL_CHARS) {
      const regex = new RegExp(`\\${char}`, 'g');
      protectedText = protectedText.replace(regex, `\\${char}`);
    }

    // 恢复行内代码
    protectedText = protectedText.replace(/__INLINE_CODE_(\d+)__/g, (_, index) => {
      return inlineCodes[parseInt(index)];
    });

    // 恢复代码块
    protectedText = protectedText.replace(/__CODE_BLOCK_(\d+)__/g, (_, index) => {
      return codeBlocks[parseInt(index)];
    });

    return protectedText;
  }

  /**
   * 处理代码块
   */
  private processCodeBlocks(text: string): string {
    return text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      // 移除代码块内的反斜杠转义
      const cleanedCode = code.replace(/\\`/g, '`');
      return `\`\`\`${lang}\n${cleanedCode}\`\`\``;
    });
  }

  /**
   * 处理行内代码
   */
  private processInlineCode(text: string): string {
    return text.replace(/`([^`]+)`/g, (match, code) => {
      // 移除行内代码内的反斜杠转义
      const cleanedCode = code.replace(/\\`/g, '`');
      return `\`${cleanedCode}\``;
    });
  }

  /**
   * 格式化加粗文本
   */
  bold(text: string): string {
    return `*${text}*`;
  }

  /**
   * 格式化斜体文本
   */
  italic(text: string): string {
    return `_${text}_`;
  }

  /**
   * 格式化下划线文本(使用MarkdownV2)
   */
  underline(text: string): string {
    return `__${text}__`;
  }

  /**
   * 格式化删除线文本
   */
  strikethrough(text: string): string {
    return `~${text}~`;
  }

  /**
   * 格式化代码块
   */
  codeBlock(code: string, language: string = ''): string {
    return `\`\`\`${language}\n${code}\n\`\`\``;
  }

  /**
   * 格式化行内代码
   */
  inlineCode(code: string): string {
    return `\`${code}\``;
  }

  /**
   * 创建链接
   */
  link(text: string, url: string): string {
    return `[${text}](${url})`;
  }

  /**
   * 创建提及
   */
  mention(username: string): string {
    return `@${username}`;
  }

  /**
   * 创建命令链接
   */
  commandLink(text: string, botUsername: string, command: string): string {
    return this.link(text, `https://t.me/${botUsername}?start=${command}`);
  }

  /**
   * 格式化列表
   */
  bulletList(items: string[]): string {
    return items.map((item) => `• ${this.escapeMarkdown(item)}`).join('\n');
  }

  /**
   * 格式化编号列表
   */
  numberedList(items: string[]): string {
    return items
      .map((item, index) => `${index + 1}. ${this.escapeMarkdown(item)}`)
      .join('\n');
  }

  /**
   * 格式化引用块
   */
  quote(text: string): string {
    const lines = text.split('\n');
    return lines.map((line) => `> ${this.escapeMarkdown(line)}`).join('\n');
  }

  /**
   * 格式化水平线
   */
  horizontalRule(): string {
    return '---';
  }

  /**
   * 格式化标题
   */
  heading(text: string, level: number = 1): string {
    const hashes = '#'.repeat(Math.min(Math.max(level, 1), 6));
    return `${hashes} ${this.escapeMarkdown(text)}`;
  }

  /**
   * 格式化换行
   */
  lineBreak(): string {
    return '\n';
  }

  /**
   * 格式化多行文本
   */
  multiline(...lines: string[]): string {
    return lines.join('\n');
  }

  /**
   * 清理Markdown格式
   */
  stripMarkdown(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, '') // 移除代码块
      .replace(/`[^`]+`/g, '') // 移除行内代码
      .replace(/\*[^*]+\*/g, '') // 移除加粗
      .replace(/_[^_]+_/g, '') // 移除斜体
      .replace(/~[^~]+~/g, '') // 移除删除线
      .replace(/\[[^\]]+\]\([^)]+\)/g, '') // 移除链接
      .replace(/^>.*$/gm, '') // 移除引用
      .replace(/^#{1,6}\s.*$/gm, '') // 移除标题
      .trim();
  }

  /**
   * 截断文本到指定长度
   */
  truncate(text: string, maxLength: number = 4096, suffix: string = '...'): string {
    if (text.length <= maxLength) {
      return text;
    }

    // Telegram消息限制为4096字符
    return text.substring(0, maxLength - suffix.length) + suffix;
  }

  /**
   * 分割长消息为多个消息
   */
  splitMessage(text: string, maxLength: number = 4096): string[] {
    const messages: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        messages.push(remaining);
        break;
      }

      // 尝试在换行符处分割
      let splitIndex = remaining.lastIndexOf('\n', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength * 0.8) {
        // 如果没有合适的换行符，在空格处分割
        splitIndex = remaining.lastIndexOf(' ', maxLength);
      }

      if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
        // 如果还是没有合适的位置，强制在maxLength处分割
        splitIndex = maxLength;
      }

      messages.push(remaining.substring(0, splitIndex).trim());
      remaining = remaining.substring(splitIndex).trim();
    }

    return messages;
  }

  /**
   * 格式化错误消息
   */
  formatError(error: Error | string): string {
    const message = typeof error === 'string' ? error : error.message;
    return this.multiline(
      this.bold('❌ Error'),
      '',
      this.codeBlock(message)
    );
  }

  /**
   * 格式化成功消息
   */
  formatSuccess(message: string): string {
    return this.multiline(
      this.bold('✅ Success'),
      '',
      message
    );
  }

  /**
   * 格式化警告消息
   */
  formatWarning(message: string): string {
    return this.multiline(
      this.bold('⚠️ Warning'),
      '',
      message
    );
  }

  /**
   * 格式化信息消息
   */
  formatInfo(title: string, content: string): string {
    return this.multiline(
      this.bold(`ℹ️ ${title}`),
      '',
      content
    );
  }

  /**
   * 格式化代码执行结果
   */
  formatCodeResult(code: string, result: string, error?: string): string {
    const parts = [
      this.bold('📝 Code:'),
      '',
      this.codeBlock(code, 'javascript'),
    ];

    if (error) {
      parts.push(
        '',
        this.bold('❌ Error:'),
        '',
        this.codeBlock(error, 'text')
      );
    } else if (result) {
      parts.push(
        '',
        this.bold('✅ Output:'),
        '',
        this.codeBlock(result, 'text')
      );
    }

    return this.multiline(...parts);
  }

  /**
   * 验证Markdown格式是否有效
   */
  validateMarkdown(text: string): { valid: boolean; error?: string } {
    try {
      // 检查代码块是否闭合
      const codeBlockCount = (text.match(/```/g) || []).length;
      if (codeBlockCount % 2 !== 0) {
        return { valid: false, error: 'Unclosed code block' };
      }

      // 检查行内代码是否闭合
      const inlineCodeCount = (text.match(/`[^`]/g) || []).length;
      if (inlineCodeCount % 2 !== 0) {
        return { valid: false, error: 'Unclosed inline code' };
      }

      // 检查链接格式
      const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
      let match;
      while ((match = linkRegex.exec(text)) !== null) {
        if (!match[1] || !match[2]) {
          return { valid: false, error: 'Invalid link format' };
        }
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export default MessageFormatter;
