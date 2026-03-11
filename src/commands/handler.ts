import type { Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import type { RequestQueue } from '../queue/request-queue.js';
import { resolveLatestPermission, getPendingCount } from '../hook/permission-server.js';
import { getPermissionMode, setPermissionMode } from '../permission-mode/session-mode.js';
import { MODE_LABELS, MODE_DESCRIPTIONS, parsePermissionMode, type PermissionMode } from '../permission-mode/types.js';
import { TERMINAL_ONLY_COMMANDS } from '../constants.js';
import { execFile } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ThreadContext } from '../shared/types.js';

export type { ThreadContext };

export interface MessageSender {
  sendTextReply(chatId: string, text: string, threadCtx?: ThreadContext): Promise<void>;
  sendDirectorySelection?(chatId: string, currentDir: string, userId: string): Promise<void>;
  sendModeCard?(chatId: string, userId: string, currentMode: PermissionMode): Promise<void>;
  sendModeKeyboard?(chatId: string, userId: string, currentMode: PermissionMode): Promise<void>;
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
    platform: 'feishu' | 'telegram' | 'wechat' | 'wework',
    handleClaudeRequest: ClaudeRequestHandler
  ): Promise<boolean> {
    const t = text.trim();

    if (platform === 'telegram' && t === '/start') {
      await this.deps.sender.sendTextReply(chatId, '欢迎使用 open-im AI CLI 桥接！\n\n发送消息与 AI 交互，输入 /help 查看帮助。');
      return true;
    }

    if (t === '/help') return this.handleHelp(chatId, platform);
    if (t === '/mode' || t.startsWith('/mode ')) return this.handleMode(chatId, userId, platform, t.slice(6).trim());
    if (t === '/new') return this.handleNew(chatId, userId, platform);
    if (t === '/pwd') return this.handlePwd(chatId, userId);
    if (t === '/status') return this.handleStatus(chatId, userId);
    if (t === '/allow' || t === '/y') return this.handleAllow(chatId);
    if (t === '/deny' || t === '/n') return this.handleDeny(chatId);

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

  private async handleMode(
    chatId: string,
    userId: string,
    platform: 'feishu' | 'telegram' | 'wechat' | 'wework',
    arg: string
  ): Promise<boolean> {
    const defaultMode = this.deps.config.defaultPermissionMode;
    const currentMode = getPermissionMode(userId, defaultMode);

    if (arg) {
      const parsed = parsePermissionMode(arg);
      if (parsed) {
        setPermissionMode(userId, parsed);
        await this.deps.sender.sendTextReply(
          chatId,
          `✅ 权限模式已切换为 **${MODE_LABELS[parsed]}**\n${MODE_DESCRIPTIONS[parsed]}`
        );
        return true;
      }
      await this.deps.sender.sendTextReply(
        chatId,
        `无效模式: ${arg}\n可用: ask, accept-edits, plan, yolo`
      );
      return true;
    }

    if (platform === 'feishu' && this.deps.sender.sendModeCard) {
      await this.deps.sender.sendModeCard(chatId, userId, currentMode);
      return true;
    }
    if (platform === 'telegram' && this.deps.sender.sendModeKeyboard) {
      await this.deps.sender.sendModeKeyboard(chatId, userId, currentMode);
      return true;
    }

    const lines = [
      `🔐 **权限模式** (当前: ${MODE_LABELS[currentMode]})`,
      '',
      ...(['ask', 'accept-edits', 'plan', 'yolo'] as const).map(
        (m) => `• \`/mode ${m}\` - ${MODE_LABELS[m]}: ${MODE_DESCRIPTIONS[m]}`
      ),
    ];
    await this.deps.sender.sendTextReply(chatId, lines.join('\n'));
    return true;
  }

  private getClearHistoryHint(platform: 'feishu' | 'telegram' | 'wechat' | 'wework'): string {
    return platform === 'feishu'
      ? '💡 提示：如需清除本对话的历史消息，请点击飞书聊天右上角「...」→ 清除聊天记录'
      : platform === 'wechat'
      ? '💡 提示：如需清除本对话的历史消息，请清除聊天记录'
      : '💡 提示：如需清除本对话的历史消息，请点击 Telegram 聊天右上角 ⋮ → 清除历史';
  }

  private async handleHelp(chatId: string, platform: 'feishu' | 'telegram' | 'wechat' | 'wework'): Promise<boolean> {
    const help = [
      '📋 可用命令:',
      '',
      '/help - 显示帮助',
      '/mode - 切换权限模式（安全/编辑放行/只读/YOLO）',
      '/new - 开始新会话（AI 上下文重置）',
      '/status - 显示状态',
      '/cd <路径> - 切换工作目录',
      '/pwd - 当前工作目录',
      '/allow (/y) - 允许权限请求',
      '/deny (/n) - 拒绝权限请求',
      '',
      this.getClearHistoryHint(platform),
    ].join('\n');
    await this.deps.sender.sendTextReply(chatId, help);
    return true;
  }

  private async handleNew(chatId: string, userId: string, platform: 'feishu' | 'telegram' | 'wechat' | 'wework'): Promise<boolean> {
    const ok = this.deps.sessionManager.newSession(userId);
    await this.deps.sender.sendTextReply(
      chatId,
      ok
        ? `✅ AI 会话已重置，下一条消息将使用全新上下文。\n\n${this.getClearHistoryHint(platform)}`
        : '当前没有活动会话。'
    );
    return true;
  }

  private async handlePwd(chatId: string, userId: string): Promise<boolean> {
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    await this.deps.sender.sendTextReply(chatId, `当前工作目录: ${workDir}`);
    return true;
  }

  private async handleStatus(chatId: string, userId: string): Promise<boolean> {
    const version = await this.getAiVersion();
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    const convId = this.deps.sessionManager.getConvId(userId);
    const sessionId = this.deps.sessionManager.getSessionIdForConv(userId, convId);
    const lines = [
      '📊 状态:',
      '',
      `AI 工具: ${this.deps.config.aiCommand}`,
      `版本: ${version}`,
      `工作目录: ${workDir}`,
      `会话: ${sessionId ?? '无'}`,
    ];
    await this.deps.sender.sendTextReply(chatId, lines.join('\n'));
    return true;
  }

  private async handleCd(chatId: string, userId: string, dir: string, platform: 'feishu' | 'telegram' | 'wechat' | 'wework'): Promise<boolean> {
    // 如果 dir 为空，显示目录选择界面
    if (!dir) {
      const currentDir = this.deps.sessionManager.getWorkDir(userId);
      if (this.deps.sender.sendDirectorySelection) {
        await this.deps.sender.sendDirectorySelection(chatId, currentDir, userId);
      } else {
        await this.deps.sender.sendTextReply(
          chatId,
          `当前目录: ${currentDir}\n使用 /cd <路径> 切换`
        );
      }
      return true;
    }
    try {
      const resolved = await this.deps.sessionManager.setWorkDir(userId, dir);
      await this.deps.sender.sendTextReply(
        chatId,
        `📁 工作目录已切换到: ${resolved}\n\n` +
        `🔄 AI 会话已重置，下一条消息将使用全新上下文。\n` +
        this.getClearHistoryHint(platform)
      );
    } catch (err) {
      await this.deps.sender.sendTextReply(chatId, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  private async handleAllow(chatId: string): Promise<boolean> {
    const reqId = resolveLatestPermission(chatId, 'allow');
    if (reqId) {
      const remaining = getPendingCount(chatId);
      await this.deps.sender.sendTextReply(chatId, `✅ 权限已允许${remaining > 0 ? `（还有 ${remaining} 个待确认）` : ''}`);
    } else {
      await this.deps.sender.sendTextReply(chatId, 'ℹ️ 没有待确认的权限请求');
    }
    return true;
  }

  private async handleDeny(chatId: string): Promise<boolean> {
    const reqId = resolveLatestPermission(chatId, 'deny');
    if (reqId) {
      await this.deps.sender.sendTextReply(chatId, '❌ 权限已拒绝');
    } else {
      await this.deps.sender.sendTextReply(chatId, 'ℹ️ 没有待确认的权限请求');
    }
    return true;
  }

  private getAiVersion(): Promise<string> {
    const cmd = this.deps.config.aiCommand === 'cursor'
      ? this.deps.config.cursorCliPath
      : this.deps.config.aiCommand === 'codex'
        ? this.deps.config.codexCliPath
        : this.deps.config.claudeCliPath;
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
