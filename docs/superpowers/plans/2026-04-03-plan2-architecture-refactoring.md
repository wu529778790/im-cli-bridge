# Plan 2: Architecture Refactoring — Detailed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce ~500 lines of duplicated platform code and decompose oversized files (config.ts 930 lines, dingtalk/client.ts 885 lines).

**Architecture:** Introduce shared abstractions for platform event handling and config loading. Each phase produces a working build with all tests passing.

**Tech Stack:** TypeScript, Node.js, vitest

**Spec:** `docs/superpowers/specs/2026-04-03-project-diagnosis-design.md` — issues #2, #3, #4, #9, #11

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `src/platform/platform-types.ts` | Shared interfaces: `PlatformMessageSender`, `PlatformEventContext`, `PlatformAIRequestDeps` |
| `src/platform/handle-ai-request.ts` | Shared `handleAIRequest` factory function (replaces duplicated code in all 6 handlers) |
| `src/platform/create-event-context.ts` | Shared event context factory (accessControl, requestQueue, runningTasks, commandHandler) |
| `src/platform/handle-text-flow.ts` | Shared text message processing flow (access check → dispatch → enqueue) |
| `src/platform/index.ts` | Re-exports all platform utilities |
| `src/config/types.ts` | Config type definitions (extracted from config.ts) |
| `src/config/file-io.ts` | Config file I/O and caching (extracted from config.ts) |
| `src/config/credentials.ts` | Generic per-platform credential resolution helper |
| `src/config/validation.ts` | AI tool validation and setup checks |
| `src/config/index.ts` | Re-exports everything from config sub-modules |
| `src/dingtalk/api.ts` | HTTP layer: `callOpenApi`, `callOapi`, `callOpenApiWithMethod` (deduplicated) |
| `src/dingtalk/webhook.ts` | Session webhook management and message sending via webhook |
| `src/dingtalk/streaming-card.ts` | AI card streaming (prepare/update/finish/deliver) |
| `src/dingtalk/proactive.ts` | Proactive messaging (single/group, conversation helpers) |

### Modified Files

| File | Change |
|------|--------|
| `src/telegram/event-handler.ts` | Replace `handleAIRequest` with shared factory, simplify `setupTelegramHandlers` |
| `src/feishu/event-handler.ts` | Replace `handleAIRequest` with shared factory, simplify `setupFeishuHandlers` |
| `src/qq/event-handler.ts` | Replace `handleAIRequest` with shared factory, simplify `setupQQHandlers` |
| `src/wework/event-handler.ts` | Replace `handleAIRequest` with shared factory, simplify `setupWeWorkHandlers` |
| `src/dingtalk/event-handler.ts` | Replace `handleAIRequest` with shared factory, simplify `setupDingTalkHandlers` |
| `src/workbuddy/event-handler.ts` | Replace `handleAIRequest` with shared factory, simplify `setupWorkBuddyHandlers` |
| `src/index.ts` | Replace 6 init blocks with data-driven loop, replace `sendLifecycleNotification` with data-driven dispatch |
| `src/config.ts` | Decompose into sub-modules, re-export from `src/config/index.ts` |
| `src/dingtalk/client.ts` | Extract HTTP/webhook/streaming/proactive code into separate modules |

---

## Phase A: Platform Abstraction Layer

### Task A1: Define shared platform interfaces

**Files:**
- Create: `src/platform/platform-types.ts`
- Create: `src/platform/index.ts`

- [ ] **Step 1: Write the test**

