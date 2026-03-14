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

import { loadConfig, loadFileConfig } from './config.js';

describe('Cursor config defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileSyncMock.mockImplementation(() => {
      throw new Error('missing');
    });
    existsSyncMock.mockReturnValue(true);
    accessSyncMock.mockImplementation(() => undefined);
    execFileSyncMock.mockImplementation(() => Buffer.from('cursor'));
    delete process.env.CURSOR_CLI_PATH;
    delete process.env.AI_COMMAND;
  });

  it('defaults Cursor CLI path to cursor for runtime config', () => {
    process.env.AI_COMMAND = 'cursor';
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';

    const config = loadConfig();

    // 无显式配置时使用 cursor；Windows 下可能解析为 npm 或安装路径
    expect(config.cursorCliPath === 'cursor' || config.cursorCliPath.endsWith('cursor.cmd')).toBe(true);
  });

  it('migrates old cursorCliPath-less configs to cursor', () => {
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        aiCommand: 'cursor',
        claudeCliPath: 'claude',
        claudeWorkDir: 'D:/coding/open-im',
        claudeSkipPermissions: true,
      }),
    );

    const file = loadFileConfig();

    expect(file.tools?.cursor?.cliPath).toBe('cursor');
    expect(writeFileSyncMock).toHaveBeenCalled();
  });

  it('preserves explicit legacy agent cursor configs', () => {
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        aiCommand: 'cursor',
        platforms: { telegram: { enabled: true } },
        telegramBotToken: 'test-token',
        tools: {
          cursor: {
            cliPath: 'agent',
            skipPermissions: true,
          },
        },
      }),
    );

    const config = loadConfig();

    expect(config.cursorCliPath).toBe('agent');
  });
});
