# Plan 1: Build Fix + Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken build, remove dead code, and apply critical security hardening.

**Architecture:** Targeted fixes to existing files — no structural changes. Each task is independent and produces a working build.

**Tech Stack:** TypeScript, Node.js, vitest

**Spec:** `docs/superpowers/specs/2026-04-03-project-diagnosis-design.md` — issues #1, #5, #8, #13, #19

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/shared/task-cleanup.ts` | Periodic cleanup of stale running tasks |
| Modify | `src/workbuddy/centrifuge-client.ts:122,171` | Add explicit `any` type annotations to `ctx` parameters |
| Modify | `src/shared/ai-task.ts:293` | Make `skipPermissions` configurable |
| Modify | `src/config.ts` | Add `skipPermissions` to config type and loader |
| Modify | `src/access/access-control.ts` | Warn loudly when whitelist is empty |
| Modify | `src/setup.ts:1114,1231` | Add `chmod 600` after writing config |
| Modify | `src/config.ts:307` | Add `chmod 600` after migration write |
| Modify | `package.json` | Remove `qrcode-terminal`, `@types/qrcode-terminal`, `qq-official-bot` |
| Delete | `src/shared/retry.ts` | Dead code removal |

---

### Task 1: Install missing `centrifuge` package

**Files:**
- Modify: `package.json` (lockfile update)

- [ ] **Step 1: Run npm install**

```bash
npm install
```

Expected: `centrifuge` package installed, `node_modules/centrifuge` exists.

- [ ] **Step 2: Verify centrifuge types are available**

```bash
ls node_modules/centrifuge/dist/
```

Expected: Type declaration files present.

---

### Task 2: Create missing `task-cleanup.ts` module

**Files:**
- Create: `src/shared/task-cleanup.ts`
- Reference: `src/workbuddy/event-handler.ts:13` (consumer)

The `event-handler.ts` expects:
```typescript
import { startTaskCleanup } from '../shared/task-cleanup.js';
// Usage:
const stopTaskCleanup = startTaskCleanup(runningTasks); // Map<string, TaskRunState>
// Returns: () => void (stop function)
```

- [ ] **Step 1: Write the test**

Create `src/shared/task-cleanup.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startTaskCleanup } from './task-cleanup.js';
import type { TaskRunState } from './ai-task.js';