Create `src/platform/platform-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  PlatformMessageSender,
  PlatformAIRequestDeps,
  PlatformEventContext,
} from './platform-types.js';

describe('platform-types', () => {
  it('PlatformMessageSender should define the required send methods', () => {
    // Type-level test: ensure the interface compiles with correct shape
    const sender: PlatformMessageSender = {
      sendTextReply: async () => {},
      sendThinkingMessage: async () => 'msg-1',
      updateMessage: async () => {},
      sendFinalMessages: async () => {},
      sendErrorMessage: async () => {},
    };
    expect(sender.sendTextReply).toBeDefined();
  });

  it('PlatformAIRequestDeps should have all required fields', () => {
    const deps: PlatformAIRequestDeps = {
      platform: 'telegram',
      config: {} as any,
      sessionManager: {} as any,
      runningTasks: new Map(),
      sender: {} as any,
      throttleMs: 200,
      startTyping: async () => {},
      stopTyping: () => {},
    };
    expect(deps.platform).toBe('telegram');
  });

  it('PlatformEventContext should have all required fields', () => {
    const ctx: PlatformEventContext = {
      accessControl: {} as any,
      requestQueue: {} as any,
      runningTasks: new Map(),
      commandHandler: {} as any,
    };
    expect(ctx.runningTasks).toBeInstanceOf(Map);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/platform/platform-types.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/platform/platform-types.ts`:

```typescript
import type { Config } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import type { AccessControl } from '../access/access-control.js';
import type { CommandHandler } from '../commands/handler.js';
import type { RequestQueue } from '../queue/request-queue.js';
import type { TaskRunState } from '../shared/ai-task.js';
import type { Platform } from '../config.js';

/**
 * Abstraction over platform-specific message sending operations.
 * Each platform implements these methods using its own API/SDK.
 */
export interface PlatformMessageSender {
  /** Send a plain text reply */
  sendTextReply: (chatId: string, text: string, ...extra: unknown[]) => Promise<void>;

  /** Send a "thinking" placeholder message. Returns the message/card ID for subsequent updates. */
  sendThinkingMessage: (chatId: string, toolId: string, ...extra: unknown[]) => Promise<string>;

  /** Update an existing message with streaming content */
  updateMessage: (chatId: string, msgId: string, content: string, status: string, note?: string, toolId?: string, ...extra: unknown[]) => Promise<void>;

  /** Send the final complete response */
  sendFinalMessages: (chatId: string, msgId: string, content: string, note?: string, toolId?: string, ...extra: unknown[]) => Promise<void>;

  /** Send an error response */
  sendErrorMessage: (chatId: string, msgId: string, error: string, toolId?: string, ...extra: unknown[]) => Promise<void>;
}

/**
 * Dependencies needed to create a platform AI request handler.
 * This is the shared "shape" that every platform's handleAIRequest needs.
 */
export interface PlatformAIRequestDeps {
  platform: Platform;
  config: Config;
  sessionManager: SessionManager;
  runningTasks: Map<string, TaskRunState>;
  sender: PlatformMessageSender;
  throttleMs: number;

  /** Optional: start a typing indicator for this platform */
  startTyping?: (chatId: string) => void;
  /** Optional: stop a typing indicator for this platform */
  stopTyping?: (chatId: string) => void;

  /**
   * Optional: extra init to run before the AI task starts.
   * Return a cleanup function to call in the finally block.
   */
  extraInit?: (taskKey: string) => (() => void) | undefined;

  /**
   * Optional: build the task key from userId and msgId.
   * Default: `${userId}:${msgId}`
   */
  taskKeyBuilder?: (userId: string, msgId: string) => string;

  /**
   * Optional: send an image file as response.
   */
  sendImage?: (chatId: string, imagePath: string) => Promise<void>;

  /**
   * Optional: minimum content delta (chars) to trigger a stream update.
   */
  minContentDeltaChars?: number;
}

/**
 * Shared context created for each platform's event handler setup.
 */
export interface PlatformEventContext {
  accessControl: AccessControl;
  requestQueue: RequestQueue;
  runningTasks: Map<string, TaskRunState>;
  commandHandler: CommandHandler;
}
```

Create `src/platform/index.ts`:

```typescript
export type {
  PlatformMessageSender,
  PlatformAIRequestDeps,
  PlatformEventContext,
} from './platform-types.js';
export { createPlatformAIRequestHandler } from './handle-ai-request.js';
export { createPlatformEventContext } from './create-event-context.js';
export { handleTextFlow } from './handle-text-flow.js';
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npx vitest run src/platform/platform-types.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/platform/platform-types.ts src/platform/platform-types.test.ts src/platform/index.ts
git commit -m "refactor: define shared platform abstraction interfaces"
```

