import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../shared/active-chats.js', () => ({
  setActiveChatId: vi.fn(),
}));

vi.mock('../shared/chat-user-map.js', () => ({
  setChatUser: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { handleTextFlow, type HandleTextFlowParams } from './handle-text-flow.js';
import { setActiveChatId } from '../shared/active-chats.js';
import { setChatUser } from '../shared/chat-user-map.js';
import type { PlatformEventContext } from './create-event-context.js';
import { AccessControl } from '../access/access-control.js';

function makeAccessControl(allowed: boolean): AccessControl {
  return { isAllowed: vi.fn(() => allowed) } as unknown as AccessControl;
}

function makeCtx(overrides?: Partial<PlatformEventContext>): PlatformEventContext {
  return {
    accessControl: makeAccessControl(true),
    requestQueue: {
      enqueue: vi.fn(() => 'running' as const),
      clear: vi.fn(),
    } as unknown as PlatformEventContext['requestQueue'],
    runningTasks: new Map(),
    commandHandler: {
      dispatch: vi.fn(async () => false),
    } as unknown as PlatformEventContext['commandHandler'],
    ...overrides,
  };
}

function makeParams(overrides?: Partial<HandleTextFlowParams>): HandleTextFlowParams {
  return {
    platform: 'telegram',
    userId: 'user-1',
    chatId: 'chat-1',
    text: 'hello world',
    ctx: makeCtx(),
    handleAIRequest: vi.fn(async () => {}),
    sendTextReply: vi.fn(async () => {}),
    workDir: '/tmp',
    convId: 'conv-1',
    ...overrides,
  };
}

describe('handleTextFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends error message when access is denied', async () => {
    const sendTextReply = vi.fn(async () => {});
    const ctx = makeCtx({
      accessControl: makeAccessControl(false),
    });

    const result = await handleTextFlow(makeParams({
      sendTextReply,
      ctx,
      userId: 'denied-user',
    }));

    // Returns false to indicate access denied
    expect(result).toBe(false);

    // Sends access-denied message
    expect(sendTextReply).toHaveBeenCalledWith('chat-1', expect.stringContaining('denied-user'));

    // Does NOT set active chat or user
    expect(setActiveChatId).not.toHaveBeenCalled();
    expect(setChatUser).not.toHaveBeenCalled();
  });

  it('returns early when command is handled', async () => {
    const sendTextReply = vi.fn(async () => {});
    const dispatch = vi.fn(async () => true);
    const ctx = makeCtx({
      commandHandler: { dispatch } as unknown as PlatformEventContext['commandHandler'],
    });

    const result = await handleTextFlow(makeParams({
      sendTextReply,
      ctx,
      text: '/help',
    }));

    // Returns true
    expect(result).toBe(true);

    // setActiveChatId and setChatUser were called before command dispatch
    expect(setActiveChatId).toHaveBeenCalledWith('telegram', 'chat-1');
    expect(setChatUser).toHaveBeenCalledWith('chat-1', 'user-1', 'telegram');

    // Command dispatch was called with correct args
    expect(dispatch).toHaveBeenCalledWith(
      '/help',
      'chat-1',
      'user-1',
      'telegram',
      expect.any(Function),
    );

    // Does NOT enqueue (sendTextReply not called for queue messages)
    expect(sendTextReply).not.toHaveBeenCalled();
  });

  it('sends rejection message when queue is full', async () => {
    const sendTextReply = vi.fn(async () => {});
    const enqueue = vi.fn(() => 'rejected' as const);
    const ctx = makeCtx({
      requestQueue: { enqueue, clear: vi.fn() } as unknown as PlatformEventContext['requestQueue'],
    });

    const result = await handleTextFlow(makeParams({
      sendTextReply,
      ctx,
    }));

    expect(result).toBe(true);
    expect(enqueue).toHaveBeenCalled();
    expect(sendTextReply).toHaveBeenCalledWith('chat-1', expect.stringContaining('队列已满'));
  });

  it('sends queued message when request is queued', async () => {
    const sendTextReply = vi.fn(async () => {});
    const enqueue = vi.fn(() => 'queued' as const);
    const ctx = makeCtx({
      requestQueue: { enqueue, clear: vi.fn() } as unknown as PlatformEventContext['requestQueue'],
    });

    const result = await handleTextFlow(makeParams({
      sendTextReply,
      ctx,
    }));

    expect(result).toBe(true);
    expect(enqueue).toHaveBeenCalled();
    expect(sendTextReply).toHaveBeenCalledWith('chat-1', expect.stringContaining('排队等待'));
  });

  it('calls handleAIRequest on successful enqueue', async () => {
    const handleAIRequest = vi.fn(async () => {});
    const enqueue = vi.fn((_userId, _convId, _prompt, execute: (prompt: string) => Promise<void>) => {
      // Simulate immediate execution
      execute('hello world');
      return 'running' as const;
    });
    const ctx = makeCtx({
      requestQueue: { enqueue, clear: vi.fn() } as unknown as PlatformEventContext['requestQueue'],
    });

    const result = await handleTextFlow(makeParams({
      handleAIRequest,
      ctx,
      workDir: '/workspace',
      convId: 'conv-42',
      replyToMessageId: 'msg-99',
    }));

    expect(result).toBe(true);

    // handleAIRequest was called with the correct params
    expect(handleAIRequest).toHaveBeenCalledWith(
      'user-1',
      'chat-1',
      'hello world',
      '/workspace',
      'conv-42',
      undefined,
      'msg-99',
    );
  });

  it('returns true without enqueuing when text is empty', async () => {
    const sendTextReply = vi.fn(async () => {});
    const enqueue = vi.fn(() => 'running' as const);
    const ctx = makeCtx({
      requestQueue: { enqueue, clear: vi.fn() } as unknown as PlatformEventContext['requestQueue'],
    });

    const result = await handleTextFlow(makeParams({
      sendTextReply,
      ctx,
      text: '',
    }));

    expect(result).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(sendTextReply).not.toHaveBeenCalled();
  });

  it('uses custom access-denied message', async () => {
    const sendTextReply = vi.fn(async () => {});
    const ctx = makeCtx({
      accessControl: makeAccessControl(false),
    });

    await handleTextFlow(makeParams({
      sendTextReply,
      ctx,
      accessDeniedMessage: (userId) => `Custom deny: ${userId}`,
    }));

    expect(sendTextReply).toHaveBeenCalledWith('chat-1', 'Custom deny: user-1');
  });

  it('uses custom queue messages', async () => {
    const sendTextReply = vi.fn(async () => {});

    // Test custom queue-full message
    const enqueueRejected = vi.fn(() => 'rejected' as const);
    const ctxRejected = makeCtx({
      requestQueue: { enqueue: enqueueRejected, clear: vi.fn() } as unknown as PlatformEventContext['requestQueue'],
    });

    await handleTextFlow(makeParams({
      sendTextReply,
      ctx: ctxRejected,
      queueFullMessage: 'Custom full',
    }));
    expect(sendTextReply).toHaveBeenCalledWith('chat-1', 'Custom full');

    vi.clearAllMocks();

    // Test custom queued message
    const enqueueQueued = vi.fn(() => 'queued' as const);
    const ctxQueued = makeCtx({
      requestQueue: { enqueue: enqueueQueued, clear: vi.fn() } as unknown as PlatformEventContext['requestQueue'],
    });

    await handleTextFlow(makeParams({
      sendTextReply,
      ctx: ctxQueued,
      queuedMessage: 'Custom queued',
    }));
    expect(sendTextReply).toHaveBeenCalledWith('chat-1', 'Custom queued');
  });

  it('uses custom enqueue when provided', async () => {
    const sendTextReply = vi.fn(async () => {});
    const customEnqueue = vi.fn(async () => 'rejected' as const);
    const ctx = makeCtx();

    const result = await handleTextFlow(makeParams({
      sendTextReply,
      ctx,
      customEnqueue,
    }));

    expect(result).toBe(true);
    expect(customEnqueue).toHaveBeenCalledWith('hello world');
    // Standard requestQueue.enqueue should NOT be called
    expect(ctx.requestQueue.enqueue).not.toHaveBeenCalled();
    // Queue-full message sent
    expect(sendTextReply).toHaveBeenCalledWith('chat-1', expect.stringContaining('队列已满'));
  });

  it('continues on commandHandler.dispatch error', async () => {
    const sendTextReply = vi.fn(async () => {});
    const dispatch = vi.fn(async () => {
      throw new Error('dispatch error');
    });
    const enqueue = vi.fn(() => 'running' as const);
    const ctx = makeCtx({
      commandHandler: { dispatch } as unknown as PlatformEventContext['commandHandler'],
      requestQueue: { enqueue, clear: vi.fn() } as unknown as PlatformEventContext['requestQueue'],
    });

    const result = await handleTextFlow(makeParams({
      sendTextReply,
      ctx,
    }));

    // Should still proceed to enqueue
    expect(result).toBe(true);
    expect(enqueue).toHaveBeenCalled();
  });
});
