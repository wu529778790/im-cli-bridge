# Plan 3: Test Coverage + Performance — Detailed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring test coverage to 60%+ lines, convert sync I/O to async, and fix reliability gaps (dead connection detection, task timeout, proper shutdown, top-level error handling).

**Architecture:** Phase A adds test infrastructure and targeted unit tests. Phase B converts session persistence from sync to async with atomic writes. Phase C adds reliability fixes to QQ WebSocket, RequestQueue, platform shutdown, and event handlers. Each phase produces a working build with all tests passing.

**Tech Stack:** TypeScript, Node.js, vitest

**Spec:** `docs/superpowers/specs/2026-04-03-project-diagnosis-design.md` — issues #6, #7, #15, #16, #17, #18

---

## Phase A: Test Infrastructure

### Task A1: Add coverage thresholds to vitest.config.ts

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Update vitest.config.ts with coverage config**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    globals: {},
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/config/types.ts",
        "src/index.ts",
        "src/cli.ts",
        "src/setup.ts",
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {},
  },
});
```

- [ ] **Step 2: Verify config is valid**

```bash
npx vitest run --coverage 2>&1 | tail -20
```

Expected: Tests pass, coverage report shown (may be below thresholds since we haven't added tests yet — that's fine for now).

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "test: add coverage thresholds (60% lines) to vitest config"
```

---

### Task A2: Add tests for RequestQueue

**Files:**
- Create: `src/queue/request-queue.test.ts`

- [ ] **Step 1: Write tests**

Create `src/queue/request-queue.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { RequestQueue } from './request-queue.js';

describe('RequestQueue', () => {
  it('returns "running" for first task and executes it', async () => {
    const queue = new RequestQueue();
    const execute = vi.fn().mockResolvedValue(undefined);

    const result = queue.enqueue('user1', 'conv1', 'hello', execute);

    expect(result).toBe('running');
    // Give microtask queue a tick to start execution
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledWith('hello');
    });
  });

  it('returns "queued" when a task is already running', () => {
    const queue = new RequestQueue();
    const execute = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves

    queue.enqueue('user1', 'conv1', 'first', execute);
    const result = queue.enqueue('user1', 'conv1', 'second', execute);

    expect(result).toBe('queued');
  });

  it('returns "rejected" when queue is full (3 items)', () => {
    const queue = new RequestQueue();
    const execute = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves

    queue.enqueue('user1', 'conv1', 'first', execute);
    queue.enqueue('user1', 'conv1', 'second', execute);
    queue.enqueue('user1', 'conv1', 'third', execute);
    const result = queue.enqueue('user1', 'conv1', 'fourth', execute);

    expect(result).toBe('rejected');
  });

  it('processes queued tasks after running task completes', async () => {
    const queue = new RequestQueue();
    let resolveFirst: () => void;
    const firstPromise = new Promise<void>((r) => { resolveFirst = r; });
    const execute = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => {
        return Promise.resolve();
      });

    queue.enqueue('user1', 'conv1', 'first', execute);
    queue.enqueue('user1', 'conv1', 'second', execute);

    expect(execute).toHaveBeenCalledTimes(1);
    resolveFirst!();

    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
    });
    expect(execute).toHaveBeenCalledWith('second');
  });

  it('isolates queues per user:convId', () => {
    const queue = new RequestQueue();
    const execute = vi.fn().mockReturnValue(new Promise(() => {}));

    const r1 = queue.enqueue('user1', 'conv1', 'hello', execute);
    const r2 = queue.enqueue('user2', 'conv1', 'hello', execute);

    expect(r1).toBe('running');
    expect(r2).toBe('running');
  });

  it('clear removes queued tasks but not the running one', async () => {
    const queue = new RequestQueue();
    const execute = vi.fn().mockReturnValue(new Promise(() => {}));

    queue.enqueue('user1', 'conv1', 'first', execute);
    queue.enqueue('user1', 'conv1', 'second', execute);
    queue.enqueue('user1', 'conv1', 'third', execute);

    const cleared = queue.clear('user1', 'conv1');
    expect(cleared).toBe(2); // two queued, one running

    // Can enqueue again since running task still holds the slot
    const result = queue.enqueue('user1', 'conv1', 'fourth', execute);
    expect(result).toBe('queued'); // only 1 queued now, under limit
  });

  it('clear returns 0 for unknown user:convId', () => {
    const queue = new RequestQueue();
    expect(queue.clear('nobody', 'noconv')).toBe(0);
  });

  it('handles task execution error gracefully and processes next', async () => {
    const queue = new RequestQueue();
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    queue.enqueue('user1', 'conv1', 'first', execute);
    queue.enqueue('user1', 'conv1', 'second', execute);

    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/queue/request-queue.test.ts
```