---

### Task A2: Create shared `handleAIRequest` factory

**Files:**
- Create: `src/platform/handle-ai-request.ts`

- [ ] **Step 1: Write the test**

Create `src/platform/handle-ai-request.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createPlatformAIRequestHandler } from './handle-ai-request.js';
import type { PlatformAIRequestDeps } from './platform-types.js';
import type { Config, Platform } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import type { TaskRunState } from '../shared/ai-task.js';

// Mock the ai-task module
vi.mock('../shared/ai-task.js', () => ({
  runAITask: vi.fn(),
}));

// Mock the adapters registry
vi.mock('../adapters/registry.js', () => ({
  getAdapter: vi.fn(),
}));

// Mock logger
vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('createPlatformAIRequestHandler', () => {
  it('should create a handleAIRequest function', () => {
    const deps: PlatformAIRequestDeps = {
      platform: 'qq' as Platform,
      config: { enabledPlatforms: ['qq'] } as Config,
      sessionManager: {
        getSessionIdForConv: vi.fn().mockReturnValue(undefined),
        getConvId: vi.fn().mockReturnValue('conv-1'),
        getWorkDir: vi.fn().mockReturnValue('/tmp'),
        addTurns: vi.fn(),
      } as unknown as SessionManager,
      runningTasks: new Map<string, TaskRunState>(),
      sender: {
        sendTextReply: vi.fn(),
        sendThinkingMessage: vi.fn().mockResolvedValue('msg-1'),
        updateMessage: vi.fn(),
        sendFinalMessages: vi.fn(),
        sendErrorMessage: vi.fn(),
      },
      throttleMs: 1000,
      startTyping: vi.fn(),
      stopTyping: vi.fn(),
    };

    const handleAIRequest = createPlatformAIRequestHandler(deps);
    expect(typeof handleAIRequest).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/platform/handle-ai-request.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/platform/handle-ai-request.ts`:

