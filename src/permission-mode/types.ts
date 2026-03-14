/**
 * 权限模式类型定义
 * 与 Claude Code 官方命名一致: default | acceptEdits | plan | bypassPermissions
 * 见 https://code.claude.com/docs/en/permissions
 */
export type PermissionMode = 'ask' | 'accept-edits' | 'plan' | 'yolo';

export const PERMISSION_MODES: PermissionMode[] = ['ask', 'accept-edits', 'plan', 'yolo'];

/** 用户侧展示名 */
export const MODE_LABELS: Record<PermissionMode, string> = {
  ask: '每次询问',
  'accept-edits': '自动批准编辑',
  plan: '仅分析',
  yolo: '跳过所有权限',
};

export const MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
  ask: '首次使用每个工具时提示确认',
  'accept-edits': '编辑权限自动通过',
  plan: '仅分析，不修改文件不执行命令',
  yolo: '跳过所有权限确认',
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
