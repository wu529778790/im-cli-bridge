export function buildProgressNote(toolNote?: string): string {
  const detail = toolNote?.trim();
  return detail ? `\u8f93\u51fa\u4e2d...\n${detail}` : "\u8f93\u51fa\u4e2d...";
}

export function buildErrorNote(): string {
  return "\u6267\u884c\u5931\u8d25";
}

export function buildTextNote(note: string): string {
  return `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n\u{1F4A1} ${note.trim()}`;
}
