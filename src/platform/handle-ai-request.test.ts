import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../config.js', () => ({
  resolvePlatformAiCommand: vi.fn(() => 'claude'),
}));

vi.mock('../adapters/registry.js', () => ({
  getAdapter: vi.fn(),
}));

vi.mock('../shared/ai-task.js', () => ({
  runAITask: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { createPlatformAIRequestHandler } from './handle-ai-request.js';
import { resolvePlatformAiCommand } from '../config.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask } from '../shared/ai-task.js';
import type { TaskRunState } from '../shared/ai-task.js';
import type { Config } from '../config.js';

function makeConfig(): Config {
  return { aiCommand: 'claude' } as unknown as Config;
}

function makeSessionManager() {
  return {
    getSessionIdForConv: vi.fn(() => 'session-123'),
    getWorkDir: vi.fn(() => '/tmp'),
    getConvId: vi.fn(() => 'conv-1'),
  } as unknown as import('../session/session-manager.js').SessionManager;
}

function makeSender() {
  return {
    sendThinkingMessage: vi.fn(async () => 'msg-001'),
    sendTextReply: vi.fn(async () => {}),
    startTyping: vi.fn(() => vi.fn()),
    sendImage: vi.fn(async () => {}),
  };
}

describe('createPlatformAIRequestHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a function', () => {
    const handler = createPlatformAIRequestHandler({
      platform: 'telegram',
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender: makeSender(),
      throttleMs: 1000,
      runningTasks: new Map(),
    });
    expect(typeof handler).toBe('function');
  });

  it('sends thinking message and uses msgId for default taskKey', async () => {
    const sender = makeSender();
    const adapter = { toolId: 'claude', run: vi.fn() };
    vi.mocked(getAdapter).mockReturnValue(adapter as never);
    vi.mocked(runAITask).mockResolvedValue(undefined);

    const runningTasks = new Map<string, TaskRunState>();
    const handler = createPlatformAIRequestHandler({
      platform: 'telegram',
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender,
      throttleMs: 1000,
      runningTasks,
    });

    await handler({
      userId: 'user-1',
      chatId: 'chat-1',
      prompt: 'hello',
      workDir: '/tmp',
      convId: 'conv-1',
    });

    // Thinking message sent
    expect(sender.sendThinkingMessage).toHaveBeenCalledWith('chat-1', undefined, 'claude');

    // startTyping called
    expect(sender.startTyping).toHaveBeenCalledWith('chat-1');

    // runAITask called with correct taskKey
    expect(runAITask).toHaveBeenCalledTimes(1);
    const runCall = vi.mocked(runAITask).mock.calls[0];
    const taskCtx = runCall[1];
    expect(taskCtx.taskKey).toBe('user-1:msg-001');
  });

  it('sends error reply when adapter is null', async () => {
    const sender = makeSender();
    vi.mocked(getAdapter).mockReturnValue(undefined);

    const handler = createPlatformAIRequestHandler({
      platform: 'qq',
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender,
      throttleMs: 1200,
      runningTasks: new Map(),
    });

    await handler({
      userId: 'user-1',
      chatId: 'chat-1',
      prompt: 'hello',
      workDir: '/tmp',
    });

    expect(sender.sendTextReply).toHaveBeenCalledWith('chat-1', expect.stringContaining('未配置 AI 工具'));
    // runAITask should NOT be called
    expect(runAITask).not.toHaveBeenCalled();
  });

  it('sends fallback text reply when thinking message fails', async () => {
    const sender = makeSender();
    sender.sendThinkingMessage = vi.fn(async () => {
      throw new Error('network error');
    });
    vi.mocked(getAdapter).mockReturnValue({ toolId: 'claude' } as never);

    const handler = createPlatformAIRequestHandler({
      platform: 'dingtalk',
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender,
      throttleMs: 1000,
      runningTasks: new Map(),
    });

    await handler({
      userId: 'user-1',
      chatId: 'chat-1',
      prompt: 'hello',
      workDir: '/tmp',
    });

    // Fallback error reply sent
    expect(sender.sendTextReply).toHaveBeenCalledWith('chat-1', expect.stringContaining('启动 AI 处理失败'));
    // runAITask should NOT be called
    expect(runAITask).not.toHaveBeenCalled();
  });

  it('uses custom taskKeyBuilder when provided', async () => {
    const sender = makeSender();
    vi.mocked(getAdapter).mockReturnValue({ toolId: 'claude' } as never);
    vi.mocked(runAITask).mockResolvedValue(undefined);

    const handler = createPlatformAIRequestHandler({
      platform: 'feishu',
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender,
      throttleMs: 80,
      runningTasks: new Map(),
      taskKeyBuilder: (userId, msgId) => `${userId}:card-${msgId}`,
    });

    await handler({
      userId: 'user-1',
      chatId: 'chat-1',
      prompt: 'hello',
      workDir: '/tmp',
    });

    const runCall = vi.mocked(runAITask).mock.calls[0];
    expect(runCall[1].taskKey).toBe('user-1:card-msg-001');
  });

  it('registers task in runningTasks via onTaskReady and cleans up', async () => {
    const sender = makeSender();
    vi.mocked(getAdapter).mockReturnValue({ toolId: 'claude' } as never);

    const fakeState: TaskRunState = {
      handle: { abort: vi.fn() },
      latestContent: 'test',
      settle: vi.fn(),
      startedAt: Date.now(),
      toolId: 'claude',
    };

    vi.mocked(runAITask).mockImplementation(async (_deps, _ctx, _prompt, _adapter, callbacks) => {
      callbacks.onTaskReady(fakeState);
      callbacks.extraCleanup?.();
    });

    const runningTasks = new Map<string, TaskRunState>();
    const handler = createPlatformAIRequestHandler({
      platform: 'wework',
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender,
      throttleMs: 500,
      runningTasks,
    });

    await handler({
      userId: 'user-1',
      chatId: 'chat-1',
      prompt: 'hello',
      workDir: '/tmp',
    });

    // Task was registered and then cleaned up (deleted from map)
    expect(runningTasks.has('user-1:msg-001')).toBe(false);
  });

  it('calls extraCleanup from taskCallbacks', async () => {
    const sender = makeSender();
    const stopTyping = vi.fn();
    sender.startTyping = vi.fn(() => stopTyping);
    vi.mocked(getAdapter).mockReturnValue({ toolId: 'claude' } as never);

    const platformCleanup = vi.fn();

    vi.mocked(runAITask).mockImplementation(async (_deps, _ctx, _prompt, _adapter, callbacks) => {
      callbacks.extraCleanup?.();
    });

    const handler = createPlatformAIRequestHandler({
      platform: 'qq',
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender,
      throttleMs: 1200,
      runningTasks: new Map(),
      taskCallbacks: {
        throttleMs: 1200,
        extraCleanup: platformCleanup,
        streamUpdate: vi.fn(),
        sendComplete: vi.fn(),
        sendError: vi.fn(),
      },
    });

    await handler({
      userId: 'user-1',
      chatId: 'chat-1',
      prompt: 'hello',
      workDir: '/tmp',
    });

    // Platform extraCleanup called
    expect(platformCleanup).toHaveBeenCalledTimes(1);
    // stopTyping also called (from the factory's built-in cleanup)
    expect(stopTyping).toHaveBeenCalledTimes(1);
  });

  it('calls extraInit and its cleanup function', async () => {
    const sender = makeSender();
    vi.mocked(getAdapter).mockReturnValue({ toolId: 'claude' } as never);

    const initCleanup = vi.fn();
    const extraInit = vi.fn(() => initCleanup);

    vi.mocked(runAITask).mockImplementation(async (_deps, _ctx, _prompt, _adapter, callbacks) => {
      callbacks.extraCleanup?.();
    });

    const handler = createPlatformAIRequestHandler({
      platform: 'telegram',
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender,
      throttleMs: 1000,
      runningTasks: new Map(),
      extraInit,
    });

    await handler({
      userId: 'user-1',
      chatId: 'chat-1',
      prompt: 'hello',
      workDir: '/tmp',
    });

    // extraInit was called with the right context
    expect(extraInit).toHaveBeenCalledWith({
      chatId: 'chat-1',
      msgId: 'msg-001',
      taskKey: 'user-1:msg-001',
    });

    // initCleanup called during extraCleanup
    expect(initCleanup).toHaveBeenCalledTimes(1);
  });

  it('passes minContentDeltaChars to runAITask callbacks', async () => {
    const sender = makeSender();
    vi.mocked(getAdapter).mockReturnValue({ toolId: 'claude' } as never);
    vi.mocked(runAITask).mockResolvedValue(undefined);

    const handler = createPlatformAIRequestHandler({
      platform: 'qq',
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender,
      throttleMs: 1200,
      runningTasks: new Map(),
      minContentDeltaChars: 80,
    });

    await handler({
      userId: 'user-1',
      chatId: 'chat-1',
      prompt: 'hello',
      workDir: '/tmp',
    });

    const runCall = vi.mocked(runAITask).mock.calls[0];
    const callbacks = runCall[4] as { minContentDeltaChars?: number };
    expect(callbacks.minContentDeltaChars).toBe(80);
  });

  it('passes onThinkingToText callback when provided', async () => {
    const sender = makeSender();
    vi.mocked(getAdapter).mockReturnValue({ toolId: 'claude' } as never);
    vi.mocked(runAITask).mockResolvedValue(undefined);

    const onThinkingToText = vi.fn();

    const handler = createPlatformAIRequestHandler({
      platform: 'feishu',
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender,
      throttleMs: 80,
      runningTasks: new Map(),
      onThinkingToText,
    });

    await handler({
      userId: 'user-1',
      chatId: 'chat-1',
      prompt: 'hello',
      workDir: '/tmp',
    });

    const runCall = vi.mocked(runAITask).mock.calls[0];
    const callbacks = runCall[4] as { onThinkingToText?: (content: string) => void };
    expect(callbacks.onThinkingToText).toBe(onThinkingToText);
  });

  it('passes sendImage callback when sender.sendImage is provided', async () => {
    const sender = makeSender();
    vi.mocked(getAdapter).mockReturnValue({ toolId: 'claude' } as never);
    vi.mocked(runAITask).mockResolvedValue(undefined);

    const handler = createPlatformAIRequestHandler({
      platform: 'telegram',
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender,
      throttleMs: 1000,
      runningTasks: new Map(),
    });

    await handler({
      userId: 'user-1',
      chatId: 'chat-1',
      prompt: 'hello',
      workDir: '/tmp',
    });

    const runCall = vi.mocked(runAITask).mock.calls[0];
    const callbacks = runCall[4] as { sendImage?: (path: string) => Promise<void> };
    expect(callbacks.sendImage).toBeDefined();
  });

  it('cleans up on runAITask synchronous throw', async () => {
    const sender = makeSender();
    const stopTyping = vi.fn();
    sender.startTyping = vi.fn(() => stopTyping);
    vi.mocked(getAdapter).mockReturnValue({ toolId: 'claude' } as never);
    vi.mocked(runAITask).mockImplementation(() => {
      throw new Error('sync failure');
    });

    const runningTasks = new Map<string, TaskRunState>();
    const handler = createPlatformAIRequestHandler({
      platform: 'telegram',
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender,
      throttleMs: 1000,
      runningTasks,
    });

    // Should not throw; the factory catches and logs
    await handler({
      userId: 'user-1',
      chatId: 'chat-1',
      prompt: 'hello',
      workDir: '/tmp',
    });

    // stopTyping called during cleanup
    expect(stopTyping).toHaveBeenCalledTimes(1);
  });
});
