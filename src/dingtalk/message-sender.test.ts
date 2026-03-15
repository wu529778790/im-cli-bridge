import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendTextMock = vi.fn();
const sendProactiveTextMock = vi.fn();
const prepareStreamingCardMock = vi.fn();
const updateStreamingCardMock = vi.fn();
const finishStreamingCardMock = vi.fn();

vi.mock('./client.js', () => ({
  sendText: sendTextMock,
  sendProactiveText: sendProactiveTextMock,
  prepareStreamingCard: prepareStreamingCardMock,
  updateStreamingCard: updateStreamingCardMock,
  finishStreamingCard: finishStreamingCardMock,
}));

describe('DingTalk message sender', () => {
  beforeEach(() => {
    vi.resetModules();
    sendTextMock.mockReset();
    sendProactiveTextMock.mockReset();
    prepareStreamingCardMock.mockReset();
    updateStreamingCardMock.mockReset();
    finishStreamingCardMock.mockReset();
  });

  it('uses AI card streaming when template is configured', async () => {
    prepareStreamingCardMock.mockResolvedValue('ctx-1');

    const sender = await import('./message-sender.js');
    sender.configureDingTalkMessageSender({ cardTemplateId: 'tpl-1' });

    const messageId = await sender.sendThinkingMessage('cid-1', undefined, 'codex', {
      chatId: 'cid-1',
      conversationType: '0',
      senderStaffId: 'staff-1',
      senderId: 'sender-1',
    });
    await sender.updateMessage('cid-1', messageId, '处理中', 'streaming', '执行中', 'codex');
    await sender.sendFinalMessages('cid-1', messageId, '最终结果', '耗时 1s', 'codex');

    expect(prepareStreamingCardMock).toHaveBeenCalledTimes(1);
    expect(prepareStreamingCardMock).toHaveBeenCalledWith(
      {
        chatId: 'cid-1',
        conversationType: '0',
        senderStaffId: 'staff-1',
        senderId: 'sender-1',
      },
      'tpl-1',
      expect.objectContaining({
        status: 'thinking',
        flowStatus: 1,
        toolName: 'Codex',
      }),
    );
    expect(updateStreamingCardMock).toHaveBeenCalledTimes(2);
    expect(updateStreamingCardMock).toHaveBeenNthCalledWith(
      1,
      'ctx-1',
      'tpl-1',
      expect.objectContaining({
        content: '处理中',
        note: '执行中',
        status: 'streaming',
        flowStatus: 2,
      }),
    );
    expect(updateStreamingCardMock).toHaveBeenNthCalledWith(
      2,
      'ctx-1',
      'tpl-1',
      expect.objectContaining({
        content: '最终结果',
        note: '耗时 1s',
        status: 'done',
        flowStatus: 3,
      }),
    );
    expect(finishStreamingCardMock).toHaveBeenCalledWith('ctx-1');
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('falls back to plain text when no card template is configured', async () => {
    const sender = await import('./message-sender.js');
    sender.configureDingTalkMessageSender({ cardTemplateId: '' });

    const messageId = await sender.sendThinkingMessage('cid-2', undefined, 'claude');
    await sender.sendFinalMessages('cid-2', messageId, '普通文本结果', '完成', 'claude');

    expect(prepareStreamingCardMock).not.toHaveBeenCalled();
    expect(updateStreamingCardMock).not.toHaveBeenCalled();
    expect(finishStreamingCardMock).not.toHaveBeenCalled();
    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(sendTextMock.mock.calls[0][1]).toContain('普通文本结果');
  });

  it('falls back to plain text when prepare fails', async () => {
    prepareStreamingCardMock.mockRejectedValue(new Error('prepare failed'));

    const sender = await import('./message-sender.js');
    sender.configureDingTalkMessageSender({ cardTemplateId: 'tpl-2' });

    const messageId = await sender.sendThinkingMessage('cid-3', undefined, 'claude');
    await sender.sendFinalMessages('cid-3', messageId, '降级结果', '完成', 'claude');

    expect(prepareStreamingCardMock).toHaveBeenCalledTimes(1);
    expect(updateStreamingCardMock).not.toHaveBeenCalled();
    expect(finishStreamingCardMock).not.toHaveBeenCalled();
    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(sendTextMock.mock.calls[0][1]).toContain('降级结果');
  });

  it('updates card to error state and finishes it on failure', async () => {
    prepareStreamingCardMock.mockResolvedValue('ctx-error');

    const sender = await import('./message-sender.js');
    sender.configureDingTalkMessageSender({ cardTemplateId: 'tpl-error' });

    const messageId = await sender.sendThinkingMessage('cid-4', undefined, 'codex');
    await sender.sendErrorMessage('cid-4', messageId, '爆了', 'codex');

    expect(updateStreamingCardMock).toHaveBeenCalledWith(
      'ctx-error',
      'tpl-error',
      expect.objectContaining({
        content: '错误：爆了',
        note: '执行失败',
        status: 'error',
        flowStatus: 5,
        toolName: 'Codex',
      }),
    );
    expect(finishStreamingCardMock).toHaveBeenCalledWith('ctx-error');
  });

  it('does not duplicate plain text when final card update succeeds but finish fails', async () => {
    prepareStreamingCardMock.mockResolvedValue('ctx-finish');
    finishStreamingCardMock.mockRejectedValue(new Error('finish failed'));

    const sender = await import('./message-sender.js');
    sender.configureDingTalkMessageSender({ cardTemplateId: 'tpl-finish' });

    const messageId = await sender.sendThinkingMessage('cid-5', undefined, 'claude');
    await sender.sendFinalMessages('cid-5', messageId, '最终结果', '完成', 'claude');

    expect(updateStreamingCardMock).toHaveBeenCalledWith(
      'ctx-finish',
      'tpl-finish',
      expect.objectContaining({
        content: '最终结果',
        status: 'done',
      }),
    );
    expect(finishStreamingCardMock).toHaveBeenCalledWith('ctx-finish');
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('passes single chat metadata to prepare call', async () => {
    prepareStreamingCardMock.mockResolvedValue('ctx-meta');

    const sender = await import('./message-sender.js');
    sender.configureDingTalkMessageSender({ cardTemplateId: 'tpl-meta' });

    await sender.sendThinkingMessage('cid-meta', undefined, 'claude', {
      chatId: 'cid-meta',
      conversationType: '0',
      senderStaffId: '015038621332843498',
      senderId: '$:LWCP_v1:$abc',
    });

    expect(prepareStreamingCardMock).toHaveBeenCalledWith(
      {
        chatId: 'cid-meta',
        conversationType: '0',
        senderStaffId: '015038621332843498',
        senderId: '$:LWCP_v1:$abc',
      },
      'tpl-meta',
      expect.any(Object),
    );
  });

  it('routes image replies through the fallback text sender', async () => {
    const sender = await import('./message-sender.js');

    await sender.sendImageReply('cid-image', 'C:\\images\\out.png');

    expect(sendTextMock).toHaveBeenCalledWith(
      'cid-image',
      expect.stringContaining('C:\\images\\out.png'),
    );
  });
});
