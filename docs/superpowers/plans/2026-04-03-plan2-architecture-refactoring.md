# Plan 2: Architecture Refactoring (Outline)

> **Status:** Outline only — detailed plan to be written before implementation.
> **Depends on:** Plan 1 completion (build must be passing first)

**Goal:** Reduce code duplication across 6 platforms by introducing shared abstractions, decompose oversized files.

**Spec:** `docs/superpowers/specs/2026-04-03-project-diagnosis-design.md` — issues #2, #3, #4, #9, #10, #11

## Planned Tasks

### Phase A: Platform Abstraction Layer (#2, #9)

1. **Define `PlatformClient` interface** — `init()`, `stop()`, lifecycle hooks
2. **Define `MessageSender` interface** — `sendText()`, `sendThinking()`, `updateMessage()`, `sendFinal()`, `sendError()`
3. **Extract `handleAIRequest` into shared function** — currently duplicated 6 times
4. **Create platform registry** — data-driven init/stop/notify lifecycle
5. **Refactor `src/index.ts`** — replace 6 init blocks with registry loop
6. **Refactor `sendLifecycleNotification`** — data-driven dispatch
7. **Wrap platform clients in classes** — replace module-level `let` vars with class instances

### Phase B: Config Decomposition (#3)

1. **Extract `config/types.ts`** — all type definitions
2. **Extract `config/loader.ts`** — file I/O, env resolution, caching
3. **Extract `config/platforms.ts`** — data-driven credential/whitelist/assembly
4. **Extract `config/validation.ts`** — AI tool validation, CLI path checks
5. **Update imports across codebase**

### Phase C: DingTalk Decomposition (#4)

1. **Extract `dingtalk/api.ts`** — OpenAPI/OAPI call wrapper + token management
2. **Extract `dingtalk/streaming-card.ts`** — AI card streaming (prepare/update/finish)
3. **Extract `dingtalk/media.ts`** — file download/upload
4. **Slim down `dingtalk/client.ts`** — connection lifecycle only

### Phase D: Adapter Cleanup (#10, #11)

1. **Remove `lazyCleanupIdleSessions`** — keep only interval timer
2. **Add session pool size limit** — cap `activeSessions` map
3. **Document chdir mutex limitation** — add JSDoc with known constraints
