/**
 * Tmux 管理器 - 通过 CLI 子进程封装 tmux 操作
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { Logger } from '../utils/logger';
import type { TmuxWindow, TmuxCreateResult } from './tmux.types';

const execAsync = promisify(exec);

export class TmuxManager {
  private sessionName: string;
  private mainWindowName: string;
  private logger: Logger;

  constructor(
    sessionName: string = process.env.TMUX_SESSION_NAME || 'im-cli-bridge',
    mainWindowName: string = 'main'
  ) {
    this.sessionName = sessionName;
    this.mainWindowName = mainWindowName;
    this.logger = new Logger('TmuxManager');
  }

  private async runTmux(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const cmd = ['tmux', ...args].join(' ');
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024
      });
      return { stdout: stdout?.trim() || '', stderr: stderr?.trim() || '' };
    } catch (err: any) {
      this.logger.error(`tmux command failed: ${cmd}`, err?.message);
      throw err;
    }
  }

  /** 获取或创建 session */
  async getOrCreateSession(): Promise<boolean> {
    const session = await this.getSession();
    if (session) return true;
    try {
      await this.runTmux([
        'new-session',
        '-d',
        '-s',
        this.sessionName,
        '-n',
        this.mainWindowName,
        '-c',
        process.env.HOME || process.cwd()
      ]);
      this.logger.info(`Created tmux session: ${this.sessionName}`);
      return true;
    } catch (e) {
      this.logger.error('Failed to create tmux session', e);
      return false;
    }
  }

  /** 检查 session 是否存在 */
  async getSession(): Promise<boolean> {
    try {
      const { stdout } = await this.runTmux(['has-session', '-t', this.sessionName]);
      return true;
    } catch {
      return false;
    }
  }

  /** 列出所有 window（跳过 main） */
  async listWindows(): Promise<TmuxWindow[]> {
    const session = await this.getSession();
    if (!session) return [];

    try {
      const { stdout } = await this.runTmux([
        'list-windows',
        '-t',
        this.sessionName,
        '-F',
        '#{window_id}	#{window_name}	#{pane_current_path}	#{pane_current_command}'
      ]);

      const windows: TmuxWindow[] = [];
      for (const line of stdout.split('\n').filter(Boolean)) {
        const parts = line.split('\t');
        const windowId = parts[0] || '';
        const windowName = parts[1] || '';
        const cwd = parts[2] || '';
        const paneCurrentCommand = parts[3] || '';

        if (windowName === this.mainWindowName) continue;

        windows.push({
          windowId,
          windowName,
          cwd,
          paneCurrentCommand
        });
      }
      return windows;
    } catch (e) {
      this.logger.debug('list-windows failed', e);
      return [];
    }
  }

  /** 根据 window_id 查找 window */
  async findWindowById(windowId: string): Promise<TmuxWindow | null> {
    const windows = await this.listWindows();
    return windows.find((w) => w.windowId === windowId) || null;
  }

  /** 根据 window_name 查找 window */
  async findWindowByName(windowName: string): Promise<TmuxWindow | null> {
    const windows = await this.listWindows();
    return windows.find((w) => w.windowName === windowName) || null;
  }

  /** 发送按键到指定 window */
  async sendKeys(
    windowId: string,
    text: string,
    options: { enter?: boolean; literal?: boolean } = {}
  ): Promise<boolean> {
    const { enter = true, literal = true } = options;
    const target = `${this.sessionName}:${windowId}`;

    try {
      if (literal && enter) {
        // ccbot: 先发文本，500ms 后再发 Enter，避免 TUI 误解析
        await this.runTmux(['send-keys', '-t', target, '-l', text]);
        await new Promise((r) => setTimeout(r, 500));
        await this.runTmux(['send-keys', '-t', target, 'Enter']);
      } else {
        const args = ['send-keys', '-t', target];
        if (literal) args.push('-l');
        args.push(enter ? 'Enter' : text);
        if (!enter && text) args[args.length - 1] = text;
        await this.runTmux(args);
      }
      return true;
    } catch (e) {
      this.logger.error(`send-keys failed for ${target}`, e);
      return false;
    }
  }

  /** 捕获 pane 内容（可选 ANSI） */
  async capturePane(windowId: string, withAnsi = false): Promise<string | null> {
    const target = `${this.sessionName}:${windowId}`;
    try {
      const args = ['capture-pane', '-t', target, '-p'];
      if (withAnsi) args.push('-e');
      const { stdout } = await this.runTmux(args);
      return stdout || null;
    } catch (e) {
      this.logger.debug(`capture-pane failed for ${target}`, e);
      return null;
    }
  }

  /** 关闭指定 window */
  async killWindow(windowId: string): Promise<boolean> {
    const target = `${this.sessionName}:${windowId}`;
    try {
      await this.runTmux(['kill-window', '-t', target]);
      this.logger.info(`Killed window ${target}`);
      return true;
    } catch (e) {
      this.logger.error(`kill-window failed for ${target}`, e);
      return false;
    }
  }

  /** 创建新 window 并可选启动 claude */
  async createWindow(
    workDir: string,
    windowName?: string,
    startClaude = true,
    resumeSessionId?: string
  ): Promise<TmuxCreateResult> {
    const dir = workDir.startsWith('~')
      ? path.join(process.env.HOME || '', workDir.slice(1))
      : path.resolve(workDir);

    try {
      const stat = await import('fs').then((fs) => fs.promises.stat(dir));
      if (!stat.isDirectory()) {
        return { success: false, message: 'Not a directory', windowName: '', windowId: '' };
      }
    } catch {
      return { success: false, message: 'Directory does not exist', windowName: '', windowId: '' };
    }

    const baseName = windowName || path.basename(dir);
    let finalName = baseName;
    let counter = 2;
    while (await this.findWindowByName(finalName)) {
      finalName = `${baseName}-${counter}`;
      counter++;
    }

    const claudeCmd =
      process.env.CLAUDE_COMMAND || process.env.AI_COMMAND || 'claude';
    const cmd = resumeSessionId
      ? `${claudeCmd} --resume ${resumeSessionId}`
      : claudeCmd;

    try {
      await this.getOrCreateSession();
      const { stdout } = await this.runTmux([
        'new-window',
        '-t',
        this.sessionName,
        '-n',
        finalName,
        '-c',
        dir
      ]);

      const match = stdout?.match(/\[(\d+)\]/);
      const windowId = match ? `@${match[1]}` : '';
      if (!windowId) {
        return { success: false, message: 'Failed to get window id', windowName: finalName, windowId: '' };
      }

      await this.runTmux(['set-window-option', '-t', `${this.sessionName}:${windowId}`, 'allow-rename', 'off']);

      if (startClaude) {
        await this.runTmux(['send-keys', '-t', `${this.sessionName}:${windowId}`, cmd, 'Enter']);
      }

      this.logger.info(`Created window ${finalName} (${windowId}) at ${dir}`);
      return {
        success: true,
        message: `Created window '${finalName}' at ${dir}`,
        windowName: finalName,
        windowId
      };
    } catch (e: any) {
      this.logger.error('createWindow failed', e);
      return {
        success: false,
        message: e?.message || 'Failed to create window',
        windowName: finalName,
        windowId: ''
      };
    }
  }
}