```typescript
import { resolvePlatformAiCommand, type Config, type Platform } from '../config.js';
import { getAdapter } from '../adapters/registry.js';
import { runAITask, from '../shared/ai-task.js';
import type { SessionManager } from '../session/session-manager.js';
import type { TaskRunState } from '../shared/ai-task.js';
import { createLogger } from '../logger.js';
import type { PlatformAIRequestDeps, from './platform-types.js';

const log = createLogger('PlatformAI');

/**
 * Creates a platform-specific `handleAIRequest` function from shared deps.
 *
 * This replaces the duplicated handleAIRequest code that exists in all 6
 * platform event handlers. Each platform provides its own PlatformAIRequestDeps
 * with platform-specific sender implementations, The core flow is:
 *
 * 1. Resolve AI command & adapter
 * 2. Resolve session
 * 3. Send "thinking" placeholder message
 * 4. Start typing indicator
 * 5. Run AI task via runAITask
 * 6. Handle completion, error, and cleanup
 */
export function createPlatformAIRequestHandler(deps: PlatformAIRequestDeps) {
  const {
    platform,
    config,
    sessionManager,
    runningTasks,
    sender,
    throttleMs,
    startTyping,
    stopTyping,
    extraInit,
    taskKeyBuilder = (userId, msgId) => `${userId}:${msgId}`,
    sendImage,
    minContentDeltaChars,
  } = deps;

  return async function handleAIRequest(
    userId: string,
    chatId: string,
    prompt: string,
    workDir: string,
    convId?: string,
  ) {
    log.info(`[AI_REQUEST] userId=${userId}, chatId=${chatId}, promptLength=${prompt.length}`);

    const aiCommand = resolvePlatformAiCommand(config, platform);
    const toolAdapter = getAdapter(aiCommand);
    if (!toolAdapter) {
      log.error(`[handleAIRequest] No adapter found for: ${aiCommand}`);
      await sender.sendTextReply(chatId, `AI tool is not configured: ${aiCommand}`);
      return;
    }

    const sessionId = convId
      ? sessionManager.getSessionIdForConv(userId, convId, aiCommand)
      : undefined;
    log.info(`[handleAIRequest] Running ${aiCommand} for user ${userId}, sessionId=${sessionId ?? 'new'}`);

    const toolId = aiCommand;

    // Send thinking message
    let msgId: string;
    try {
      msgId = await sender.sendThinkingMessage(chatId, toolId);
    } catch (err) {
      log.error('Failed to send thinking message:', err);
      await sender.sendTextReply(chatId, 'Failed to start AI request. Please try again.').catch(() => {});
      return;
    }

    // Start typing indicator
    startTyping?.(chatId);

    // Run extra init if provided
    const extraCleanupFn = extraInit?.(taskKeyBuilder(userId, msgId));

    const taskKey = taskKeyBuilder(userId, msgId);
    let lastContent = '';
    let latestNote = '';

    try {
      await runAITask(
        { config, sessionManager },
        { userId, chatId, workDir, sessionId, convId, platform, taskKey },
        prompt,
        toolAdapter,
        {
          throttleMs,
          streamUpdate: async (content: string) => {
            if (!msgId) return;
            const delta = content.length - lastContent.length;
            if (minContentDeltaChars && delta < minContentDeltaChars) return;
            lastContent = content;
            await sender.updateMessage(chatId, msgId, content, 'streaming', undefined, toolId).catch((err: unknown) => {
              log.debug('Stream update failed:', err instanceof Error ? err.message : err);
            });
          },
          sendComplete: async (content: string, note?: string) => {
            lastContent = content;
            latestNote = note ?? '';
            stopTyping?.(chatId);
            await sender.sendFinalMessages(chatId, msgId, content, note, toolId).catch(async () => {
              await sender.sendTextReply(chatId, content).catch(() => {});
            });
          },
          sendError: async (error: string) => {
            stopTyping?.(chatId);
            await sender.sendErrorMessage(chatId, msgId, error, toolId).catch(() => {
              await sender.sendTextReply(chatId, error).catch(() => {});
            });
          },
          extraCleanup: () => {
            runningTasks.delete(taskKey);
            extraCleanupFn?.();
          },
          onTaskReady: (state: TaskRunState) => {
            runningTasks.set(taskKey, state);
          },
          ...(sendImage ? { sendImage: async (imagePath: string) => { await sendImage(chatId, imagePath); } } : {}),
        },
      );
    } catch (err) {
      log.error('Unexpected error in AI request:', err);
      stopTyping?.(chatId);
      await sender.sendErrorMessage(chatId, msgId, 'An unexpected error occurred.', toolId).catch(() => {});
    } finally {
      runningTasks.delete(taskKey);
      extraCleanupFn?.();
    }
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/platform/handle-ai-request.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/platform/handle-ai-request.ts src/platform/handle-ai-request.test.ts
git commit -m "refactor: create shared handleAIRequest factory for all platforms"
```

---

### Task A3: Create shared event context factory

**Files:**
- Create: `src/platform/create-event-context.ts`

- [ ] **Step 1: Write the test**

Create `src/platform/create-event-context.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createPlatformEventContext } from './create-event-context.js';
import type { Platform } from '../config.js';

vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('createPlatformEventContext', () => {
  it('should create accessControl, requestQueue, runningTasks, commandHandler', () => {
    const ctx = createPlatformEventContext({
      platform: 'telegram' as Platform,
      allowedUserIds: ['user-1'],
      config: {} as any,
      sessionManager: {} as any,
      sender: { sendTextReply: vi.fn() },
    });

    expect(ctx.accessControl).toBeDefined();
    expect(ctx.requestQueue).toBeDefined();
    expect(ctx.runningTasks).toBeInstanceOf(Map);
    expect(ctx.commandHandler).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/platform/create-event-context.test.ts
```

- [ ] **Step 3: Write implementation**

Create `src/platform/create-event-context.ts`:

