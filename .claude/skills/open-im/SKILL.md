```markdown
# open-im Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill introduces the core development patterns and conventions used in the `open-im` TypeScript codebase. It covers file naming, import/export styles, commit message conventions, and testing patterns, providing practical examples and suggested commands for common workflows. This guide is ideal for contributors aiming for consistency and best practices in `open-im`.

## Coding Conventions

### File Naming
- Use **camelCase** for filenames.
  - Example: `userService.ts`, `messageHandler.ts`

### Import Style
- Use **relative imports** for referencing modules.
  - Example:
    ```typescript
    import { sendMessage } from './messageHandler';
    ```

### Export Style
- Use **named exports** to expose functions, classes, or constants.
  - Example:
    ```typescript
    // messageHandler.ts
    export function sendMessage(msg: string) {
      // implementation
    }
    ```

### Commit Messages
- Follow **Conventional Commits** with the `feat` prefix for new features.
  - Example:
    ```
    feat: add user presence tracking to chat module
    ```

## Workflows

### Feature Development
**Trigger:** When adding a new feature or module  
**Command:** `/feature-dev`

1. Create a new file using camelCase naming.
2. Implement your feature using TypeScript.
3. Use relative imports to include dependencies.
4. Export your functions or classes using named exports.
5. Write corresponding tests in a `.test.ts` file.
6. Commit your changes using the conventional commit format:
    ```
    feat: short description of the feature
    ```
7. Push your branch and open a pull request.

### Writing Tests
**Trigger:** When adding or updating tests for a module  
**Command:** `/write-test`

1. Create a test file named after the module, using `.test.ts` (e.g., `userService.test.ts`).
2. Write test cases for each exported function or class.
3. Use the project's preferred (unknown) testing framework.
4. Run the tests to ensure correctness.
5. Commit with a descriptive message:
    ```
    feat: add tests for userService
    ```

## Testing Patterns

- Test files follow the pattern: `*.test.ts`
- Each test file should correspond to a module and cover its exported functions.
- The specific testing framework is not detected; follow existing test file patterns for consistency.

  Example:
  ```typescript
  // userService.test.ts
  import { sendMessage } from './userService';

  describe('sendMessage', () => {
    it('should send a message successfully', () => {
      // test implementation
    });
  });
  ```

## Commands
| Command         | Purpose                                      |
|-----------------|----------------------------------------------|
| /feature-dev    | Start a new feature development workflow      |
| /write-test     | Begin writing or updating tests for a module  |
```
