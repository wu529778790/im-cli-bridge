/** AI 工具显示名称映射（aiCommand → 用户友好名称） */
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
  if (toolName === 'Bash' && (toolInput.command ?? toolInput.cmd)) detail = ` → ${String(toolInput.command ?? toolInput.cmd).slice(0, 60)}`;
  if (toolName === 'Read' && toolInput.file_path) detail = ` → ${toolInput.file_path}`;
  if (toolName === 'Write' && toolInput.file_path) detail = ` → ${toolInput.file_path}`;
  return `${emoji} ${toolName}${detail}`;
}

// 使用提示池，每轮显示不同的技巧
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
  // 降低阈值，让提示更早开始轮换显示
  if (totalTurns < 2) return null;

  // 第 10 次后一直显示警告
  if (totalTurns >= 10) {
    return USAGE_TIPS[USAGE_TIPS.length - 1];
  }

  // 根据轮数循环显示提示（排除最后的警告）
  const regularTips = USAGE_TIPS.slice(0, -1);
  const tipIndex = (totalTurns - 2) % regularTips.length;
  return regularTips[tipIndex];
}

/**
 * 预处理 Markdown 内容，将其转换为 Telegram 友好的格式
 * Telegram Markdown 不支持标题（#），需要转换为粗体
 */
export function preprocessMarkdownForTelegram(content: string): string {
  return content
    // 转换 Markdown 标题为粗体（支持 1-6 级标题）
    .replace(/^#{1,6}\s+(.+)$/gm, '**$1**')
    // 转换加粗（如果使用 __ 形式）
    .replace(/__(.+?)__/g, '**$1**')
    // 转换斜体（如果使用 _ 形式且不是 __）
    .replace(/(?<!_)_(?!_)(.+?)(?!_)_(?!_)/g, '*$1*')
    // 确保 ``` 代码块正确
    .replace(/```(\w*)\n([\s\S]+?)```/g, '```$1\n$2```');
}
