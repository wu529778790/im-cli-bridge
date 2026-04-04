# Code Quality Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 18 code quality issues identified in the code review (3 Critical, 7 Important, 8 Minor).

**Architecture:** Targeted fixes per issue. Large-scale refactors (setup.ts dedup, config.ts dedup, platform client state) are deferred to a separate plan as they carry high regression risk and need dedicated testing.

**Tech Stack:** TypeScript, Node.js, Vitest

---

### Task 1: Fix taskCallbacksFactory double call (Critical)

**Files:**
- Modify: `src/platform/handle-ai-request.ts:253`

The factory is called twice — capture `extraCleanup` from the first call result.

- [ ] **Step 1:** Read `src/platform/handle-ai-request.ts` around lines 207-260
- [ ] **Step 2:** Save the factory result at line 209 to a local variable, use it for both callback merging and `extraCleanup` extraction at line 253
- [ ] **Step 3:** Run `npx tsc --noEmit` — expect pass
- [ ] **Step 4:** Run `npm test` — expect all tests pass
- [ ] **Step 5:** Commit: `fix: avoid double taskCallbacksFactory invocation in handle-ai-request`

---

### Task 2: Downgrade access control logging to DEBUG (Critical)

**Files:**
- Modify: `src/access/access-control.ts:10,19`

Change `log.info` to `log.debug` for user ID logging to reduce log noise and PII exposure.

- [ ] **Step 1:** Read `src/access/access-control.ts`
- [ ] **Step 2:** Change line 10 (`log.info` allowed users list) to `log.debug`
- [ ] **Step 3:** Change line 19 (`log.info` checking user) to `log.debug`
- [ ] **Step 4:** Run `npm test` — expect all tests pass
- [ ] **Step 5:** Commit: `fix: downgrade access control logging from INFO to DEBUG`

---

### Task 3: Deduplicate isRunning function (Important)

**Files:**
- Modify: `src/manager-control.ts:31-45`
- Import from `src/service-control.ts:56-70`

Remove the private duplicate in manager-control.ts, import the exported one from service-control.ts.

- [ ] **Step 1:** Read `src/manager-control.ts` and `src/service-control.ts`
- [ ] **Step 2:** Add import `{ isRunning }` from service-control in manager-control.ts, remove local function
- [ ] **Step 3:** Run `npx tsc --noEmit` — expect pass
- [ ] **Step 4:** Run `npm test` — expect all tests pass
- [ ] **Step 5:** Commit: `refactor: deduplicate isRunning by importing from service-control`

---

### Task 4: Fix request queue timeout error propagation (Important)

**Files:**
- Modify: `src/queue/request-queue.ts:53-78`

Surface timeout errors to users instead of silently swallowing them.

- [ ] **Step 1:** Read `src/queue/request-queue.ts`
- [ ] **Step 2:** In the catch block, re-throw the error (or call an error callback) so callers can notify users. Create a custom `QueueTimeoutError` class for distinguishable errors.
- [ ] **Step 3:** Run `npx tsc --noEmit` — expect pass
- [ ] **Step 4:** Run `npm test` — expect all tests pass
- [ ] **Step 5:** Commit: `fix: propagate queue timeout errors to callers`

---

### Task 5: Redact sensitive data in logs (Important)

**Files:**
- Modify: `src/wework/client.ts:144`
- Modify: `src/feishu/client.ts:63,74,88`
- Modify: `src/feishu/event-handler.ts:214`
- Modify: `src/wework/event-handler.ts:348`
- Modify: `src/workbuddy/client.ts:183,205`
- Modify: `src/sanitize.ts`

Downgrade verbose event logging to DEBUG and expand the sanitizer to cover more credential types.

- [ ] **Step 1:** Read all affected files and `src/sanitize.ts`
- [ ] **Step 2:** In sanitize.ts, add patterns for generic secrets (long alphanumeric strings after known field names)
- [ ] **Step 3:** Downgrade full-event-payload logs from INFO to DEBUG across all platform clients
- [ ] **Step 4:** Remove or redact botId from WeWork init log
- [ ] **Step 5:** Run `npx tsc --noEmit` — expect pass
- [ ] **Step 6:** Run `npm test` — expect all tests pass
- [ ] **Step 7:** Commit: `fix: redact sensitive data in logs and downgrade verbose event logging`

---

### Task 6: Fix logger initialization timing (Important)

**Files:**
- Modify: `src/logger.ts`
- Modify: `src/index.ts`

Move `initLogger()` call earlier in `main()` so early log messages are captured to file.

- [ ] **Step 1:** Read `src/index.ts` to understand the main() flow and what needs to happen before logging can init
- [ ] **Step 2:** Move `initLogger()` call to the earliest safe point in main() (after config dir is known, before platform init)
- [ ] **Step 3:** Run `npx tsc --noEmit` — expect pass
- [ ] **Step 4:** Run `npm test` — expect all tests pass
- [ ] **Step 5:** Commit: `fix: move initLogger earlier to capture startup logs`

---

### Task 7: Document process.chdir() limitation (Critical)

**Files:**
- Modify: `src/adapters/claude-sdk-adapter.ts`

The process.chdir() mutex is already well-documented and correctly serialized. The real fix requires upstream SDK support for a `cwd` option. Add a clear TODO with tracking info.

- [ ] **Step 1:** Read `src/adapters/claude-sdk-adapter.ts:84-107`
- [ ] **Step 2:** Add a TODO comment referencing the upstream SDK issue and noting this should be removed when SDK supports cwd
- [ ] **Step 3:** Commit: `docs: add TODO for process.chdir removal when SDK supports cwd`

---

### Task 8: Minor cleanups

**Files:**
- Various

Fix dead i18n keys, magic numbers, inconsistent patterns.

- [ ] **Step 1:** Search for unused exports and dead code
- [ ] **Step 2:** Remove any remaining dead i18n keys not caught earlier
- [ ] **Step 3:** Replace magic numbers with named constants where applicable
- [ ] **Step 4:** Run `npm test` — expect all tests pass
- [ ] **Step 5:** Commit: `chore: minor code quality cleanups`

---

### Deferred to separate plan

These require large-scale refactoring with high regression risk:

- **setup.ts dedup** (1237 lines → extract platform config builder)
- **config.ts dedup** (568 lines → use existing credentials.ts helpers)
- **Platform client module-level state** (all 6 clients → encapsulate in classes)
