import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { APP_HOME } from '../constants.js';

const ACTIVE_CHATS_FILE = join(APP_HOME, 'data', 'active-chats.json');

export interface DingTalkActiveTarget {
  chatId: string;
  userId?: string;
  conversationType?: string;
  robotCode?: string;
  updatedAt: number;
}

interface Data {
  dingtalk?: string;
  dingtalkTarget?: DingTalkActiveTarget;
  feishu?: string;
  qq?: string;
  telegram?: string;
  wechat?: string;
  wework?: string;
}

let data: Data = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function isValidDingTalkActiveTarget(value: unknown): value is DingTalkActiveTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as Record<string, unknown>;
  return (
    typeof target.chatId === 'string' &&
    target.chatId.length > 0 &&
    (target.userId === undefined || typeof target.userId === 'string') &&
    (target.conversationType === undefined || typeof target.conversationType === 'string') &&
    (target.robotCode === undefined || typeof target.robotCode === 'string') &&
    typeof target.updatedAt === 'number'
  );
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await mkdir(dirname(ACTIVE_CHATS_FILE), { recursive: true });
      await writeFile(ACTIVE_CHATS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      /* ignore */
    }
  }, 500);
}

export function loadActiveChats(): void {
  try {
    if (existsSync(ACTIVE_CHATS_FILE)) {
      data = JSON.parse(readFileSync(ACTIVE_CHATS_FILE, 'utf-8'));
      if (!isValidDingTalkActiveTarget(data.dingtalkTarget)) {
        delete data.dingtalkTarget;
      }
    }
  } catch {
    data = {};
  }
}

export function getActiveChatId(platform: 'dingtalk' | 'feishu' | 'qq' | 'telegram' | 'wechat' | 'wework'): string | undefined {
  return data[platform];
}

export function setActiveChatId(platform: 'dingtalk' | 'feishu' | 'qq' | 'telegram' | 'wechat' | 'wework', chatId: string): void {
  if (data[platform] === chatId) return;
  data[platform] = chatId;
  scheduleSave();
}

export function getDingTalkActiveTarget(): DingTalkActiveTarget | undefined {
  return isValidDingTalkActiveTarget(data.dingtalkTarget) ? data.dingtalkTarget : undefined;
}

export function setDingTalkActiveTarget(
  target: Omit<DingTalkActiveTarget, 'updatedAt'>,
): void {
  if (!target.chatId) return;

  const nextTarget: DingTalkActiveTarget = {
    ...target,
    updatedAt: Date.now(),
  };

  const prevTarget = data.dingtalkTarget;
  data.dingtalk = target.chatId;
  data.dingtalkTarget = nextTarget;

  if (
    prevTarget?.chatId === nextTarget.chatId &&
    prevTarget?.userId === nextTarget.userId &&
    prevTarget?.conversationType === nextTarget.conversationType &&
    prevTarget?.robotCode === nextTarget.robotCode
  ) {
    return;
  }

  scheduleSave();
}

export function flushActiveChats(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    const dir = dirname(ACTIVE_CHATS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(ACTIVE_CHATS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    /* ignore */
  }
}
