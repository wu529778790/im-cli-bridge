# Open-IM Comprehensive Optimization Design

**Date:** 2026-04-02
**Status:** Approved
**Strategy:** Layered Incremental (Approach A)
**Constraint:** Production system with existing users - every step must be independently verifiable and reversible.

---

## Overview

Full optimization of the open-im project across 5 layers: Security, Architecture, Frontend, Testing, and Quality. Each layer can be deployed independently without affecting other layers.

---

## Layer 1: Security

**Goal:** Eliminate all known security risks without changing business logic.

### 1.1 npm Vulnerabilities (6 total)

Run `npm audit fix` to resolve:
- `axios` DoS via unbounded data size (HIGH, via qq-official-bot)
- `axios` prototype pollution in mergeConfig (HIGH, via qq-official-bot)
- `flatted` prototype pollution via parse() (HIGH)
- `picomatch` method injection in POSIX char classes (HIGH)
- `picomatch` ReDoS via extglob quantifiers (HIGH)
- `brace-expansion` zero-step sequence hang (MODERATE)

If `qq-official-bot` pins an old axios that can't auto-fix, evaluate forking or finding an alternative QQ bot library.

### 1.2 XSS Fix

Files: `src/config-web-page-script.ts` lines 291, 306

Replace `innerHTML` assignments with DOM API:
```typescript
// Before
helpBlock.innerHTML = t(key);
// After
helpBlock.textContent = ''; // clear
// Use DOMParser or createElement for intentional HTML content
```

### 1.3 Empty catch Blocks (59 instances)

Add error logging to all `catch {}` blocks. For cleanup/close operations, add `/* ignore: cleanup */` comment. For critical paths, add `log.warn('Context message', err)`.

Priority files:
- `src/config.ts` (11 instances)
- `src/service-control.ts` (5 instances)
- `src/manager-control.ts` (6 instances)
- `src/shared/active-chats.ts` (3 instances)

### 1.4 ESM Consistency

Replace 2 `require()` calls with ESM imports:
- `src/check-update.ts:12` - `require("../package.json")` → `import pkg from "../package.json" assert { type: "json" }` or read at build time
- `src/index.ts:41` - same pattern

### 1.5 Remove Global console.warn Monkey-Patch

File: `src/dingtalk/client.ts:56-57`

Replace global `console.warn` override with a local filtering approach:
```typescript
// Instead of monkey-patching console.warn globally,
// configure the DingTalk SDK's logger or wrap the specific callback
```

---

## Layer 2: Architecture

**Goal:** Eliminate duplicate code, decompose large functions, improve maintainability.

### 2.1 Shared Reconnect Manager

New file: `src/shared/reconnect-manager.ts`

Unify reconnect logic from 4 platform clients:
- `src/qq/client.ts` - `RECONNECT_DELAYS_MS`, `scheduleReconnect`
- `src/wework/client.ts` - retry with backoff formula
- `src/workbuddy/client.ts` - `RECONNECT_DELAYS_MS`
- `src/telegram/client.ts` - recursive `launchWithRetry()`

API:
```typescript
interface ReconnectConfig {
  delays: number[];           // backoff delays in ms
  maxAttempts?: number;       // optional cap
  onConnect: () => Promise<void>;
  onMaxRetries?: () => void;
}

class ReconnectManager {
  start(config: ReconnectConfig): void;
  stop(): void;
  reset(): void;
}
```

### 2.2 Shared Throttle Sender

New file: `src/shared/throttle-sender.ts`

Unify message throttle queue from 4 platform message-senders:
- `src/dingtalk/message-sender.ts:66`
- `src/telegram/message-sender.ts:22`
- `src/wework/message-sender.ts:144`
- `src/qq/message-sender.ts:21`

API:
```typescript
interface ThrottleConfig {
  intervalMs: number;
  maxQueueSize?: number;
  send: (message: SendMessagePayload) => Promise<void>;
}

class ThrottleSender {
  enqueue(message: SendMessagePayload): void;
  flush(): Promise<void>;
  destroy(): void;
}
```

### 2.3 Shared Platform Probe

