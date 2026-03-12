import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { resolveWorkDirInput } from './session-manager.js';

describe('resolveWorkDirInput', () => {
  it('treats drive-prefixed shorthand as rooted on that drive', () => {
    expect(resolveWorkDirInput('C:\\projects\\foo', 'c:projects/subdir'))
      .toBe('c:\\projects\\subdir');
  });

  it('keeps explicit drive-absolute paths absolute', () => {
    expect(resolveWorkDirInput('C:\\projects\\foo', 'c:/projects/subdir'))
      .toBe('c:\\projects\\subdir');
  });

  it('resolves relative paths from the base directory', () => {
    const baseDir = resolve(process.cwd(), 'test-base');
    expect(resolveWorkDirInput(baseDir, 'subdir/nested'))
      .toBe(join(baseDir, 'subdir', 'nested'));
  });
});
