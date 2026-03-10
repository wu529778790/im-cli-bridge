/**
 * 权限模式类型定义
 * 参考 Happy / Claude Code: ask(安全) | accept-edits(编辑放行) | plan(只读) | yolo(全放行)
 */
export type PermissionMode = 'ask' | 'accept-edits' | 'plan' | 'yolo';

export const PERMISSION_MODES: PermissionMode[] = ['ask', 'accept-edits', 'plan', 'yolo'];

export const MODE_LABELS: Record<PermissionMode, string> = {
  ask: '🛡️ 安全',
  'accept-edits': '✏️ 编辑放行',
  plan: '📋 只读',
  yolo: '🚀 YOLO',
};

export const MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
  ask: '每次操作需确认',
  'accept-edits': '编辑自动通过，命令需确认',
  plan: '仅分析不执行',
  yolo: '全部自动放行',
};

export function parsePermissionMode(raw: string): PermissionMode | null {
  const s = raw.trim().toLowerCase();
  if (PERMISSION_MODES.includes(s as PermissionMode)) return s as PermissionMode;
  const aliases: Record<string, PermissionMode> = {
    safe: 'ask',
    default: 'ask',
    edit: 'accept-edits',
    edits: 'accept-edits',
    read: 'plan',
    readonly: 'plan',
    bypass: 'yolo',
  };
  return aliases[s] ?? null;
}
