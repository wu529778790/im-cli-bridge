# open-im Project Comprehensive Diagnosis

**Date:** 2026-04-03
**Scope:** Full-stack analysis across 6 dimensions — Build/Dependencies, Architecture/Code Quality, Security, Performance, Test Coverage, Reliability
**Approach:** Severity-first ranking with dimensional tags (方案 C)

---

## Executive Summary

| Dimension | Critical | Medium | Low | Total |
|-----------|----------|--------|-----|-------|
| Build / Dependencies | 1 | 1 | 1 | 3 |
| Architecture / Code Quality | 3 | 4 | 4 | 11 |
| Security | 1 | 2 | 5 | 8 |
| Performance | 1 | 1 | 3 | 5 |
| Test / Reliability | 3 | 4 | 4 | 11 |
| **Total** | **9** | **12** | **17** | **38** |

Key takeaway: The project has a clean layered architecture and consistent platform patterns, but suffers from build breakage, significant code duplication across platforms, a security risk from open access + unrestricted AI execution, and extensive test coverage gaps.

---

## Critical Issues

### #1 [Build] Build failure — 4 TypeScript errors

**Files:**
- `src/workbuddy/centrifuge-client.ts:5` — `TS2307: Cannot find module 'centrifuge'`
- `src/workbuddy/centrifuge-client.ts:122` — `TS7006: Parameter 'ctx' implicitly has 'any' type`
- `src/workbuddy/centrifuge-client.ts:171` — `TS7006: Parameter 'ctx' implicitly has 'any' type`
- `src/workbuddy/event-handler.ts:13` — `TS2307: Cannot find module '../shared/task-cleanup.js'`

**Root cause:**
- `centrifuge` package declared in `package.json` but not installed in `node_modules/`
- `src/shared/task-cleanup.ts` does not exist — file was never created or was deleted
- Two `ctx` parameters lack type annotations (may resolve once `centrifuge` types are available)

**Fix:**
- Run `npm install` to install `centrifuge`
- Create `src/shared/task-cleanup.ts` or remove the import from `workbuddy/event-handler.ts`
- Add explicit `any` annotations if types don't resolve

---

### #2 [Architecture] No platform abstraction — ~500 lines duplicated across 6 platforms

**Pattern:** Every platform's event-handler contains a nearly identical `handleAIRequest` function:
1. Resolve AI command → 2. Get adapter → 3. Get/create session → 4. Send "thinking" → 5. Start typing loop → 6. Call `runAITask` → 7. Manage running tasks map

Additional duplicated patterns:
- Platform init blocks in `src/index.ts:225-284` (6 identical try/catch blocks)
- `sendLifecycleNotification` in `src/index.ts:47-100` (5 identical if-blocks)
- `accessControl + requestQueue + runningTasks + commandHandler` instantiation (repeated 6 times)
- Queue-full handling (identical 3-line block in every handler)
- `setActiveChatId + setChatUser` calls at start of every event handler

**Fix:** Introduce a platform abstraction layer:
- `PlatformClient` interface (init, stop, send)
- `PlatformEventHandler` base class with shared `handleAIRequest` logic
- `MessageSender` interface (sendText, sendThinking, updateMessage, sendFinal, sendError)
- Platform registry for lifecycle management (init all, stop all, notify all)

---

### #3 [Architecture] `src/config.ts` at 930 lines — 6 concerns in one file

**Mixed responsibilities:**
- Type definitions (~200 lines)
- File I/O and caching (~100 lines)
- Environment variable resolution (~200 lines)
- Per-platform credential loading (6 × ~30 lines, identical pattern)
- Per-platform whitelist resolution (6 × ~6 lines, identical pattern)
- Per-platform config assembly (6 × ~15 lines, identical ternary)
- AI tool validation and CLI path checks (~80 lines)

**Fix:** Decompose into:
- `config/types.ts` — type definitions
- `config/loader.ts` — file I/O, env resolution, caching
- `config/platforms.ts` — data-driven platform credential/whitelist/assembly using a platform-to-env mapping
- `config/validation.ts` — AI tool validation, CLI path checks

---

### #4 [Architecture] `src/dingtalk/client.ts` at 885 lines — 6+ responsibilities

**Single file manages:**
1. Connection lifecycle (stream client init)
2. Session webhook management (90-min TTL)
3. Message sending (text, markdown, streaming card)
4. Media download (file/image)
5. OpenAPI/OAPI calls (token management, API invocation)
6. AI card streaming (prepare/update/finish)
7. Interactive card management
8. Error formatting

**Fix:** Decompose into:
- `dingtalk/client.ts` — connection lifecycle only
- `dingtalk/api.ts` — OpenAPI/OAPI call wrapper
- `dingtalk/streaming-card.ts` — AI card streaming logic
- `dingtalk/media.ts` — file download/upload

---

### #5 [Security] `skipPermissions: true` hardcoded + default-open access control

