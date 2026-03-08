/**
 * Tmux 相关类型定义
 */

export interface TmuxWindow {
  windowId: string;
  windowName: string;
  cwd: string;
  paneCurrentCommand?: string;
}

export interface TmuxCreateResult {
  success: boolean;
  message: string;
  windowName: string;
  windowId: string;
}
