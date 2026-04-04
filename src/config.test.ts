import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  accessSyncMock,
  existsSyncMock,
  mkdirSyncMock,
  readFileSyncMock,
  writeFileSyncMock,
  execFileSyncMock,
} = vi.hoisted(() => ({
  accessSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  execFileSyncMock: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    accessSync: accessSyncMock,
    existsSync: existsSyncMock,
    mkdirSync: mkdirSyncMock,
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock,
  };
});

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

import { loadConfig } from './config.js';

describe('config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileSyncMock.mockImplementation(() => {
      throw new Error('missing');
    });
    existsSyncMock.mockReturnValue(true);
    accessSyncMock.mockImplementation(() => undefined);
  });

  it('loadFileConfig returns empty object when config file is missing', () => {
    const file = loadFileConfig();
    expect(file).toEqual({});
  });
});