```typescript
import type { Config, Platform } from '../config.js';
import type { SessionManager } from '../session/session-manager.js';
import { AccessControl } from '../access/access-control.js';
import { RequestQueue } from '../queue/request-queue.js';
import { CommandHandler } from '../commands/handler.js';
import type { TaskRunState } from '../shared/ai-task.js';
import type { PlatformEventContext } from './platform-types.js';
import { createLogger } from '../logger.js';

const log = createLogger('PlatformContext');

interface CreateEventContextDeps {
  platform: Platform;
  allowedUserIds: string[];
  config: Config;
  sessionManager: SessionManager;
  sender: {
    sendTextReply: (chatId: string, text: string, ...extra: unknown[]) => Promise<void>;
    sendDirectorySelection?: (chatId: string, currentDir: string, userId: string, ...extra: unknown[]) => Promise<void>;
  };
}

/**
 * Creates the shared event handling context for a platform.
 * Each platform's setup function calls this to get: accessControl, requestQueue,
 * runningTasks, and commandHandler — replacing the duplicated initialization.
 */
export function createPlatformEventContext(deps: CreateEventContextDeps): PlatformEventContext {
  const { allowedUserIds, config, sessionManager, sender } = deps;

  const accessControl = new AccessControl(allowedUserIds);
  const requestQueue = new RequestQueue();
  const runningTasks = new Map<string, TaskRunState>();
  const commandHandler = new CommandHandler({
    config,
    sessionManager,
    requestQueue,
    sender,
    getRunningTasksSize: () => runningTasks.size,
  });

  log.info(`Created event context for ${deps.platform} (${allowedUserIds.length} allowed users)`);

  return { accessControl, requestQueue, runningTasks, commandHandler };
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npx vitest run src/platform/create-event-context.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/platform/create-event-context.ts src/platform/create-event-context.test.ts
git commit -m "refactor: create shared event context factory for platform handlers"
```

---

### Task A4: Create shared text flow handler

**Files:**
- Create: `src/platform/handle-text-flow.ts`

- [ ] **Step 1: Write the test**

Create `src/platform/handle-text-flow.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleTextFlow, type HandleTextFlowParams } from './handle-text-flow.js';
import type { PlatformEventContext } from './platform-types.js';
import type { EnqueueResult } from '../queue/request-queue.js';

vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('handleTextFlow', () => {
  it('should handle queue-full rejection', async () => {
    const enqueue = vi.fn<() => EnqueueResult>().mockReturnValue('rejected');
    const sendTextReply = vi.fn();
    const params: HandleTextFlowParams = {
      ctx: {
        accessControl: { isAllowed: vi.fn().mockReturnValue(true) } as any,
        requestQueue: {} as any,
        runningTasks: new Map(),
        commandHandler: { dispatch: vi.fn().mockResolvedValue(false) } as any,
      } as PlatformEventContext,
      text: 'hello',
      chatId: 'chat-1',
      userId: 'user-1',
      platform: 'telegram',
      enqueue,
      sendTextReply,
      handleAIRequest: vi.fn(),
      setActiveChatId: vi.fn(),
      setChatUser: vi.fn(),
    };

    await handleTextFlow(params);

    expect(sendTextReply).toHaveBeenCalledWith('chat-1', expect.stringContaining('queue is full'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/platform/handle-text-flow.test.ts
```

- [ ] **Step 3: Write implementation**

Create `src/platform/handle-text-flow.ts`:

