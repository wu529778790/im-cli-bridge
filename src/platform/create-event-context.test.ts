import { describe, it, expect, vi } from 'vitest';

vi.mock('../access/access-control.js');
vi.mock('../commands/handler.js');

import { createPlatformEventContext } from './create-event-context.js';
import { AccessControl } from '../access/access-control.js';
import { CommandHandler } from '../commands/handler.js';
import type { Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import type { TaskRunState } from '../shared/ai-task.js';

// Setup mocks for AccessControl
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mocked(AccessControl).mockImplementation(function(this: any, ids: string[]) {
  this.isAllowed = (userId: string) => ids.length === 0 || ids.includes(userId);
});

// Setup mocks for CommandHandler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mocked(CommandHandler).mockImplementation(function(this: any, deps: unknown) {
  this.dispatch = vi.fn();
  this.deps = deps;
});

function makeConfig(): Config {
  return { aiCommand: 'claude' } as unknown as Config;
}

function makeSessionManager(): SessionManager {
  return {
    getWorkDir: vi.fn(() => '/tmp'),
    getConvId: vi.fn(),
    newSession: vi.fn(),
  } as unknown as SessionManager;
}

function makeSender() {
  return {
    sendTextReply: vi.fn(async () => {}),
  };
}

describe('createPlatformEventContext', () => {
  it('creates all 4 objects', () => {
    const ctx = createPlatformEventContext({
      platform: 'telegram',
      allowedUserIds: ['123'],
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender: makeSender(),
    });

    // accessControl is created via AccessControl constructor
    expect(vi.mocked(AccessControl)).toHaveBeenCalledWith(['123']);
    expect(ctx.accessControl).toBeDefined();
    expect(ctx.accessControl.isAllowed).toBeInstanceOf(Function);

    // requestQueue is a RequestQueue instance
    expect(ctx.requestQueue).toBeDefined();
    expect(typeof ctx.requestQueue.enqueue).toBe('function');

    // runningTasks is an empty Map
    expect(ctx.runningTasks).toBeDefined();
    expect(ctx.runningTasks).toBeInstanceOf(Map);
    expect(ctx.runningTasks.size).toBe(0);

    // commandHandler is created via CommandHandler constructor
    expect(vi.mocked(CommandHandler)).toHaveBeenCalled();
    expect(ctx.commandHandler).toBeDefined();
    expect(ctx.commandHandler.dispatch).toBeInstanceOf(Function);
  });

  it('passes getRunningTasksSize that returns correct count after adding a task', () => {
    const ctx = createPlatformEventContext({
      platform: 'qq',
      allowedUserIds: [],
      config: makeConfig(),
      sessionManager: makeSessionManager(),
      sender: makeSender(),
    });

    // The CommandHandler was constructed with a getRunningTasksSize function.
    // We can verify it by reading the deps that were passed to the mock.
    // Get the most recent mock call result
    const results = vi.mocked(CommandHandler).mock.results;
    const handlerMock = results[results.length - 1].value as { deps: { getRunningTasksSize: () => number } };
    const getRunningTasksSize = handlerMock.deps.getRunningTasksSize as () => number;

    // Initially 0
    expect(getRunningTasksSize()).toBe(0);

    // Add a task to runningTasks
    const fakeState: TaskRunState = {
      handle: { abort: vi.fn() },
      latestContent: 'test',
      settle: vi.fn(),
      startedAt: Date.now(),
      toolId: 'claude',
    };
    ctx.runningTasks.set('user1:msg1', fakeState);
    expect(getRunningTasksSize()).toBe(1);

    // Add another
    ctx.runningTasks.set('user2:msg2', fakeState);
    expect(getRunningTasksSize()).toBe(2);

    // Delete one
    ctx.runningTasks.delete('user1:msg1');
    expect(getRunningTasksSize()).toBe(1);
  });
});
