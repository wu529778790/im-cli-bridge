import { describe, expect, it } from 'vitest';

import { buildCodeBuddyArgs } from './cli-runner.js';

describe('buildCodeBuddyArgs', () => {
  it('builds print-mode stream-json args for new sessions', () => {
    const args = buildCodeBuddyArgs('fix the bug', undefined, {
      skipPermissions: true,
    });

    expect(args).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions',
      'fix the bug',
    ]);
  });

  it('adds resume and permission mode for existing sessions', () => {
    const args = buildCodeBuddyArgs('review this change', 'session-123', {
      permissionMode: 'plan',
      model: 'deepseek-v3',
    });

    expect(args).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--permission-mode',
      'plan',
      '--model',
      'deepseek-v3',
      '--resume',
      'session-123',
      'review this change',
    ]);
  });
});