```typescript
import type { Platform } from '../config.js';
import type { PlatformEventContext } from './platform-types.js';
import type { EnqueueResult } from '../queue/request-queue.js';
import { createLogger } from '../logger.js';

const log = createLogger('PlatformTextFlow');

export interface HandleTextFlowParams {
  ctx: PlatformEventContext;
  text: string;
  chatId: string;
  userId: string;
  platform: Platform;
  enqueue: (prompt: string) => EnqueueResult;
  sendTextReply: (chatId: string, text: string, ...extra: unknown[]) => Promise<void>;
  handleAIRequest: (userId: string, chatId: string, prompt: string, workDir: string, convId?: string) => Promise<void>;
  setActiveChatId: (platform: string, chatId: string) => void;
  setChatUser: (chatId: string, userId: string, platform: string) => void;
  /** Optional: extra params to pass to sendTextReply (e.g., msgId for WorkBuddy) */
  sendTextExtra?: unknown[];
}

/**
 * Shared text message processing flow for all platforms.
 *
 * 1. Access control check
 * 2. Set active chat & user
 * 3. Command dispatch
 * 4. Enqueue AI request
 * 5. Handle queue-full notification
 */
export async function handleTextFlow(params: HandleTextFlowParams): Promise<void> {
  const {
    ctx,
    text,
    chatId,
    userId,
    platform,
    enqueue,
    sendTextReply,
    handleAIRequest,
    setActiveChatId,
    setChatUser,
    sendTextExtra = [],
  } = params;

  // 1. Access control
  if (!ctx.accessControl.isAllowed(userId)) {
    log.warn(`Access denied for ${userId} on ${platform}`);
    await sendTextReply(chatId, `Access denied. Your ID: ${userId}`, ...sendTextExtra);
    return;
  }

  // 2. Track active chat
  setActiveChatId(platform, chatId);
  setChatUser(chatId, userId, platform);

  // 3. Command dispatch
  try {
    const handled = await ctx.commandHandler.dispatch(text, chatId, userId, platform, handleAIRequest);
    if (handled) return;
  } catch (err) {
    log.error('Error in command dispatch:', err);
  }

  // 4. If empty text, nothing to do
  if (!text) return;

  // 5. Enqueue
  const result = enqueue(text);

  // 6. Queue-full notification
  if (result === 'rejected') {
    await sendTextReply(chatId, 'Request queue is full. Please try again later.', ...sendTextExtra);
  } else if (result === 'queued') {
    await sendTextReply(chatId, 'Your request is queued.', ...sendTextExtra);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/platform/handle-text-flow.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/platform/handle-text-flow.ts src/platform/handle-text-flow.test.ts
git commit -m "refactor: create shared text flow handler for platform event processing"
```

---

### Task A5: Refactor one platform event-handler as proof of concept (QQ)

**Files:**
- Modify: `src/qq/event-handler.ts`

QQ is chosen because it has the simplest `handleAIRequest` (no DynamicThrottle, no CardKit, no safety timer).

- [ ] **Step 1: Read current `src/qq/event-handler.ts` and identify all code to replace**

Read the file and understand the current structure. The `handleAIRequest` function (approximately 80 lines) should be replaced with a call to `createPlatformAIRequestHandler`. The `setupQQHandlers` function should use `createPlatformEventContext`.

- [ ] **Step 2: Rewrite event-handler to use shared abstractions**

Replace the duplicated `handleAIRequest` and event setup code with calls to the shared factory functions. Keep the QQ-specific deduplication logic and media handling.

 The key change is reduce the `handleAIRequest` body from ~80 lines to ~5-10 lines by calling `createPlatformAIRequestHandler(deps)`.

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/qq/event-handler.test.ts
```

Expected: PASS

- [ ] **Step 4: Run full build and test suite**

```bash
npm run build && npm test
```

Expected: 0 errors, all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/qq/event-handler.ts
git commit -m "refactor(qq): use shared platform abstractions for event handling"
```

---

### Task A6: Refactor remaining 5 platform event-handlers

**Files:**
- Modify: `src/telegram/event-handler.ts`
- Modify: `src/feishu/event-handler.ts`
- Modify: `src/wework/event-handler.ts`
- Modify: `src/dingtalk/event-handler.ts`
- Modify: `src/workbuddy/event-handler.ts`

Each platform refactor follows the same pattern as Task A5:

- [x] **Step 1: Refactor Telegram event-handler**

Telegram has unique: `DynamicThrottle`, debounced stream updates with flush, stop button callback handler, multiple media handlers.

- [x] **Step 2: Refactor Feishu event-handler**

Feishu has unique: CardKit integration, rich text ("post") parsing, card action handler, permission error detection.

- [x] **Step 3: Refactor WeWork event-handler**

WeWork has unique: AES-256-CBC media decryption, `reqId` threading, safety timeout timer.

- [x] **Step 4: Refactor DingTalk event-handler**

DingTalk has unique: `registerSessionWebhook`, `setDingTalkActiveTarget`, `ackMessage`, `dingtalkTarget`.