New file: `src/shared/platform-probe.ts`

Unify 6 nearly identical `probe*` functions in `src/config-web.ts` (lines 484-612).

API:
```typescript
interface ProbeConfig {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: unknown;
  validate: (response: unknown) => boolean;
}

function probeCredentials(config: ProbeConfig): Promise<ProbeResult>;
```

### 2.4 Decompose Large Functions

#### `setup.ts: runInteractiveSetup()` (849 lines → ~80 lines + 6 platform files)

Split into per-platform setup functions:
- `src/setup/telegram.ts` - `setupTelegram()`
- `src/setup/feishu.ts` - `setupFeishu()`
- `src/setup/wework.ts` - `setupWeWork()`
- `src/setup/dingtalk.ts` - `setupDingTalk()`
- `src/setup/qq.ts` - `setupQQ()`
- `src/setup/workbuddy.ts` - `setupWorkBuddy()`

Main function becomes an orchestrator that calls each platform's setup function.

#### `config.ts: loadConfig()` (450 lines → 3 focused functions)

- `resolveCredentials(env, fileConfig)` - maps env vars to platform config
- `validateConfig(config)` - validates required fields per platform
- `migrateConfig(config)` - handles legacy config format migration

#### `config-web.ts: startWebConfigServer()` (390 lines → 2 functions)

- `registerRoutes(app, config)` - all route registration
- `createConfigServer(config)` - server creation and startup

### 2.5 Platform Initialization Registry

Replace 6 repeated if/try/catch blocks in `src/index.ts` (lines 225-281) with:

```typescript
const PLATFORM_REGISTRY: Record<Platform, PlatformModule> = {
  telegram: { setup: setupTelegramHandlers, init: initTelegram },
  feishu:   { setup: setupFeishuHandlers,  init: initFeishu },
  wework:   { setup: setupWeWorkHandlers,  init: initWeWork },
  dingtalk: { setup: setupDingTalkHandlers, init: initDingTalk },
  qq:       { setup: setupQQHandlers,       init: initQQ },
  workbuddy:{ setup: setupWorkBuddyHandlers,init: initWorkBuddy },
};

for (const [name, mod] of Object.entries(PLATFORM_REGISTRY)) {
  if (!config.enabledPlatforms.includes(name as Platform)) continue;
  try {
    const handle = mod.setup(config, sessionManager);
    await mod.init(config, handle.handleEvent);
    successfulPlatforms.push(name as Platform);
  } catch (err) {
    log.error(`Failed to initialize ${name}:`, err);
  }
}
```

---

## Layer 3: Frontend Extraction

**Goal:** Move ~2600 lines of embedded web config UI to a separate frontend project.

### 3.1 New Project Structure

```
open-im/
├── src/                          # Existing backend
├── web/                          # New frontend project
│   ├── package.json              # Vite + vanilla TypeScript
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.ts               # Entry point
│       ├── api.ts                # Backend API client
│       ├── i18n/
│       │   ├── zh-CN.ts
│       │   └── en.ts
│       ├── components/
│       │   ├── PlatformForm.ts
│       │   ├── Navbar.ts
│       │   └── Toast.ts
│       └── styles/
│           └── main.css
```

### 3.2 Build Integration

- `web/` builds with Vite, output to `web/dist/`
- `src/config-web.ts` reads `web/dist/index.html` for static serving
- Main project build script: `"build": "npm run build:web && tsc"`
- Dev mode: `web/` runs `vite dev` with proxy to backend API

### 3.3 File Migration Map

| Source File | Lines | Destination |
|-------------|-------|-------------|
| `src/config-web-page-template.ts` | 1350 | `web/index.html` + components |
| `src/config-web-page-script.ts` | 931 | `web/src/` TypeScript modules |
| `src/config-web-page-i18n.ts` | 310 | `web/src/i18n/zh-CN.ts` + `en.ts` |

### 3.4 Backend Changes

`src/config-web.ts` simplified to:
- Serve static files from `web/dist/`
- Provide JSON API endpoints (unchanged)
- Remove all inline HTML/JS/i18n template code

---

## Layer 4: Testing

