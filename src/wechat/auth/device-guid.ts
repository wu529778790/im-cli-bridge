/**
 * 设备唯一标识生成
 * 首次运行时随机生成并持久化到 ~/.open-im/wechat-guid
 */

import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { APP_HOME } from '../../constants.js';

const GUID_FILE = join(APP_HOME, 'wechat-guid');

export function getDeviceGuid(): string {
  try {
    const existing = readFileSync(GUID_FILE, 'utf-8').trim();
    if (existing) return existing;
  } catch {
    /* 文件不存在 */
  }

  const guid = createHash('md5').update(randomUUID()).digest('hex');
  try {
    mkdirSync(dirname(GUID_FILE), { recursive: true });
    writeFileSync(GUID_FILE, guid, 'utf-8');
  } catch {
    /* 写入失败不致命 */
  }
  return guid;
}
