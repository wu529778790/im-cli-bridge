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
