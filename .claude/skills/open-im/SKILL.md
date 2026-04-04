```markdown
# open-im Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches you the core development patterns, coding conventions, and collaborative workflows used in the `open-im` TypeScript codebase. The repository implements multi-platform chat AI integrations (e.g., QQ, Feishu, WeWork, DingTalk, Telegram) with a focus on maintainability, modularity, and test coverage. You'll learn how to structure code, refactor for shared abstractions, manage task queues and sessions, write and enhance tests, and document or update design plans.

---

## Coding Conventions

**File Naming**
- Use `kebab-case` for all file names.
  - Example: `event-handler.ts`, `handle-ai-request.ts`

**Import Style**
- Use relative imports.
  - Example:
    ```typescript
    import { handleAIRequest } from './handle-ai-request'
    ```

**Export Style**
- Use named exports.
  - Example:
    ```typescript
    export function createEventContext() { ... }
    ```

**Commit Messages**
- Follow [Conventional Commits](https://www.conventionalcommits.org/) with prefixes such as `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
  - Example: `feat: add session timeout support to session manager`

---

## Workflows

### Refactor Platform Event Handlers to Shared Abstractions
**Trigger:** When you want to unify and simplify event handling logic across multiple chat platforms.  
**Command:** `/refactor-platform-event-handlers`

1. Create or update shared abstraction modules in `src/platform/`:
    - `create-event-context.ts`
    - `handle-ai-request.ts`
    - `handle-text-flow.ts`
2. Refactor each platform's `event-handler.ts` to use these abstractions:
    - Example:
      ```typescript
      // Before
      import { handleAIRequest } from '../ai/handler'
      // Custom logic...

      // After
      import { createPlatformAIRequestHandler } from '../platform/handle-ai-request'
      ```
3. Update or add tests for the shared abstractions and platform event handlers.
4. Adjust any platform-specific logic to fit the new abstraction interfaces.
5. Update documentation or plans if necessary.

**Files Involved:**  
`src/platform/create-event-context.ts`, `src/platform/handle-ai-request.ts`, `src/platform/handle-text-flow.ts`,  
`src/qq/event-handler.ts`, `src/feishu/event-handler.ts`, `src/wework/event-handler.ts`,  
`src/workbuddy/event-handler.ts`, `src/dingtalk/event-handler.ts`, `src/telegram/event-handler.ts`,  
`src/platform/create-event-context.test.ts`, `src/platform/handle-ai-request.test.ts`, `src/platform/handle-text-flow.test.ts`

---

### Add or Enhance Task Queue or Session Management
**Trigger:** When you want to improve how queued tasks or sessions are managed, aborted, or persisted.  
**Command:** `/improve-task-queue`

1. Implement new features or fixes in:
    - `src/queue/request-queue.ts`
    - `src/session/session-manager.ts`
2. Update or add corresponding test files:
    - `request-queue.test.ts`
    - `session-manager.test.ts`
3. Update related `event-handler.ts` files to use the new or updated logic.
4. Update documentation or plans if needed.

**Example:**  
Add abort signal support to the queue:
```typescript
export function enqueueTask(task, abortSignal) { ... }
```

---

### Add or Update Comprehensive Design or Implementation Plans
**Trigger:** When you want to document or update major project plans or technical designs.  
**Command:** `/add-design-spec`

1. Create or update markdown files in:
    - `docs/superpowers/specs/`
    - `docs/superpowers/plans/`
2. Add, update, or remove checkboxes to reflect progress.
3. Remove outdated or superseded specs/plans as needed.

**Example:**  
```markdown
- [x] Refactor event handling
- [ ] Implement session persistence
```

---

### Decompose Monolithic Module into Focused Submodules
**Trigger:** When you want to improve code structure by breaking up a large file into logical submodules.  
**Command:** `/decompose-module`

1. Extract related logic into new submodule files (e.g., `types.ts`, `file-io.ts`, `credentials.ts`).
2. Reduce the main module file by moving code into submodules and keeping only necessary exports.
3. Update import paths throughout the codebase as needed.
4. Test to ensure no regressions.

**Example:**  
```typescript
// src/config/types.ts
export interface ConfigOptions { ... }

// src/config.ts
export * from './config/types'
export * from './config/file-io'
```

---

### Add or Enhance Test Coverage for Core Modules
**Trigger:** When you want to increase test coverage or add tests for new features in core modules.  
**Command:** `/add-tests`

1. Write or update test files for the relevant module (e.g., `request-queue.test.ts`, `session-manager.test.ts`).
2. Adjust module code if needed to improve testability.
3. Update test configuration or coverage thresholds (see `vitest.config.ts`).
4. Run tests and ensure coverage goals are met.

**Example:**  
```typescript
import { describe, it, expect } from 'vitest'
import { RequestQueue } from './request-queue'

describe('RequestQueue', () => {
  it('should enqueue and dequeue tasks', () => {
    // test logic
  })
})
```

---

## Testing Patterns

- **Test Framework:** [Vitest](https://vitest.dev/)
- **Test File Pattern:** Files end with `.test.ts` and are placed alongside implementation files.
- **Test Structure:** Use `describe`, `it`, and `expect`.
- **Coverage:** Core modules and abstractions have dedicated test files.
- **Example:**
  ```typescript
  // src/queue/request-queue.test.ts
  import { describe, it, expect } from 'vitest'
  import { RequestQueue } from './request-queue'

  describe('RequestQueue', () => {
    it('handles tasks sequentially', () => {
      // test logic
    })
  })
  ```

---

## Commands

| Command                              | Purpose                                                                                  |
|-------------------------------------- |------------------------------------------------------------------------------------------|
| /refactor-platform-event-handlers     | Refactor platform event handlers to use shared abstractions                              |
| /improve-task-queue                  | Add or enhance task queue or session management features                                 |
| /add-design-spec                     | Add, update, or remove comprehensive design or implementation plans                      |
| /decompose-module                    | Decompose a monolithic module into focused submodules                                    |
| /add-tests                           | Add or enhance test coverage for core modules                                            |

---
```