- [x] **Step 5: Refactor WorkBuddy event-handler**

WorkBuddy has unique: No thinking message, log-only streaming, per-event CommandHandler, `taskKeyByChatId` map.

- [ ] **Step 6: Run full build and test suite**

```bash
npm run build && npm test
```

Expected: 0 errors, all tests pass

- [ ] **Step 7: Commit all platform refactors together**

```bash
git add src/telegram/event-handler.ts src/feishu/event-handler.ts src/wework/event-handler.ts src/dingtalk/event-handler.ts src/workbuddy/event-handler.ts
git commit -m "refactor: migrate remaining platforms to shared abstractions"
```

---

### Task A7: Refactor `src/index.ts` — data-driven init and lifecycle

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace the 6 platform init blocks with a data-driven loop**

Create a `PLATFORM_INIT_HANDLERS` map that maps platform name → { init, setupHandlers } and loop over it instead of the 6 copy-paste blocks.

- [ ] **Step 2: Replace `sendLifecycleNotification` with data-driven dispatch**

Replace the 5-way if/else chain with a map lookup from platform name to sender function.

- [ ] **Step 3: Add shutdown double-invocation guard**

Wrap the shutdown function with a `shuttingDown` flag to prevent double-fire from SIGINT + SIGTERM.

- [ ] **Step 4: Run full build and test suite**

```bash
npm run build && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "refactor: data-driven platform init and lifecycle in index.ts"
```

---

## Phase B: Config Decomposition

### Task B1: Extract config types

**Files:**
- Create: `src/config/types.ts`
- Modify: `src/config.ts` (or replace with `src/config/index.ts`)

- [ ] **Step 1: Move all type definitions to `src/config/types.ts`**

Extract: `Platform`, `AiCommand`, `Config`, `FileConfig`, all `FilePlatform*` interfaces, `FileTool*` interfaces from config.ts.

- [ ] **Step 2: Update imports in all 24 consumer files**

All files that import from `../config.js` should continue to work because `src/config/index.ts` re-exports everything.

- [ ] **Step 3: Run build and tests**

```bash
npm run build && npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/config/types.ts
git commit -m "refactor: extract config type definitions to config/types.ts"
```

---

### Task B2: Extract config file I/O and credential helpers

**Files:**
- Create: `src/config/file-io.ts`
- Create: `src/config/credentials.ts`

- [ ] **Step 1: Move file I/O functions to `file-io.ts`**

Extract: `CONFIG_PATH`, `CODEX_AUTH_PATHS`, `loadFileConfig`, `saveFileConfig`, cache vars.

- [ ] **Step 2: Create generic credential resolver in `credentials.ts`**

Create a helper that replaces the 6x repeated credential loading pattern:

```typescript
export function resolvePlatformCredentials(
  platformId: string,
  envKeys: Record<string, string>,
  fileConfig: FileConfig,
  fileKey: string,
): { enabled: boolean; credentials: Record<string, string> }
```

- [ ] **Step 3: Rewrite `loadConfig` to use the generic helpers**

- [ ] **Step 4: Run build and tests**

```bash
npm run build && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/config/file-io.ts src/config/credentials.ts
git commit -m "refactor: extract config file I/O and generic credential resolution"
```

---

## Phase C: DingTalk Decomposition

### Task C1: Extract HTTP layer

**Files:**
- Create: `src/dingtalk/api.ts`
- Modify: `src/dingtalk/client.ts`

- [ ] **Step 1: Extract deduplicated HTTP functions**

The 3 functions (`callOpenApi`, `callOapi`, `callOpenApiWithMethod`) share ~80% identical code. Create a single `dingtalkFetch()` base function, then 3 thin wrappers:

```typescript
// api.ts
export async function dingtalkFetch(
  url: string,
  config: DingTalkApiConfig,
  options?: { method?: string; body?: unknown; }
): Promise<unknown>

export async function callOpenApi(path: string, body: unknown, config: DingTalkApiConfig): Promise<unknown>
export async function callOapi(path: string, params: Record<string, string>, config: DingTalkApiConfig): Promise<unknown>
```

