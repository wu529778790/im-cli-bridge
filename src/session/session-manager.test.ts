import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveWorkDirInput } from './session-manager.js';

// ────────────────────────────────────────────────────────────────
// resolveWorkDirInput (existing tests)
// ────────────────────────────────────────────────────────────────

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
    const baseDir = process.cwd();
    const sep = process.platform === 'win32' ? '\\' : '/';
    expect(resolveWorkDirInput(baseDir, 'subdir/nested'))
      .toBe(baseDir + sep + 'subdir' + sep + 'nested');
  });
});

// ────────────────────────────────────────────────────────────────
// SessionManager class tests
// ────────────────────────────────────────────────────────────────

// Mock node:fs so SessionManager doesn't touch real files
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
  chmodSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  realpath: vi.fn((p: string) => Promise.resolve(p)),
}));

import { SessionManager } from './session-manager.js';

describe('SessionManager', () => {
  let sm: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    sm?.destroy();
  });

  it('returns defaultWorkDir for unknown user', () => {
    sm = new SessionManager('/tmp/project');
    expect(sm.getWorkDir('user-new')).toBe('/tmp/project');
  });

  it('getConvId auto-creates a conversation ID', () => {
    sm = new SessionManager('/tmp/project');
    const convId = sm.getConvId('user1');
    expect(convId).toBeTruthy();
    expect(typeof convId).toBe('string');
    // Same user gets the same convId
    expect(sm.getConvId('user1')).toBe(convId);
  });

  it('hasUserSession returns false for unknown user', () => {
    sm = new SessionManager('/tmp/project');
    expect(sm.hasUserSession('nobody')).toBe(false);
  });

  it('hasUserSession returns true after getConvId', () => {
    sm = new SessionManager('/tmp/project');
    sm.getConvId('user1');
    expect(sm.hasUserSession('user1')).toBe(true);
  });

  it('session CRUD for conversation', () => {
    sm = new SessionManager('/tmp/project');
    sm.setSessionIdForConv('user1', 'conv1', 'claude', 'sess-123');
    expect(sm.getSessionIdForConv('user1', 'conv1', 'claude')).toBe('sess-123');

    sm.clearSessionForConv('user1', 'conv1', 'claude');
    expect(sm.getSessionIdForConv('user1', 'conv1', 'claude')).toBeUndefined();
  });

  it('newSession resets user session state', () => {
    sm = new SessionManager('/tmp/project');
    sm.getConvId('user1');
    const oldConvId = sm.getConvId('user1');
    expect(oldConvId).toBeTruthy();

    const result = sm.newSession('user1');
    expect(result).toBe(true);

    const newConvId = sm.getConvId('user1');
    expect(newConvId).toBeTruthy();
    expect(newConvId).not.toBe(oldConvId);
  });

  it('persists sessions via writeFileSync on destroy', async () => {
    const { writeFileSync } = await import('node:fs');
    sm = new SessionManager('/tmp/project');
    sm.getConvId('user1');
    sm.destroy();

    expect(writeFileSync).toHaveBeenCalled();
    const lastCall = vi.mocked(writeFileSync).mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const writtenData = JSON.parse(lastCall![1] as string);
    expect(writtenData.sessions['user1']).toBeDefined();
  });

  it('getModel and setModel work', () => {
    sm = new SessionManager('/tmp/project');
    expect(sm.getModel('user1')).toBeUndefined();
    sm.setModel('user1', 'claude-opus-4-5');
    expect(sm.getModel('user1')).toBe('claude-opus-4-5');
  });
});
