import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { resolveWorkDirInput } from './session-manager.js';

describe('resolveWorkDirInput', () => {
  it('treats drive-prefixed shorthand as rooted on that drive', () => {
    expect(resolveWorkDirInput('D:\\coding\\open-im', 'd:coding/panhub.shenzjd.com'))
      .toBe('d:\\coding\\panhub.shenzjd.com');
  });

  it('keeps explicit drive-absolute paths absolute', () => {
    expect(resolveWorkDirInput('D:\\coding\\open-im', 'd:/coding/panhub.shenzjd.com'))
      .toBe('d:\\coding\\panhub.shenzjd.com');
  });

  it('resolves relative paths from the base directory', () => {
    const baseDir = resolve(process.cwd(), 'test-base');
    expect(resolveWorkDirInput(baseDir, 'coding/panhub.shenzjd.com'))
      .toBe(join(baseDir, 'coding', 'panhub.shenzjd.com'));
  });
});
