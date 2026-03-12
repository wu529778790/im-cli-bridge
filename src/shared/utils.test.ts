import { describe, expect, it } from 'vitest';
import {
  formatToolCallNotification,
  formatToolStats,
  getContextWarning,
  preprocessMarkdownForTelegram,
  truncateText,
} from './utils.js';

describe('formatToolStats', () => {
  it('formats tool counts with readable labels and emoji', () => {
    expect(formatToolStats({ Bash: 2, Read: 1 }, 3)).toBe(
      '3 轮 3 次工具（💻Bash×2 📖Read×1）'
    );
  });

  it('returns empty string when no tool usage exists', () => {
    expect(formatToolStats({}, 0)).toBe('');
  });

  it('merges plugin/tool name variants into one displayed entry', () => {
    expect(
      formatToolStats(
        {
          'search/web_search': 1,
          'search/web-search': 2,
          'search/WebSearch': 3,
        },
        1
      )
    ).toBe('1 轮 6 次工具（🔎search/WebSearch×6）');
  });
});

describe('formatToolCallNotification', () => {
  it('includes bash command previews', () => {
    expect(
      formatToolCallNotification('Bash', { command: 'npm test -- --runInBand' })
    ).toBe('💻 Bash → npm test -- --runInBand');
  });

  it('normalizes plugin tool variants for notifications', () => {
    expect(
      formatToolCallNotification('search/web_search', { q: 'open-im' })
    ).toBe('🔎 search/WebSearch');
  });
});

describe('getContextWarning', () => {
  it('rotates regular tips before the long-context warning', () => {
    expect(getContextWarning(2)).toBe('💡 提示：用 `/new` 开始全新会话');
    expect(getContextWarning(3)).toBe('💡 可以用 `/cd <路径>` 切换工作目录');
    expect(getContextWarning(10)).toBe('⚠️ 上下文较长，建议 /new 开始新会话');
  });
});

describe('truncateText', () => {
  it('uses a readable Chinese omission marker', () => {
    expect(truncateText('a'.repeat(120), 40)).toContain('...(前文已省略)...');
  });
});

describe('preprocessMarkdownForTelegram', () => {
  it('escapes markdown outside fenced code blocks only', () => {
    const input = 'file_name *bold*\n```ts\nconst x = file_name;\n```';
    expect(preprocessMarkdownForTelegram(input)).toBe(
      'file\\_name \\*bold\\*\n```ts\nconst x = file_name;\n```'
    );
  });
});
