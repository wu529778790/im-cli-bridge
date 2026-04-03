# Plan 3: Test Coverage + Performance (Outline)

> **Status:** Outline only — detailed plan to be written before implementation.
> **Depends on:** Plan 2 completion (architecture must be stable before adding tests)

**Goal:** Bring test coverage to 60%+ lines, fix performance bottlenecks in session persistence and concurrency.

**Spec:** `docs/superpowers/specs/2026-04-03-project-diagnosis-design.md` — issues #6, #7, #15, #16, #17, #18

## Planned Tasks

### Phase A: Test Infrastructure (#7)

1. **Add coverage thresholds to `vitest.config.ts`** — 60% line coverage target
2. **Add tests for `RequestQueue`** — enqueue, clear, max size, chaining
3. **Add tests for `SessionManager`** — save/flush, session mapping, workdir validation
4. **Add tests for `ClaudeSDKAdapter`** — session pool, idle cleanup, abort
5. **Add tests for platform event-handlers** — command dispatch, AI request flow, access control
6. **Add tests for `runAITask`** — completion, error, abort, sessionInvalid paths
7. **Add integration test** — full message flow for one platform (mocked adapter)

### Phase B: Session Persistence Performance (#6)

1. **Convert `writeFileSync` to async `writeFile`** — in `doFlush()`
2. **Add atomic write (write-then-rename)** — crash safety for sessions file
3. **Convert `flushSync()` to async `flush()`** — update all callers
4. **Add `flushActiveChats()` async path** — same treatment for active-chats.ts

### Phase C: Reliability Fixes (#15, #16, #17, #18)

1. **Add dead connection detection to QQ WebSocket** — heartbeat-based timeout
2. **Add task timeout to `RequestQueue`** — configurable, default 10 min
3. **Implement proper `handle.stop()`** — abort running AI tasks on shutdown
4. **Add top-level try/catch** — to Telegram and QQ event handlers
5. **Add shutdown double-invocation guard** — idempotent shutdown function
