/**
 * 全局安装时，配置与数据放在用户目录
 * ~/.im-cli-bridge/ （Unix / Windows 通用）
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function getConfigDir(): string {
  return path.join(os.homedir(), '.im-cli-bridge');
}

export function getEnvPath(): string {
  return path.join(getConfigDir(), '.env');
}

export function getPidPath(): string {
  return path.join(getConfigDir(), 'im-cli-bridge.pid');
}

export function getLogDir(): string {
  return path.join(getConfigDir(), 'logs');
}

/** Tmux 模式下 session_map 文件路径（window_id → session_id） */
export function getSessionMapPath(): string {
  return path.join(getConfigDir(), 'session_map.json');
}

/** 状态存储（user_id → window_id 映射） */
export function getStatePath(): string {
  return path.join(getConfigDir(), 'state.json');
}

/** Claude projects 目录（JSONL 所在） */
export function getClaudeProjectsPath(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

export function ensureConfigDir(): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const logDir = getLogDir();
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}