**Files:**
- `src/shared/ai-task.ts:293` — `skipPermissions: true` always passed to AI adapter
- `src/access/access-control.ts:13-17` — empty whitelist allows all users

**Combined risk:** Any user who can reach the bot on any platform can execute arbitrary file operations and shell commands on the host machine through the AI agent.

**Fix:**
- Make `skipPermissions` configurable per-platform or per-user (default: `false`)
- Require explicit whitelist configuration during setup (warn loudly if empty)
- Document the security implications clearly

---

### #6 [Performance] Session manager uses synchronous file I/O in hot paths

**File:** `src/session/session-manager.ts:362`

`writeFileSync` is called on every `flushSync()`, which is triggered by `/new`, `/cd`, and other commands. The debounced `save()` (500ms) batches writes, but explicit flush calls block the event loop.

Additional concern: crash during write can corrupt the session file (no write-then-rename pattern).

**Fix:**
- Replace `writeFileSync` with `writeFile` + atomic rename (`writeFile(tmpPath)` → `rename(tmpPath, realPath)`)
- Convert `flushSync()` to async `flush()`
- Add write-then-rename for crash safety

---

### #7 [Test] 28 of 47 source files have zero test coverage

**Critical untested files:**
- `src/index.ts` — main lifecycle, shutdown
- All platform event-handlers (except QQ)
- All platform clients (WebSocket reconnect, heartbeat)
- `src/adapters/claude-sdk-adapter.ts` — core AI adapter, session pool
- `src/session/session-manager.ts` — only `resolveWorkDirInput` tested (3 tests)
- `src/queue/request-queue.ts` — no tests at all
- `src/shared/ai-task.ts` — only 1 test (usage limit path)

**Additional issues:**
- Zero integration tests (no full pipeline test from event → AI response)
- No coverage thresholds in `vitest.config.ts`
- `src/shared/retry.ts` is dead code (defined but never imported)

**Fix:**
- Add coverage thresholds to `vitest.config.ts` (target: 60% line coverage)
- Prioritize tests for `request-queue`, `session-manager`, `claude-sdk-adapter`, platform clients
- Remove dead `retry.ts` or integrate it
- Add integration test for at least one platform's full message flow

---

## Medium Issues

### #8 [Build] Unused dependencies in package.json

- `qrcode-terminal` — no source file imports it
- `qq-official-bot` — QQ client uses raw `ws` + `fetch` instead

**Fix:** Remove both from `package.json` and `@types/qrcode-terminal` from devDependencies.

---

### #9 [Architecture] Module-level singleton state throughout

**Files:** `src/shared/active-chats.ts`, `src/adapters/claude-sdk-adapter.ts`, all platform clients

Module-level `let` variables (`ws`, `client`, `data`, etc.) make testing difficult and prevent multiple instances.

**Fix:** Wrap state in classes or factory functions. Acceptable for now given single-process architecture, but should be addressed during platform abstraction refactor.

---

### #10 [Architecture] `process.chdir()` global mutex in claude-sdk-adapter

**File:** `src/adapters/claude-sdk-adapter.ts:73-85`

The mutex serializes all concurrent session create/resume calls. Between `process.chdir(workDir)` and `finally`, any async code on the event loop sees the wrong working directory.

**Fix:** Long-term: push Anthropic SDK to accept `cwd` parameter. Short-term: document the concurrency limitation and consider queue depth monitoring.

---

### #11 [Architecture] Dual idle-cleanup mechanisms in claude-sdk-adapter

**File:** `src/adapters/claude-sdk-adapter.ts:33-70`

Both a `setInterval` cleanup (every 5 min) and a `lazyCleanupIdleSessions` function (every 10th call) do identical work. The timer alone suffices.

**Fix:** Remove `lazyCleanupIdleSessions` and keep only the interval timer.

---

### #12 [Security] Config web server — no Secure cookie flag, may bind 0.0.0.0

**File:** `src/config-web.ts`

- `Secure` flag not set on cookies (comment says "for local http use")
- Server may bind to `0.0.0.0`, exposing config UI to the network
- If exposed beyond localhost, session cookies could be intercepted

**Fix:**
- Auto-detect: set `Secure` flag when not on localhost
- Default bind to `127.0.0.1` instead of `0.0.0.0`

---

### #13 [Security] Plaintext secrets in config file, no file permission protection

**File:** `~/.open-im/config.json`

All platform tokens, app secrets, and OAuth tokens stored in plaintext. No `chmod 600` applied on creation.

**Fix:** Set `0o600` permissions when creating/writing the config file.

---

### #14 [Performance] `process.chdir()` mutex serializes concurrent sessions

Same root cause as #10 (architecture dimension). Listed here to surface the performance impact: all concurrent users share a single mutex chain, meaning session create/resume operations cannot execute in parallel.

---

### #15 [Reliability] QQ WebSocket — no dead connection detection

**File:** `src/qq/client.ts`

