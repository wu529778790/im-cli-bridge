import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendTextMock = vi.fn();
const sendStreamMock = vi.fn();
const sendStreamWithItemsMock = vi.fn();
const sendProactiveMessageMock = vi.fn();

vi.mock('./client.js', () => ({
  sendText: sendTextMock,
  sendStream: sendStreamMock,
  sendStreamWithItems: sendStreamWithItemsMock,
  sendProactiveMessage: sendProactiveMessageMock,
}));

describe('WeWork message sender', () => {
  beforeEach(() => {
    vi.resetModules();
    sendTextMock.mockReset();
    sendStreamMock.mockReset();
    sendStreamWithItemsMock.mockReset();
    sendProactiveMessageMock.mockReset();
  });

  it('formats bash notes as a code block in streaming updates', async () => {
    const sender = await import('./message-sender.js');

    await sender.updateMessage(
      'chat-1',
      'stream-1',
      '正文',
      'streaming',
      '输出中...\n🔧 Bash → "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"',
      'codex',
      'req-1',
    );

    expect(sendStreamMock).toHaveBeenCalledTimes(1);
    expect(sendStreamMock).toHaveBeenCalledWith(
      'req-1',
      'stream-1',
      expect.stringContaining('🔧 Bash\n```'),
      false,
    );
    expect(sendStreamMock.mock.calls[0][2]).toContain(
      '"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"',
    );
  });
});
