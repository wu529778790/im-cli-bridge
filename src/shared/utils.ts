/** 消息头部品牌后缀，用于飞书等平台展示 */
export const OPEN_IM_BRAND_SUFFIX = ' · 通过 open-im 控制';

/** 转义路径供 Markdown 显示，防止 xxx.yyy.com 被解析为链接 */
export function escapePathForMarkdown(path: string): string {
  return `\`${path.replace(/`/g, '\\`')}\``;
}

/** AI 工具显示名称映射（aiCommand -> 用户友好名称） */
export const AI_TOOL_DISPLAY_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
};

/** 获取 AI 工具的显示名称 */
export function getAIToolDisplayName(aiCommand: string): string {
  return AI_TOOL_DISPLAY_NAMES[aiCommand] ?? aiCommand;
}

const TOOL_EMOJIS: Record<string, string> = {
  Read: '📖',
  Write: '✏️',
  Edit: '📝',
  Bash: '💻',
  Glob: '🔍',
  Grep: '🔎',
  WebFetch: '🌐',
  WebSearch: '🔎',
  Task: '📋',
  TodoRead: '📌',
  TodoWrite: '✅',
};

const TOOL_NAME_ALIASES: Record<string, string> = {
  read: 'Read',
  file_read: 'Read',
  write: 'Write',
  file_write: 'Write',
  edit: 'Edit',
  file_edit: 'Edit',
  patch: 'Edit',
  bash: 'Bash',
  shell: 'Bash',
  command: 'Bash',
  grep: 'Grep',
  search: 'WebSearch',
  websearch: 'WebSearch',
  web_search: 'WebSearch',
  webfetch: 'WebFetch',
  web_fetch: 'WebFetch',
  fetch: 'WebFetch',
  glob: 'Glob',
  task: 'Task',
  todoread: 'TodoRead',
  todo_read: 'TodoRead',
  todowrite: 'TodoWrite',
  todo_write: 'TodoWrite',
};

function normalizeToolKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function resolveToolDisplayName(name: string): string {
  if (TOOL_EMOJIS[name]) return name;

  const parts = name.split('/');
  const toolPart = parts[parts.length - 1];
  const alias =
    TOOL_NAME_ALIASES[normalizeToolKey(name)] ??
    TOOL_NAME_ALIASES[normalizeToolKey(toolPart)];

  if (!alias) return name;
  if (parts.length === 1) return alias;
  return `${parts.slice(0, -1).join('/')}/${alias}`;
}

function getToolEmoji(name: string): string {
  const displayName = resolveToolDisplayName(name);
  const toolPart = displayName.split('/').pop() ?? displayName;
  return TOOL_EMOJIS[displayName] ?? TOOL_EMOJIS[toolPart] ?? '🔧';
}

function mergeToolStats(toolStats: Record<string, number>): Array<[string, number]> {
  const merged = new Map<string, number>();
  for (const [name, count] of Object.entries(toolStats)) {
    const displayName = resolveToolDisplayName(name);
    merged.set(displayName, (merged.get(displayName) ?? 0) + count);
  }
  return [...merged.entries()];
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
  const mergedStats = mergeToolStats(toolStats);
  const total = mergedStats.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return '';
  const parts = mergedStats
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${getToolEmoji(name)}${name}×${count}`)
    .join(' ');
  return `${numTurns > 0 ? numTurns + ' 轮 ' : ''}${total} 次工具（${parts}）`;
}

export function formatToolCallNotification(toolName: string, toolInput?: Record<string, unknown>): string {
  const displayName = resolveToolDisplayName(toolName);
  const emoji = getToolEmoji(displayName);
  if (!toolInput) return `${emoji} ${toolName}`;
  let detail = '';
  if (toolName === 'Bash' && (toolInput.command ?? toolInput.cmd)) detail = ` → ${String(toolInput.command ?? toolInput.cmd).slice(0, 60)}`;
  if (toolName === 'Read' && toolInput.file_path) detail = ` → ${toolInput.file_path}`;
  if (toolName === 'Write' && toolInput.file_path) detail = ` → ${toolInput.file_path}`;
  return `${emoji} ${displayName}${detail}`;
}

const USAGE_TIPS = [
  '💡 提示：用 `/new` 开始全新会话',
  '💡 可以用 `/cd <路径>` 切换工作目录',
  '💡 用 `/pwd` 查看当前目录',
  '💡 用 `/status` 查看运行状态',
  '💡 支持发送图片让 AI 分析',
  '💡 支持多行代码输入',
  '⚠️ 上下文较长，建议 /new 开始新会话',
];

export function getContextWarning(totalTurns: number): string | null {
  if (totalTurns < 2) return null;
  if (totalTurns >= 10) return USAGE_TIPS[USAGE_TIPS.length - 1];

  const regularTips = USAGE_TIPS.slice(0, -1);
  const tipIndex = (totalTurns - 2) % regularTips.length;
  return regularTips[tipIndex];
}

/**
 * 预处理 Markdown 内容，将其转换为 Telegram 友好的格式。
 * Telegram 对 _ * [ ] ` 敏感，未配对会导致 "can't parse entities"。
 */
export function preprocessMarkdownForTelegram(content: string): string {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        return part;
      }
      return part.replace(/([_*\[\]`])/g, '\\$1');
    })
    .join('');
}