If the QQ gateway silently drops the connection (no `close` event), the heartbeat continues sending but nothing detects the stale connection. A zombie connection could persist indefinitely.

**Fix:** Add heartbeat-based dead connection detection (like WeWork's `lastServerResponseTime` pattern). Force reconnect if no response within N × heartbeat interval.

---

### #16 [Reliability] RequestQueue — no task timeout

**File:** `src/queue/request-queue.ts`

`enqueuedAt` is recorded but never checked. A stuck running task permanently blocks the queue for that `userId:convId`.

**Fix:** Add a configurable task timeout (e.g., 10 minutes). On timeout, abort the running task and process the next queued item.

---

### #17 [Reliability] `handle.stop()` is a no-op — running AI tasks not aborted during shutdown

**File:** `src/index.ts:310-347`

Platform `handle.stop()` returns `{}` without aborting running tasks. During graceful shutdown, AI queries continue executing.

**Fix:** Implement proper `stop()` that aborts all running tasks via `runAITask` cleanup.

---

### #18 [Reliability] Telegram/QQ event handlers lack top-level try/catch

**Files:** `src/telegram/event-handler.ts`, `src/qq/event-handler.ts`

Unexpected errors (e.g., from `setChatUser`, `setActiveChatId`) can cause unhandled promise rejections.

**Fix:** Add top-level try/catch in event handlers with error logging and user-facing error message.

---

### #19 [Test] `src/shared/retry.ts` is dead code

The retry utility (`withRetry`, `NonRetryableError`) is defined but never imported anywhere. Each platform implements its own inline retry logic.

**Fix:** Either integrate `retry.ts` as the standard retry mechanism across all platforms, or remove it.

---

## Low Issues

### Architecture

- **`onSessionInvalid` in generic `ToolAdapter` interface** — leaks Claude-specific semantics into the generic adapter interface
- **`getSessionIdForThread` is a stub** — `session-manager.ts:86-88` returns `undefined`, dead code
- **DingTalk-specific code in shared module** — `DingTalkActiveTarget` interface lives in `src/shared/active-chats.ts`
- **`runAITask` at 247 lines** — `src/shared/ai-task.ts:83-329` single function with deeply nested closures

### Security

- **Incomplete sanitize patterns** — `src/sanitize.ts` does not cover JWT, Bearer tokens, or custom API key formats
- **Path traversal blocklist incomplete** — `session-manager.ts` does not block `~/.ssh`, `/var`, `/tmp`
- **SSRF protection gaps** — `media-storage.ts` does not handle DNS rebinding or IPv6-mapped IPv4 (`::ffff:127.0.0.1`)
- **Telegram callback `userId` not validated** — `telegram/event-handler.ts:393-421` embeds userId in callback data but doesn't verify against actual clicking user

### Performance

- **Synchronous `readFileSync` for Feishu image sending** — `feishu/message-sender.ts:442` blocks event loop per image
- **chat-user-map cleanup by insertion order, not LRU** — `chat-user-map.ts` may delete frequently-used entries
- **DingTalk stream state cleanup too slow** — `dingtalk/message-sender.ts:66-76` cleans one entry per 30 minutes

### Reliability

- **WeWork `senderCtx.reqId` mutation** — assumes sequential WebSocket delivery, fragile if protocol changes
- **WorkBuddy `processedMsgIds` no TTL** — size-only cleanup, entries persist until 1000 limit
- **No double-shutdown guard** — `index.ts` shutdown can fire twice from SIGINT + SIGTERM
- **`ai-task.ts` overlapping retry with platform handlers** — `sendCompleteWithRetry` (2 retries) + Telegram handler (3 retries) = up to 6 attempts

---

## Positive Findings

- **Clean layered architecture** — platforms → event handlers → queue → AI adapters → CLI/SDK runners
- **Consistent platform patterns** — all 6 platforms follow client/event-handler/message-sender triad
- **No hardcoded secrets** — all credentials from env vars or config file
- **Good error isolation** — one platform failing does not prevent others from starting
- **WeWork best-in-class reconnection** — heartbeat-based dead detection, exponential backoff, 100-attempt reset
- **Feishu patch API resilience** — failure counting with auto-disable and timed recovery
- **Good SSRF protection** — blocks private IPs, localhost, link-local addresses
- **Well-managed intervals** — all `setInterval` calls use `.unref()` and have cleanup mechanisms
- **All 74 existing tests pass**

---

## Recommended Fix Priority

| Phase | Issues | Effort |
|-------|--------|--------|
| **P0 — Immediate** | #1 (build fix) | 1 hour |
| **P1 — Short term** | #5 (security), #8 (unused deps), #13 (file permissions) | 2-3 hours |
| **P2 — Medium term** | #2 (platform abstraction), #3 (config decomposition), #4 (DingTalk split) | 1-2 weeks |
| **P3 — Long term** | #7 (test coverage), #6 (async I/O), #10 (chdir mutex) | 2-4 weeks |