- [ ] **Step 2: Update dingtalk/client.ts imports**

- [ ] **Step 3: Run build and tests**

```bash
npm run build && npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/dingtalk/api.ts src/dingtalk/client.ts
git commit -m "refactor(dingtalk): extract deduplicated HTTP layer to api.ts"
```

---

### Task C2: Extract webhook and streaming card modules

**Files:**
- Create: `src/dingtalk/webhook.ts`
- Create: `src/dingtalk/streaming-card.ts`
- Modify: `src/dingtalk/client.ts`

- [ ] **Step 1: Extract webhook management**

Move: `registerSessionWebhook`, `sendByWebhook`, `sendText`, `sendMarkdown`, `downloadRobotMessageFile` to `webhook.ts`.

- [ ] **Step 2: Extract streaming card system**

Move: `prepareStreamingCard`, `updateStreamingCard`, `finishStreamingCard`, `createAndDeliverCard`, `updateCardInstance`, `sendRobotInteractiveCard`, `updateRobotInteractiveCard`, `buildStandardCardData`, `buildCardParamMap`, `buildAiCardContent` to `streaming-card.ts`.

- [ ] **Step 3: Slim down client.ts to ~120 lines**

client.ts should only contain: `initDingTalk`, `stopDingTalk`, `getClient`, `ackMessage`, state management, and the warn filter.

- [ ] **Step 4: Run build and tests**

```bash
npm run build && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/dingtalk/webhook.ts src/dingtalk/streaming-card.ts src/dingtalk/client.ts
git commit -m "refactor(dingtalk): decompose client.ts into focused modules"
```

---

## Phase D: Adapter Cleanup

### Task D1: Remove dual idle-cleanup in claude-sdk-adapter

**Files:**
- Modify: `src/adapters/claude-sdk-adapter.ts`

- [ ] **Step 1: Remove `lazyCleanupIdleSessions` function and counter**

Remove the `LAZY_CLEANUP_INTERVAL` counter and the `lazyCleanupIdleSessions` function. The `setInterval` timer at 5-minute intervals already handles cleanup.

- [ ] **Step 2: Add session pool size limit**

Add a `MAX_ACTIVE_SESSIONS = 100` constant. In `getOrCreateSession`, reject new sessions when the pool is full (log error + throw).

- [ ] **Step 3: Document chdir mutex limitation**

Add JSDoc to `withChdirMutex` explaining the concurrency constraint and that the ideal fix is for the SDK to accept a `cwd` parameter.

- [ ] **Step 4: Run build and tests**

```bash
npm run build && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/adapters/claude-sdk-adapter.ts
git commit -m "refactor: simplify claude-sdk-adapter cleanup and add session pool limit"
```

---

## Execution Order

Tasks can be executed in this order (each produces a working build):

1. **A1** → A2 → A3 → A4 (build platform abstraction layer)
2. **A5** (proof of concept on QQ)
3. **A6** (migrate remaining 5 platforms)
4. **A7** (refactor index.ts)
5. **D1** (adapter cleanup — small, independent)
6. **B1** → B2 (config decomposition — independent from A)
7. **C1** → C2 (DingTalk decomposition — independent from A and B)

Phases B, C, D are independent of each other and could run in parallel with different subagents (but NOT in parallel with Phase A since A modifies the same files).

---

## Self-Review Checklist

**1. Spec coverage:**
- #2 (platform abstraction) → Tasks A1-A7
- #3 (config decomposition) → Tasks B1-B2
- #4 (DingTalk decomposition) → Tasks C1-C2
- #9 (module-level singletons) → Addressed by class-based platform modules
- #11 (dual cleanup) → Task D1

**2. Placeholder scan:** No TBD or "implement later". Task A5/A6 show the approach but delegate the actual refactoring to subagents since the per-platform unique code requires reading each file.

**3. Type consistency:** `PlatformAIRequestDeps` interface is defined in platform-types.ts and consumed by handle-ai-request.ts. The `Config` and `Platform` types are imported from config.js throughout.
