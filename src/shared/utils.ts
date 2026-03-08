import type { CostRecord } from './types.js';

const TOOL_EMOJIS: Record<string, string> = {
  Read: '📖', Write: '✏️', Edit: '📝', Bash: '💻', Glob: '🔍', Grep: '🔎',
  WebFetch: '🌐', WebSearch: '🔎', Task: '📋', TodoRead: '📌', TodoWrite: '✅',
};

function getToolEmoji(name: string): string {
  return TOOL_EMOJIS[name] ?? '🔧';
}

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const keepLen = maxLen - 20;
  const tail = text.slice(text.length - keepLen);
  const lineBreak = tail.indexOf('\n');
  const clean = lineBreak > 0 && lineBreak < 200 ? tail.slice(lineBreak + 1) : tail;
  return `...(前文已省略)...\n${clean}`;
}

export function splitLongContent(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxLen;
    if (end >= text.length) {
      parts.push(text.slice(start));
      break;
    }
    const lastNewline = text.lastIndexOf('\n', end);
    if (lastNewline > start) end = lastNewline + 1;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

export function formatToolStats(toolStats: Record<string, number>, numTurns: number): string {
  const total = Object.values(toolStats).reduce((a, b) => a + b, 0);
  if (total === 0) return '';
  const parts = Object.entries(toolStats)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${getToolEmoji(name)}${name}×${count}`)
    .join(' ');
  return `${numTurns > 0 ? numTurns + ' 轮 ' : ''}${total} 次工具（${parts}）`;
}

export function formatToolCallNotification(toolName: string, toolInput?: Record<string, unknown>): string {
  const emoji = getToolEmoji(toolName);
  if (!toolInput) return `${emoji} ${toolName}`;
  let detail = '';
  if (toolName === 'Bash' && toolInput.command) detail = ` → ${String(toolInput.command).slice(0, 60)}`;
  if (toolName === 'Read' && toolInput.file_path) detail = ` → ${toolInput.file_path}`;
  if (toolName === 'Write' && toolInput.file_path) detail = ` → ${toolInput.file_path}`;
  return `${emoji} ${toolName}${detail}`;
}

export function trackCost(userCosts: Map<string, CostRecord>, userId: string, cost: number, durationMs: number): void {
  const r = userCosts.get(userId) ?? { totalCost: 0, totalDurationMs: 0, requestCount: 0 };
  r.totalCost += cost;
  r.totalDurationMs += durationMs;
  r.requestCount += 1;
  userCosts.set(userId, r);
}

export function getContextWarning(totalTurns: number): string | null {
  if (totalTurns >= 12) return '⚠️ 上下文较长，建议 /new 开始新会话';
  if (totalTurns >= 8) return `💡 对话已 ${totalTurns} 轮，可用 /compact 压缩`;
  return null;
}