**Goal:** Core module test coverage to 80%+.

### 4.1 Batch 1: Core Infrastructure (Priority: CRITICAL)

| Module | Test File | Key Test Cases |
|--------|-----------|----------------|
| `shared/ai-task.ts` | Extend `ai-task.test.ts` | Streaming, error recovery, timeout, cleanup |
| `adapters/claude-sdk-adapter.ts` | New `claude-sdk-adapter.test.ts` | SDK calls, session management, cwd mutex |
| `session/session-manager.ts` | New `session-manager.test.ts` | Persistence, expiry cleanup, concurrent access |
| `queue/request-queue.ts` | New `request-queue.test.ts` | Queue overflow (max 3), priority, cancellation |
| `access/access-control.ts` | New `access-control.test.ts` | Whitelist validation, empty list = allow all |
| `commands/handler.ts` | New `handler.test.ts` | Command routing, parameter parsing |
| `shared/retry.ts` | New `retry.test.ts` | Backoff strategy, max retries, NonRetryableError |

### 4.2 Batch 2: New Shared Modules (after Architecture layer)

| Module | Test File | Key Test Cases |
|--------|-----------|----------------|
| `shared/reconnect-manager.ts` | New test | Various backoff strategies, retry limits, reset |
| `shared/throttle-sender.ts` | New test | Rate limiting, queue overflow, flush |
| `shared/platform-probe.ts` | New test | Credential validation per platform |

### 4.3 Batch 3: Platform Event Handlers

| Module | Test File | Key Test Cases |
|--------|-----------|----------------|
| `telegram/event-handler.ts` | New test | Command routing, message type detection |
| `feishu/event-handler.ts` | New test | Event types, Card callback handling |
| `dingtalk/event-handler.ts` | New test | Message parsing, command extraction |
| `qq/event-handler.ts` | Extend existing | Additional message types, edge cases |

---

## Layer 5: Quality

**Goal:** Improve code quality standards and enforce via tooling.

### 5.1 Eliminate `any` Types (9 instances)

| File | Count | Fix |
|------|-------|-----|
| `src/workbuddy/centrifuge-client.ts` | 7 | Import and use Centrifuge library's context types |
| `src/feishu/message-sender.ts` | 2 | Define `CardElement` and `CardConfig` interfaces |

### 5.2 Unified Logger

- `src/cli.ts` (26 instances): Keep `console.log` for CLI stdout output; change `console.error` to logger
- `src/setup.ts` (55 instances): Keep `console.log` for interactive prompts; change error/warning to logger

### 5.3 Extract Constants

Create `src/constants/` directory:
- `reconnect.ts` - All platform reconnect parameters
- `api-urls.ts` - All hardcoded API endpoint URLs
- `timeouts.ts` - All timeout/delay values

### 5.4 ESLint Strictening

```javascript
// eslint.config.js changes
rules: {
  '@typescript-eslint/no-explicit-any': 'error',  // was 'warn'
  'no-console': ['error', { allow: ['log'] }],    // error/warn → logger
}
// Keep console allowed in web/ directory
```

### 5.5 Add Prettier

Add `.prettierrc`:
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

Add script: `"format": "prettier --write 'src/**/*.ts'"`

### 5.6 CI Pipeline for PRs

New file: `.github/workflows/ci.yml`

```yaml
name: CI
on:
  pull_request:
    branches: [main, dev]
  push:
    branches: [main, dev]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test
```

---

## Execution Order

| Phase | Layer | Estimated Files Changed | Risk |
|-------|-------|------------------------|------|
| 1 | Security | ~10 | Very Low |
| 2 | Architecture (shared modules) | ~15 new/modified | Low |
| 3 | Architecture (decompose functions) | ~20 | Low-Medium |
| 4 | Frontend extraction | ~10 new files, ~5 modified | Medium |
| 5 | Testing (batch 1) | ~7 new | Low |
| 6 | Testing (batch 2-3) | ~10 new | Low |
| 7 | Quality | ~30+ modified | Low |
| 8 | CI | 1 new | Very Low |

Each phase should be a separate PR that can be reviewed and deployed independently.
