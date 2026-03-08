/**
 * Claude Code JSONL transcript 解析器
 * 解析 ~/.claude/projects/ 下的 session JSONL
 */

const RE_ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

export interface ParsedEntry {
  role: 'user' | 'assistant';
  text: string;
  contentType: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'local_command';
  toolUseId?: string;
  toolName?: string;
  timestamp?: string;
}

function extractTextOnly(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const texts: string[] = [];
  for (const item of content) {
    if (typeof item === 'string') {
      texts.push(item);
    } else if (item && typeof item === 'object' && (item as any).type === 'text') {
      const t = (item as any).text;
      if (t) texts.push(t);
    }
  }
  return texts.join('\n').replace(RE_ANSI_ESCAPE, '');
}

export class TranscriptParser {
  static parseLine(line: string): Record<string, unknown> | null {
    const s = line.trim();
    if (!s) return null;
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  static getMessageType(data: Record<string, unknown>): string | undefined {
    return data.type as string;
  }

  static parseEntries(entries: Record<string, unknown>[]): ParsedEntry[] {
    const result: ParsedEntry[] = [];

    for (const data of entries) {
      const msgType = this.getMessageType(data);
      if (msgType !== 'user' && msgType !== 'assistant') continue;

      const message = data.message as Record<string, unknown> | undefined;
      if (!message || typeof message !== 'object') continue;

      const content = message.content;
      const text = extractTextOnly(content).replace(RE_ANSI_ESCAPE, '').trim();
      const timestamp = data.timestamp as string | undefined;

      if (msgType === 'assistant') {
        result.push({
          role: 'assistant',
          text,
          contentType: 'text',
          timestamp
        });
      } else if (msgType === 'user') {
        result.push({
          role: 'user',
          text,
          contentType: 'text',
          timestamp
        });
      }
    }

    return result.filter((e) => e.text.length > 0);
  }
}
