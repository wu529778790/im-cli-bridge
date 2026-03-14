import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

import { runCursor } from './cli-runner.js';

class MockChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 1234;
  killed = false;

  kill(): void {
    this.killed = true;
  }
}

describe('runCursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnMock.mockImplementation(() => new MockChildProcess());
  });

  it('prepends the agent subcommand for the top-level cursor CLI', () => {
    runCursor(
      'cursor',
      'hello',
      undefined,
      'D:\\coding\\open-im',
      {
        onText: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
    );

    expect(spawnMock).toHaveBeenCalledWith(
      'cursor',
      [
        'agent',
        '-p',
        '--output-format',
        'json',
        '--trust',
        '--sandbox',
        'disabled',
        '--force',
        '--workspace',
        'D:\\coding\\open-im',
        '--',
        'hello',
      ],
      expect.objectContaining({ cwd: 'D:\\coding\\open-im' }),
    );
  });

  it('uses cmd.exe for cursor.cmd and still prepends the agent subcommand', () => {
    vi.stubGlobal('process', {
      ...process,
      platform: 'win32',
      env: process.env,
    });

    runCursor(
      'D:\\Program Files\\cursor\\resources\\app\\bin\\cursor.cmd',
      'hello',
      undefined,
      'D:\\coding\\open-im',
      {
        onText: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
    );

    expect(spawnMock).toHaveBeenCalledWith(
      'cmd.exe',
      [
        '/c',
        'D:\\Program Files\\cursor\\resources\\app\\bin\\cursor.cmd',
        'agent',
        '-p',
        '--output-format',
        'json',
        '--trust',
        '--sandbox',
        'disabled',
        '--force',
        '--workspace',
        'D:\\coding\\open-im',
        '--',
        'hello',
      ],
      expect.objectContaining({ cwd: 'D:\\coding\\open-im', windowsHide: true }),
    );
  });

  it('does not duplicate the agent subcommand for legacy agent executables', () => {
    runCursor(
      'agent',
      'hello',
      undefined,
      'D:\\coding\\open-im',
      {
        onText: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
    );

    expect(spawnMock).toHaveBeenCalledWith(
      'agent',
      [
        '-p',
        '--output-format',
        'json',
        '--trust',
        '--sandbox',
        'disabled',
        '--force',
        '--workspace',
        'D:\\coding\\open-im',
        '--',
        'hello',
      ],
      expect.any(Object),
    );
  });
});
