import { describe, expect, it } from 'vitest';
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

  it('resolves relative paths from the current working directory', () => {
    expect(resolveWorkDirInput('D:\\coding\\open-im', 'coding/panhub.shenzjd.com'))
      .toBe('D:\\coding\\open-im\\coding\\panhub.shenzjd.com');
  });
});