describe('startTaskCleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should remove stale tasks older than 30 minutes', () => {
    const runningTasks = new Map<string, TaskRunState>();
    const staleDate = Date.now() - 31 * 60 * 1000;
    const freshDate = Date.now() - 10 * 60 * 1000;

    runningTasks.set('stale', {
      handle: { abort: vi.fn() },
      latestContent: '',
      settle: vi.fn(),
      startedAt: staleDate,
    } as TaskRunState);
    runningTasks.set('fresh', {
      handle: { abort: vi.fn() },
      latestContent: '',
      settle: vi.fn(),
      startedAt: freshDate,
    } as TaskRunState);

    const stop = startTaskCleanup(runningTasks);

    // Advance past the cleanup interval (5 minutes)
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(runningTasks.has('stale')).toBe(false);
    expect(runningTasks.has('fresh')).toBe(true);
    expect(runningTasks.get('fresh')!.handle.abort).not.toHaveBeenCalled();

    stop();
  });

  it('should return a stop function that clears the interval', () => {
    const runningTasks = new Map<string, TaskRunState>();
    const stop = startTaskCleanup(runningTasks);

    // After stopping, advancing time should not trigger cleanup
    const staleDate = Date.now() - 31 * 60 * 1000;
    runningTasks.set('stale', {
      handle: { abort: vi.fn() },
      latestContent: '',
      settle: vi.fn(),
      startedAt: staleDate,
    } as TaskRunState);

    stop();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    // Should still be there because cleanup was stopped
    expect(runningTasks.has('stale')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/shared/task-cleanup.test.ts
```

Expected: FAIL — `Cannot find module './task-cleanup.js'`

- [ ] **Step 3: Write implementation**

Create `src/shared/task-cleanup.ts`:

```typescript
import { createLogger } from '../logger.js';
import type { TaskRunState } from './ai-task.js';

const log = createLogger('TaskCleanup');

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Starts a periodic cleanup interval that aborts and removes stale running tasks.
 * Returns a stop function to clear the interval.
 */
export function startTaskCleanup(runningTasks: Map<string, TaskRunState>): () => void {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, state] of runningTasks) {
      const age = now - (state.startedAt ?? 0);
      if (age > STALE_THRESHOLD_MS) {
        log.warn(`Aborting stale task ${key} (age: ${Math.round(age / 1000)}s)`);
        state.handle.abort();
        runningTasks.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS).unref();

  return () => {
    clearInterval(timer);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/shared/task-cleanup.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/shared/task-cleanup.ts src/shared/task-cleanup.test.ts
git commit -m "feat: add task-cleanup module for stale running task cleanup"
```

---

### Task 3: Fix `ctx` type annotations in centrifuge-client.ts

**Files:**
- Modify: `src/workbuddy/centrifuge-client.ts:122,171`

- [ ] **Step 1: Add explicit `any` type to line 122**

Change:
```typescript
    this.sub.on('publication', (ctx) => {
```
To:
```typescript
    this.sub.on('publication', (ctx: any) => {
```

- [ ] **Step 2: Add explicit `any` type to line 171**

Change:
```typescript
    sub.on('publication', (ctx) => {
```
To:
```typescript
    sub.on('publication', (ctx: any) => {
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

Expected: 0 errors (all 4 TS errors should now be resolved)

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: All tests pass (74+ tests)

- [ ] **Step 5: Commit**

```bash
git add src/workbuddy/centrifuge-client.ts
git commit -m "fix: add explicit type annotations to Centrifuge publication handlers"
```

---

### Task 4: Remove unused dependencies

**Files:**
- Modify: `package.json`
- Delete: `src/shared/retry.ts`

- [ ] **Step 1: Verify `qrcode-terminal` is truly unused**

```bash
grep -r "qrcode" src/ || echo "No matches found"
```

Expected: "No matches found"

- [ ] **Step 2: Verify `qq-official-bot` is truly unused**

```bash
grep -r "qq-official-bot" src/ || echo "No matches found"
```

Expected: "No matches found"

- [ ] **Step 3: Verify `retry.ts` is truly unused**

```bash
grep -r "from.*retry" src/ --include="*.ts" | grep -v "retry.test" || echo "No imports found"
```

Expected: "No imports found" (the file defines but nobody imports it)

- [ ] **Step 4: Remove packages from package.json**

Remove from `dependencies`:
- `"qrcode-terminal": "^0.12.0"`
- `"qq-official-bot": "^1.0.12"`

Remove from `devDependencies`:
- `"@types/qrcode-terminal": "^0.12.2"`

- [ ] **Step 5: Delete retry.ts**

```bash
rm src/shared/retry.ts
```

- [ ] **Step 6: Run npm install to update lockfile**

```bash
npm install
```

Expected: Packages removed, lockfile updated.

- [ ] **Step 7: Verify build and tests still pass**

```bash
npm run build && npm test
```

Expected: Build succeeds, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json
git rm src/shared/retry.ts
git commit -m "chore: remove unused dependencies (qrcode-terminal, qq-official-bot, retry.ts)"
```

---

### Task 5: Make `skipPermissions` configurable

**Files:**
- Modify: `src/config.ts` — add `skipPermissions` field to config type and loader
- Modify: `src/shared/ai-task.ts:293` — read from config instead of hardcoding

- [ ] **Step 1: Add `skipPermissions` to config type**

In `src/config.ts`, find the config type/interface (search for `skipPermissions` or `claudeModel` to locate the config type) and add:

```typescript
skipPermissions?: boolean;
```

Default should be `true` (current behavior) for backwards compatibility.

In the `loadConfig` function, resolve the value:
```typescript
skipPermissions: process.env.OPEN_IM_SKIP_PERMISSIONS === 'false' ? false : (fileConfig.skipPermissions ?? true),
```

- [ ] **Step 2: Update ai-task.ts to use config value**

In `src/shared/ai-task.ts`, find line 293 and change:

```typescript
            skipPermissions: true,
```

To:

```typescript
            skipPermissions: config.skipPermissions ?? true,
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

Expected: 0 errors

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/shared/ai-task.ts
git commit -m "feat: make skipPermissions configurable via config and env var"
```

---

### Task 6: Strengthen access control warnings

**Files:**
- Modify: `src/access/access-control.ts:13-17`

- [ ] **Step 1: Upgrade empty-whitelist warning**

In `src/access/access-control.ts`, change the `isAllowed` method's empty whitelist handling:

```typescript
  isAllowed(userId: string): boolean {
    if (this.allowedUserIds.size === 0) {
      log.warn(`⚠️ SECURITY: Allowing user ${userId} — no whitelist configured. Set allowedUserIds in config or OPEN_IM_ALLOWED_USER_IDS env var to restrict access.`);
      return true;
    }
    const allowed = this.allowedUserIds.has(userId);
    log.info(`Checking user ${userId}: ${allowed ? 'ALLOWED' : 'DENIED'}`);
    return allowed;
  }
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/access/access-control.ts
git commit -m "fix: strengthen access control warning when no whitelist is configured"
```

---

### Task 7: Set restrictive file permissions on config file

**Files:**
- Modify: `src/setup.ts:1114,1231` — add `chmodSync` after write
- Modify: `src/config.ts:307` — add `chmodSync` after migration write

- [ ] **Step 1: Add chmodSync import to setup.ts**

At the top of `src/setup.ts`, add `chmodSync` to the existing `fs` import:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
```

- [ ] **Step 2: Add chmodSync after config write at line 1114**

After `writeFileSync(configPath, JSON.stringify(out, null, 2), "utf-8");` add:

```typescript
  try { chmodSync(configPath, 0o600); } catch { /* ignore on unsupported platforms */ }
```

- [ ] **Step 3: Add chmodSync after config write at line 1231**

After `writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf-8");` add:

```typescript
  try { chmodSync(configPath, 0o600); } catch { /* ignore on unsupported platforms */ }
```

- [ ] **Step 4: Add chmodSync import to config.ts**

At the top of `src/config.ts`, add `chmodSync` to the existing `fs` import.

- [ ] **Step 5: Add chmodSync after migration write in config.ts**

After `writeFileSync(CONFIG_PATH, JSON.stringify(migrated, null, 2), 'utf-8');` (line 307) add:

```typescript
      try { chmodSync(CONFIG_PATH, 0o600); } catch { /* ignore */ }
```

- [ ] **Step 6: Verify build and tests**

```bash
npm run build && npm test
```

Expected: Build succeeds, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/setup.ts src/config.ts
git commit -m "fix: set restrictive permissions (0600) on config file containing secrets"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full build check**

```bash
npm run build
```

Expected: 0 errors, 0 warnings

- [ ] **Step 2: Full test suite**

```bash
npm test
```

Expected: All tests pass (75+ tests, including the new task-cleanup tests)

- [ ] **Step 3: Lint check**

```bash
npm run lint
```

Expected: No errors (warnings for `any` types are acceptable per eslint config)

- [ ] **Step 4: Verify clean state**

```bash
git status
```

Expected: Working tree clean

---

## Self-Review Checklist

**1. Spec coverage:**
- #1 (build fix) → Tasks 1, 2, 3
- #5 (skipPermissions) → Tasks 5, 6
- #8 (unused deps) → Task 4
- #13 (file permissions) → Task 7
- #19 (dead retry.ts) → Task 4

**2. Placeholder scan:** No TBD, TODO, or "implement later" found. All steps contain exact code.

**3. Type consistency:** `TaskRunState` imported from `./ai-task.js` in task-cleanup.ts matches the type used in event-handler.ts. `skipPermissions` field is `boolean` in config and consumed as `boolean` in ai-task.ts.
