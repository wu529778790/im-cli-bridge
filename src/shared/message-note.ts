export function buildProgressNote(toolNote?: string): string {
  const detail = toolNote?.trim();
  return detail ? `输出中...\n${detail}` : "输出中...";
}

export function buildErrorNote(): string {
  return "执行失败";
}

export function buildTextNote(note: string): string {
  return `─────────\n💡 ${note.trim()}`;
}
