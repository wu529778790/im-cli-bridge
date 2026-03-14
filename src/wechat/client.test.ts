import { describe, expect, it, vi } from 'vitest';
import { dispatchIncomingAGPEnvelope } from './client.js';

describe('dispatchIncomingAGPEnvelope', () => {
  it('forwards prompt envelopes to the registered handler', async () => {
    const handler = vi.fn(async () => {});
    const envelope = {
      msg_id: 'msg-1',
      method: 'session.prompt' as const,
      payload: {
        session_id: 'session-1',
        content: 'hello',
      },
    };

    await dispatchIncomingAGPEnvelope(envelope, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(envelope);
  });

  it('forwards cancel envelopes to the registered handler', async () => {
    const handler = vi.fn(async () => {});
    const envelope = {
      msg_id: 'msg-2',
      method: 'session.cancel' as const,
      payload: {
        session_id: 'session-1',
      },
    };

    await dispatchIncomingAGPEnvelope(envelope, handler);

    expect(handler).toHaveBeenCalledWith(envelope);
  });
});
