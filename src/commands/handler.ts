import type { Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import type { RequestQueue } from '../queue/request-queue.js';
import { resolveLatestPermission, getPendingCount } from '../hook/permission-server.js';
import { TERMINAL_ONLY_COMMANDS } from '../constants.js';
import { execFile } from 'node:child_process';
import type { ThreadContext, CostRecord } from '../shared/types.js';

export type { ThreadContext, CostRecord };

export interface MessageSender {
  sendTextReply(chatId: string, text: string, threadCtx?: ThreadContext): Promise<void>;
}

export interface CommandHandlerDeps {
  config: Config;
  sessionManager: SessionManager;
  requestQueue: RequestQueue;
  sender: MessageSender;
  userCosts: Map<string, CostRecord>;
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
    platform: 'feishu' | 'telegram',
    handleClaudeRequest: ClaudeRequestHandler
  ): Promise<boolean> {
    const t = text.trim();

    if (platform === 'telegram' && t === '/start') {
      await this.deps.sender.sendTextReply(chatId, '欢迎使用 open-im AI CLI 桥接！\n\n发送消息与 AI 交互，输入 /help 查看帮助。');
      return true;
    }

    if (t === '/help') return this.handleHelp(chatId, platform);
    if (t === '/new') return this.handleNew(chatId, userId);
    if (t === '/pwd') return this.handlePwd(chatId, userId);
    if (t === '/status') return this.handleStatus(chatId, userId);
    if (t === '/allow' || t === '/y') return this.handleAllow(chatId);
    if (t === '/deny' || t === '/n') return this.handleDeny(chatId);

    if (t === '/cd' || t.startsWith('/cd ')) {
      return this.handleCd(chatId, userId, t.slice(3).trim());
    }

    const cmd = t.split(/\s+/)[0];
    if (TERMINAL_ONLY_COMMANDS.has(cmd)) {
      await this.deps.sender.sendTextReply(chatId, `${cmd} 命令仅在终端可用。`);
      return true;
    }

    return false;
  }

  private async handleHelp(chatId: string, platform: 'feishu' | 'telegram'): Promise<boolean> {
    const help = [
      '📋 可用命令:',
      '',
      '/help - 显示帮助',
      '/new - 开始新会话',
      '/status - 显示状态',
      '/cd <路径> - 切换工作目录',
      '/pwd - 当前工作目录',
      '/allow (/y) - 允许权限请求',
      '/deny (/n) - 拒绝权限请求',
    ].join('\n');
    await this.deps.sender.sendTextReply(chatId, help);
    return true;
  }

  private async handleNew(chatId: string, userId: string): Promise<boolean> {
    const ok = this.deps.sessionManager.newSession(userId);
    await this.deps.sender.sendTextReply(
      chatId,
      ok ? '✅ 已开始新会话。' : '当前没有活动会话。'
    );
    return true;
  }

  private async handlePwd(chatId: string, userId: string): Promise<boolean> {
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    await this.deps.sender.sendTextReply(chatId, `当前工作目录: ${workDir}`);
    return true;
  }

  private async handleStatus(chatId: string, userId: string): Promise<boolean> {
    const version = await this.getClaudeVersion();
    const workDir = this.deps.sessionManager.getWorkDir(userId);
    const convId = this.deps.sessionManager.getConvId(userId);
    const sessionId = this.deps.sessionManager.getSessionIdForConv(userId, convId);
    const record = this.deps.userCosts.get(userId);
    const lines = [
      '📊 状态:',
      '',
      `AI 工具: ${this.deps.config.aiCommand}`,
      `版本: ${version}`,
      `工作目录: ${workDir}`,
      `会话: ${sessionId ?? '无'}`,
      `费用: $${record?.totalCost.toFixed(4) ?? '0.0000'}`,
    ];
    await this.deps.sender.sendTextReply(chatId, lines.join('\n'));
    return true;
  }

  private async handleCd(chatId: string, userId: string, dir: string): Promise<boolean> {
    if (!dir) {
      await this.deps.sender.sendTextReply(chatId, `当前目录: ${this.deps.sessionManager.getWorkDir(userId)}\n使用 /cd <路径> 切换`);
      return true;
    }
    try {
      const resolved = await this.deps.sessionManager.setWorkDir(userId, dir);
      await this.deps.sender.sendTextReply(chatId, `工作目录已切换到: ${resolved}\n会话已重置。`);
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

  private getClaudeVersion(): Promise<string> {
    return new Promise((resolve) => {
      execFile(this.deps.config.claudeCliPath, ['--version'], { timeout: 5000 }, (err, stdout) => {
        resolve(err ? '未知' : (stdout?.toString().trim() || '未知'));
      });
    });
  }
}
