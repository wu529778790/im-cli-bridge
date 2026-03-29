import { resolvePlatformAiCommand, type Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import type { RequestQueue } from '../queue/request-queue.js';
import { escapePathForMarkdown } from '../shared/utils.js';
import { TERMINAL_ONLY_COMMANDS } from '../constants.js';
import { execFile } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ThreadContext } from '../shared/types.js';

export type { ThreadContext };

export interface MessageSender {
  sendTextReply(chatId: string, text: string, threadCtx?: ThreadContext): Promise<void>;
  sendDirectorySelection?(chatId: string, currentDir: string, userId: string): Promise<void>;
}

export interface CommandHandlerDeps {
  config: Config;
  sessionManager: SessionManager;
  requestQueue: RequestQueue;
  sender: MessageSender;
  getRunningTasksSize: () => number;
}

export type ClaudeRequestHandler = (
  userId: string,
  chatId: string,
  prompt: string,
  workDir: string,
  convId?: string,
  threadCtx?: ThreadContext,
  replyToMessageId?: string
) => Promise<void>;

export class CommandHandler {
  constructor(private deps: CommandHandlerDeps) {}

  async dispatch(
    text: string,
    chatId: string,
    userId: string,
    platform: 'dingtalk' | 'feishu' | 'qq' | 'telegram' | 'wechat' | 'wework' | 'workbuddy',
    handleClaudeRequest: ClaudeRequestHandler
  ): Promise<boolean> {
    const t = text.trim();

    if (platform === 'telegram' && t === '/start') {
      await this.deps.sender.sendTextReply(chatId, '欢迎使用 open-im AI CLI 桥接！\n\n发送消息与 AI 交互，输入 /help 查看帮助。');
      return true;
    }

    if (t === '/help') return this.handleHelp(chatId);
    if (t === '/new') return this.handleNew(chatId, userId);
    if (t === '/pwd') return this.handlePwd(chatId, userId);
    if (t === '/status') return this.handleStatus(chatId, userId, platform);

    if (t === '/cd' || t.startsWith('/cd ')) {
      return this.handleCd(chatId, userId, t.slice(3).trim(), platform);
    }

    const cmd = t.split(/\s+/)[0];
    if (TERMINAL_ONLY_COMMANDS.has(cmd)) {
      await this.deps.sender.sendTextReply(chatId, `${cmd} 命令仅在终端可用。`);
      return true;
    }

    return false;
  }

  private async handleHelp(chatId: string): Promise<boolean> {
    const help = [
      '📋 可用命令:',
      '',
      '/help - 显示帮助',
      '/new - 开始新会话（AI 上下文重置）',
      '/status - 显示状态',
      '/cd <路径> - 切换工作目录',
      '/pwd - 当前工作目录',
    ].join('\n');
    await this.deps.sender.sendTextReply(chatId, help);
    return true;
  }

  private async handleNew(chatId: string, userId: string): Promise<boolean> {
    const ok = this.deps.sessionManager.newSession(userId);
    await this.deps.sender.sendTextReply(
      chatId,
      ok
        ? '✅ AI 会话已重置，下一条消息将使用全新上下文。'
        : '当前没有活动会话。'
    );
    return true;
  }

  private async handlePwd(chatId: string, userId: string): Promise<boolean> {
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    await this.deps.sender.sendTextReply(chatId, `当前工作目录: ${escapePathForMarkdown(workDir)}`);
    return true;
  }

  private async handleStatus(chatId: string, userId: string, platform: 'dingtalk' | 'feishu' | 'qq' | 'telegram' | 'wechat' | 'wework' | 'workbuddy'): Promise<boolean> {
    const aiCommand = resolvePlatformAiCommand(this.deps.config, platform);
    const version = await this.getAiVersion(aiCommand);
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    const convId = this.deps.sessionManager.getConvId(userId);
    const sessionId = this.deps.sessionManager.getSessionIdForConv(userId, convId, aiCommand);
    const lines = [
      '📊 状态:',
      '',
      `AI 工具: ${aiCommand}`,
      `版本: ${version}`,
      `工作目录: ${escapePathForMarkdown(workDir)}`,
      `会话: ${sessionId ?? '无'}`,
    ];
    await this.deps.sender.sendTextReply(chatId, lines.join('\n'));
    return true;
  }

  private async handleCd(chatId: string, userId: string, dir: string, platform: 'dingtalk' | 'feishu' | 'qq' | 'telegram' | 'wechat' | 'wework' | 'workbuddy'): Promise<boolean> {
    // 如果 dir 为空，显示目录选择界面
    if (!dir) {
      const currentDir = this.deps.sessionManager.getWorkDir(userId);
      if (this.deps.sender.sendDirectorySelection) {
        await this.deps.sender.sendDirectorySelection(chatId, currentDir, userId);
      } else {
        await this.deps.sender.sendTextReply(
          chatId,
          `当前目录: ${escapePathForMarkdown(currentDir)}\n使用 /cd <路径> 切换`
        );
      }
      return true;
    }
    try {
      const resolved = await this.deps.sessionManager.setWorkDir(userId, dir);
      await this.deps.sender.sendTextReply(
        chatId,
        `📁 工作目录已切换到: ${escapePathForMarkdown(resolved)}\n\n` +
        `🔄 AI 会话已重置，下一条消息将使用全新上下文。`
      );
    } catch (err) {
      await this.deps.sender.sendTextReply(chatId, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  private getAiVersion(aiCommand: 'claude' | 'codex' | 'codebuddy'): Promise<string> {
    if (aiCommand === 'claude') {
      // Claude 使用 SDK，返回 SDK 版本
      return Promise.resolve('SDK Mode');
    }
    const cmd = aiCommand === 'codex'
      ? this.deps.config.codexCliPath
      : this.deps.config.codebuddyCliPath;
    return new Promise((resolve) => {
      execFile(cmd, ['--version'], { timeout: 5000 }, (err, stdout) => {
        resolve(err ? '未知' : (stdout?.toString().trim() || '未知'));
      });
    });
  }
}

/**
 * 列出目录并返回目录信息
 */
export function listDirectories(basePath: string): { name: string; fullPath: string; isParent: boolean }[] {
  const dirs: { name: string; fullPath: string; isParent: boolean }[] = [];

  try {
    // 添加返回上级目录选项（如果不是根目录）
    const parent = dirname(basePath);
    if (parent !== basePath) {
      dirs.push({ name: '🔙 返回上级', fullPath: parent, isParent: true });
    }

    // 读取子目录
    const entries = readdirSync(basePath, { withFileTypes: true });
    const subDirs = entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith('.')) // 过滤隐藏目录
      .map((entry) => ({
        name: entry.name,
        fullPath: join(basePath, entry.name),
        isParent: false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)); // 按名称排序

    dirs.push(...subDirs);
  } catch {
    // 忽略错误
  }

  return dirs;
}

/**
 * 生成目录选择的按钮布局
 */
export function buildDirectoryKeyboard(
  directories: { name: string; fullPath: string; isParent: boolean }[],
  userId: string
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

  // 每行 2 个按钮
  for (let i = 0; i < directories.length; i += 2) {
    const row: Array<{ text: string; callback_data: string }> = [];
    row.push({
      text: directories[i].name,
      callback_data: `cd:${userId}:${encodeURIComponent(directories[i].fullPath)}`,
    });

    if (i + 1 < directories.length) {
      row.push({
        text: directories[i + 1].name,
        callback_data: `cd:${userId}:${encodeURIComponent(directories[i + 1].fullPath)}`,
      });
    }

    buttons.push(row);
  }

  return { inline_keyboard: buttons };
}