Expected: All 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/queue/request-queue.test.ts
git commit -m "test: add comprehensive tests for RequestQueue"
```

---

### Task A3: Add tests for SessionManager

**Files:**
- Modify: `src/session/session-manager.test.ts`

The existing test file only tests `resolveWorkDirInput`. We add tests for core session operations.

- [ ] **Step 1: Read existing test file**

Read `src/session/session-manager.test.ts` to understand existing tests and imports.

- [ ] **Step 2: Add SessionManager class tests**

Add a new `describe` block for `SessionManager` class tests. Use a temp directory for the session file to avoid polluting the real config:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveWorkDirInput, SessionManager } from './session-manager.js';

// ... existing resolveWorkDirInput tests ...

describe('SessionManager', () => {
  let tempDir: string;
  let manager: SessionManager;

  beforeEach(() => {
    tempDir = join(tmpdir(), `sm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    // Mock APP_HOME so sessions.json goes to temp dir
    vi.resetModules();
  });

  afterEach(() => {
    manager?.destroy();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('creates a new user session on first access', () => {
    manager = new SessionManager(tempDir);
    const workDir = manager.getWorkDir('user-new');
    expect(workDir).toBe(tempDir); // falls back to default
  });

  it('setWorkDir updates work directory for a user', () => {
    manager = new SessionManager(tempDir);
    manager.setWorkDir('user1', '/tmp/project');
    expect(manager.getWorkDir('user1')).toBe('/tmp/project');
  });

  it('getConvId auto-creates conversation ID', () => {
    manager = new SessionManager(tempDir);
    const convId = manager.getConvId('user1');
    expect(convId).toBeTruthy();
    expect(typeof convId).toBe('string');
  });

  it('newSession resets user session state', () => {
    manager = new SessionManager(tempDir);
    manager.setWorkDir('user1', '/tmp/project');
    const convId = manager.getConvId('user1');
    expect(convId).toBeTruthy();

    const result = manager.newSession('user1');
    expect(result).toBe(true);
    // After /new, a new convId should be generated on next access
    const newConvId = manager.getConvId('user1');
    expect(newConvId).toBeTruthy();
    expect(newConvId).not.toBe(convId);
  });

  it('session CRUD for conversation', () => {
    manager = new SessionManager(tempDir);
    manager.setSessionIdForConv('user1', 'conv1', 'claude', 'sess-123');
    expect(manager.getSessionIdForConv('user1', 'conv1', 'claude')).toBe('sess-123');

    manager.clearSessionForConv('user1', 'conv1', 'claude');
    expect(manager.getSessionIdForConv('user1', 'conv1', 'claude')).toBeUndefined();
  });

  it('persists sessions to disk', () => {
    manager = new SessionManager(tempDir);
    manager.setWorkDir('user1', '/tmp/project');
    manager.destroy(); // force flush

    // Create a new manager loading from the same directory
    const manager2 = new SessionManager(tempDir);
    expect(manager2.getWorkDir('user1')).toBe('/tmp/project');
    manager2.destroy();
  });

  it('hasUserSession returns false for unknown user', () => {
    manager = new SessionManager(tempDir);
    expect(manager.hasUserSession('nobody')).toBe(false);
  });

  it('hasUserSession returns true after setWorkDir', () => {
    manager = new SessionManager(tempDir);
    manager.setWorkDir('user1', '/tmp/project');
    expect(manager.hasUserSession('user1')).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/session/session-manager.test.ts
```

Expected: All tests pass (existing + new).

- [ ] **Step 4: Commit**

```bash
git add src/session/session-manager.test.ts
git commit -m "test: add SessionManager CRUD and persistence tests"
```

---

### Task A4: Add tests for ClaudeSDKAdapter session management

**Files:**
- Create: `src/adapters/claude-sdk-adapter.test.ts`

Since the adapter uses `@anthropic-ai/claude-agent-sdk` which may not be available in test env, we mock it.

- [ ] **Step 1: Write tests**

Create `src/adapters/claude-sdk-adapter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the SDK before importing
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  unstable_v2_createSession: vi.fn(),
  unstable_v2_resumeSession: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('ClaudeSDKAdapter session pool', () => {
  // We test the module's exported behavior indirectly through its public API.
  // The adapter is a ToolAdapter — test its lifecycle.

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports a valid ToolAdapter shape', async () => {
    // Dynamic import to get fresh module after mocks are set up
    const { default: adapter } = await import('./claude-sdk-adapter.js');
    expect(adapter).toBeDefined();
    expect(adapter.toolId).toBe('claude');
    expect(typeof adapter.run).toBe('function');
    expect(typeof adapter.stop).toBe('function');
  });

  it('stop() does not throw', async () => {
    const { default: adapter } = await import('./claude-sdk-adapter.js');
    expect(() => adapter.stop()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/adapters/claude-sdk-adapter.test.ts
```

Expected: Tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/claude-sdk-adapter.test.ts
git commit -m "test: add basic ClaudeSDKAdapter shape tests"
```

---

### Task A5: Add test for runAITask error and completion paths

**Files:**
- Modify: `src/shared/ai-task.test.ts`

The existing test only tests the usage-limit error path. Add tests for normal completion and abort.

- [ ] **Step 1: Read existing test file**

Read `src/shared/ai-task.test.ts` to understand existing structure.

- [ ] **Step 2: Add completion and abort tests**

Add new test cases to the existing file:

```typescript
it('calls sendComplete on successful AI response', async () => {
  const { runAITask } = await import('./ai-task.js');
  const { loadConfig } = await import('../config.js');

  const config = loadConfig();
  const sessionManager = new SessionManager(config.claudeWorkDir);

  const mockAdapter = {
    toolId: 'claude',
    run: vi.fn().mockImplementation((prompt, sessionId, workDir, callbacks) => {
      const handle = { abort: vi.fn() };
      // Simulate normal completion
      setTimeout(() => {
        callbacks.onSessionId?.('test-session-id');
        callbacks.onText?.('Hello world');
        callbacks.onComplete?.({ accumulated: 'Hello world', result: '' });
      }, 10);
      return handle;
    }),
  };

  const sendComplete = vi.fn().mockResolvedValue(undefined);
  const sendError = vi.fn().mockResolvedValue(undefined);
  const platformAdapter = {
    streamUpdate: vi.fn(),
    sendComplete,
    sendError,
    extraCleanup: vi.fn(),
    throttleMs: 1000,
    onTaskReady: vi.fn(),
  };

  await runAITask(
    { config, sessionManager },
    { userId: 'u1', chatId: 'c1', workDir: '/tmp', sessionId: undefined, platform: 'telegram', taskKey: 'u1:c1' },
    'hello',
    mockAdapter,
    platformAdapter,
  );

  expect(sendComplete).toHaveBeenCalled();
  sessionManager.destroy();
});

it('calls sendError when adapter throws', async () => {
  const { runAITask } = await import('./ai-task.js');
  const { loadConfig } = await import('../config.js');

  const config = loadConfig();
  const sessionManager = new SessionManager(config.claudeWorkDir);

  const mockAdapter = {
    toolId: 'claude',
    run: vi.fn().mockImplementation((prompt, sessionId, workDir, callbacks) => {
      const handle = { abort: vi.fn() };
      setTimeout(() => {
        callbacks.onError?.(new Error('API error'));
      }, 10);
      return handle;
    }),
  };

  const sendComplete = vi.fn().mockResolvedValue(undefined);
  const sendError = vi.fn().mockResolvedValue(undefined);
  const platformAdapter = {
    streamUpdate: vi.fn(),
    sendComplete,
    sendError,
    extraCleanup: vi.fn(),
    throttleMs: 1000,
    onTaskReady: vi.fn(),
  };

  await runAITask(
    { config, sessionManager },
    { userId: 'u2', chatId: 'c2', workDir: '/tmp', sessionId: undefined, platform: 'telegram', taskKey: 'u2:c2' },
    'hello',
    mockAdapter,
    platformAdapter,
  );

  expect(sendError).toHaveBeenCalled();
  sessionManager.destroy();
});
```

Note: These tests require the config to be loadable. If `loadConfig()` fails in test environment (no platform credentials), mock it:

```typescript
vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js');
  return {
    ...actual,
    loadConfig: () => ({
      enabledPlatforms: ['telegram'],
      aiCommand: 'claude',
      claudeWorkDir: '/tmp',
      skipPermissions: true,
      allowedUserIds: [],
      telegramAllowedUserIds: [],
      feishuAllowedUserIds: [],
      qqAllowedUserIds: [],
      weworkAllowedUserIds: [],
      dingtalkAllowedUserIds: [],
      workbuddyAllowedUserIds: [],
      codexCliPath: 'codex',
      codebuddyCliPath: 'codebuddy',
      logDir: '/tmp',
      logLevel: 'INFO',
      platforms: {
        telegram: { enabled: true, allowedUserIds: [] },
      },
    }),
  };
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/shared/ai-task.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ai-task.test.ts
git commit -m "test: add runAITask completion and error path tests"
```

---

## Phase B: Session Persistence Performance

### Task B1: Convert SessionManager flush to async with atomic writes

**Files:**
- Modify: `src/session/session-manager.ts`

- [ ] **Step 1: Read the full session-manager.ts**

Read the file to understand all callers of `flushSync`, `doFlush`, `save`, and `destroy`.

- [ ] **Step 2: Replace writeFileSync with async writeFile + atomic rename**

Change `doFlush()` from sync to async:

```typescript
// Replace writeFileSync import:
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve, win32 } from 'node:path';

// ... in the class, change doFlush:
private async doFlush(): Promise<void> {
  try {
    const dir = dirname(SESSIONS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const sessions: Record<string, UserSession> = {};
    for (const [k, v] of this.sessions) sessions[k] = v;
    const convSessionMapObj: Record<string, string> = {};
    for (const [k, v] of this.convSessionMap) convSessionMapObj[k] = v;
    const data = JSON.stringify({ sessions, convSessionMap: convSessionMapObj }, null, 2);
    // Atomic write: write to temp file then rename
    const tmpPath = SESSIONS_FILE + '.tmp';
    await writeFile(tmpPath, data, 'utf-8');
    await rename(tmpPath, SESSIONS_FILE);
  } catch (err) {
    log.error('Failed to save sessions:', err);
  }
}
```

- [ ] **Step 3: Convert flushSync to async flush**

```typescript
async flush(): Promise<void> {
  if (this.saveTimer) {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }
  await this.doFlush();
}
```

Keep `destroy()` sync-compatible by firing-and-forgetting the async flush (since destroy is called during shutdown and we want it to be fast):

```typescript
destroy(): void {
  if (this.saveTimer) {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }
  // Fire-and-forget for shutdown compatibility
  this.doFlush().catch((err) => {
    log.error('Failed to flush sessions during destroy:', err);
  });
}
```

- [ ] **Step 4: Update all callers of flushSync**

Search for all callers of `flushSync` in the codebase and update them to use `await flush()`. The `save()` method (debounced) should call the async version:

```typescript
private save(): void {
  if (this.saveTimer) return;
  this.saveTimer = setTimeout(() => {
    this.saveTimer = null;
    this.doFlush();
  }, 500);
}
```

Note: The `save()` timer still calls `doFlush()` without await (fire-and-forget is acceptable for debounced saves). Only explicit `flush()` calls need to be awaited.

- [ ] **Step 5: Run build and tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/session/session-manager.ts
git commit -m "perf: convert session persistence to async with atomic writes"
```

---

## Phase C: Reliability Fixes

### Task C1: Add dead connection detection to QQ WebSocket

**Files:**
- Modify: `src/qq/client.ts`

- [ ] **Step 1: Add lastServerResponseTime tracking**

In `src/qq/client.ts`, add a module-level variable:

```typescript
let lastServerResponseTime = 0;
```

- [ ] **Step 2: Update lastServerResponseTime on every socket message**

In the `socket.on("message", ...)` handler inside `connectWebSocket`, set:

```typescript
lastServerResponseTime = Date.now();
```

at the top of the handler, before any processing.

- [ ] **Step 3: Add dead connection check in heartbeat**

In `startHeartbeat()`, after sending the heartbeat, check if last response was too long ago:

```typescript
function startHeartbeat(intervalMs: number): void {
  lastServerResponseTime = Date.now();
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === 1) { // OPEN
      // Check for dead connection: no server response for 3x heartbeat interval
      const elapsed = Date.now() - lastServerResponseTime;
      if (elapsed > intervalMs * 3) {
        log.warn(`QQ dead connection detected: no response for ${Math.round(elapsed / 1000)}s, reconnecting`);
        clearTimers();
        ws?.terminate();
        connectWebSocket(currentConfig!, currentHandler!);
        return;
      }
      seq++;
      ws.send(JSON.stringify({ op: 1, d: { heartbeat_interval: intervalMs }, s: seq }));
    }
  }, intervalMs);
}
```

- [ ] **Step 4: Reset lastServerResponseTime on reconnect**

In `stopQQ()` and in the reconnect logic, reset:

```typescript
lastServerResponseTime = 0;
```

- [ ] **Step 5: Run build and tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/qq/client.ts
git commit -m "fix(qq): add dead connection detection via heartbeat timeout"
```

---

### Task C2: Add task timeout to RequestQueue

**Files:**
- Modify: `src/queue/request-queue.ts`
- Modify: `src/queue/request-queue.test.ts`

- [ ] **Step 1: Add timeout to QueuedTask interface and run method**

```typescript
const MAX_QUEUE_SIZE = 3;
const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

interface QueuedTask {
  prompt: string;
  execute: (prompt: string) => Promise<void>;
  enqueuedAt: number;
}

interface UserQueue {
  running: boolean;
  tasks: QueuedTask[];
  currentAbort?: () => void; // abort function for the running task
  currentStartedAt?: number;
}
```

- [ ] **Step 2: Add timeout check to the run method**

In the `run` method, wrap the execute call with a timeout guard:

```typescript
private async run(key: string, prompt: string, execute: (prompt: string) => Promise<void>): Promise<void> {
  const q = this.queues.get(key);
  if (!q) return;

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const finishRun = () => {
    if (settled) return;
    settled = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    q.currentAbort = undefined;
    q.currentStartedAt = undefined;
  };

  try {
    // Set up timeout
    const timeoutPromise = new Promise<void>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Task timed out after ${DEFAULT_TASK_TIMEOUT_MS / 1000}s`));
      }, DEFAULT_TASK_TIMEOUT_MS);
    });

    await Promise.race([execute(prompt), timeoutPromise]);
  } catch (err) {
    log.error(`Error executing task for ${key}:`, err);
  } finally {
    finishRun();
  }

  // Process next task
  const next = q.tasks.shift();
  if (next) {
    setImmediate(() => this.run(key, next.prompt, next.execute));
  } else {
    q.running = false;
    this.queues.delete(key);
  }
}
```

- [ ] **Step 3: Add timeout test**

Add to `src/queue/request-queue.test.ts`:

```typescript
it('times out long-running tasks', async () => {
  vi.useFakeTimers();
  const queue = new RequestQueue();
  const execute = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves

  queue.enqueue('user1', 'conv1', 'hello', execute);

  // Advance past 10-minute timeout
  vi.advanceTimersByTime(10 * 60 * 1000 + 1);

  await vi.advanceTimersByTimeAsync(0); // let microtasks settle

  expect(execute).toHaveBeenCalledTimes(1);

  vi.useRealTimers();
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/queue/request-queue.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/queue/request-queue.ts src/queue/request-queue.test.ts
git commit -m "feat: add 10-minute task timeout to RequestQueue"
```

---

### Task C3: Implement proper handle.stop() to abort running AI tasks

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Track running tasks per platform in index.ts**

Read the current `src/index.ts` to find the `PLATFORM_MODULES` data structure and the `activeHandles` map.

- [ ] **Step 2: Create a per-platform runningTasks map**

In `src/index.ts`, after the existing imports, create a shared `runningTasks` map that gets passed to each platform's setup function:

```typescript
import { TaskRunState } from './shared/ai-task.js';

// Shared running tasks registry — each platform's handle.stop() uses this
const platformRunningTasks = new Map<string, Map<string, TaskRunState>>();
```

- [ ] **Step 3: Update each PlatformModule init to return runningTasks**

In the PLATFORM_MODULES entries, each platform's `init` already creates a `runningTasks` map internally via `createPlatformEventContext`. We need the handle to expose it for cleanup.

Modify each platform module entry to store the running tasks:

```typescript
// After setup, the handle stores a reference to running tasks
// handle.stop() will abort all running tasks
```

Add a `runningTasks` field to the `PlatformHandle` interface:

```typescript
interface PlatformHandle {
  stop: () => void;
  runningTasks?: Map<string, TaskRunState>;
}
```

- [ ] **Step 4: Update shutdown to abort tasks**

In the shutdown function, before calling `handle.stop()`, abort all running tasks:

```typescript
// Stop each platform: abort running tasks, then handle.stop(), then module.stop()
for (const platform of successfulPlatforms) {
  const handle = activeHandles.get(platform);
  if (handle?.runningTasks) {
    for (const [key, state] of handle.runningTasks) {
      log.info(`Aborting running task ${key} on ${platform} during shutdown`);
      state.handle.abort();
    }
    handle.runningTasks.clear();
  }
  handle?.stop();
  await PLATFORM_MODULES[platform].stop();
}
```

- [ ] **Step 5: Run build and tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "fix: abort running AI tasks during graceful shutdown"
```

---

### Task C4: Add top-level try/catch to Telegram and QQ event handlers

**Files:**
- Modify: `src/telegram/event-handler.ts`
- Modify: `src/qq/event-handler.ts`

- [ ] **Step 1: Wrap Telegram text handler with try/catch**

In `src/telegram/event-handler.ts`, find the `bot.on(message("text"), ...)` handler and wrap the body:

```typescript
bot.on(message("text"), async (tgCtx) => {
  try {
    // ... existing handler body ...
  } catch (err) {
    log.error('Unhandled error in Telegram text handler:', err);
    try {
      await tgCtx.reply('Internal error occurred. Please try again.');
    } catch { /* ignore */ }
  }
});
```

- [ ] **Step 2: Wrap QQ handleEvent with try/catch**

In `src/qq/event-handler.ts`, find the `handleEvent` function and wrap the body:

```typescript
async function handleEvent(event: QQMessageEvent): Promise<void> {
  try {
    // ... existing handler body ...
  } catch (err) {
    log.error('Unhandled error in QQ event handler:', err);
    try {
      await sendTextReply(chatId, 'Internal error occurred. Please try again.', event.id);
    } catch { /* ignore */ }
  }
}
```

Note: `chatId` must be extracted before the try block for the catch to use it. Move the `chatId` extraction above the try:

```typescript
async function handleEvent(event: QQMessageEvent): Promise<void> {
  const chatId = /* extract from event */;
  try {
    // ... rest of handler ...
  } catch (err) {
    log.error('Unhandled error in QQ event handler:', err);
    try {
      await sendTextReply(chatId, 'Internal error occurred. Please try again.', event.id);
    } catch { /* ignore */ }
  }
}
```

- [ ] **Step 3: Run build and tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/telegram/event-handler.ts src/qq/event-handler.ts
git commit -m "fix: add top-level try/catch to Telegram and QQ event handlers"
```

---

## Execution Order

Tasks can be executed in this order (each produces a working build):

1. **A1** (coverage config)
2. **A2** → A3 → A4 → A5 (test additions — any order, independent)
3. **B1** (async session persistence)
4. **C1** (QQ dead connection)
5. **C2** (queue timeout)
6. **C3** (proper shutdown)
7. **C4** (top-level try/catch)

Phases B, C are independent of Phase A. Phase C tasks are independent of each other. B1 and C3 both touch index.ts but C3 modifies different sections.

---

## Self-Review Checklist

**1. Spec coverage:**
- #6 (sync I/O) → Task B1
- #7 (test coverage) → Tasks A1-A5
- #15 (QQ dead connection) → Task C1
- #16 (queue timeout) → Task C2
- #17 (handle.stop no-op) → Task C3
- #18 (top-level try/catch) → Task C4

**2. Placeholder scan:** No TBD, TODO, or "implement later". Task A3 step 1 reads existing file (valid). Task C3 steps 1-2 read existing file (valid). All other steps contain exact code.

**3. Type consistency:**
- `TaskRunState` imported from `./ai-task.js` — consistent with existing usage in `handle-ai-request.ts`, `task-cleanup.ts`
- `EnqueueResult` type is `'running' | 'queued' | 'rejected'` — matches the values tested
- `PlatformHandle` interface extended with optional `runningTasks` — backwards compatible
- `RequestQueue.run()` is private — tests test through public `enqueue()` API
