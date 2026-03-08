# Command Executor Module

This module provides command execution capabilities with streaming, validation, and output parsing features.

## Architecture

### BaseExecutor (`base-executor.ts`)

Abstract base class that implements common functionality for all executors:
- Timeout control
- Environment variable handling
- Command logging
- Argument sanitization

### ShellExecutor (`shell-executor.ts`)

General-purpose shell command executor using `child_process.spawn`:
- Execute commands with streaming output
- Support for custom working directory and environment variables
- Timeout control
- Real-time output callbacks
- Claude CLI stream-json format support

### OutputParser (`output-parser.ts`)

Parser for Claude CLI stream-json output:
- Parse streaming events line by line
- Extract text content
- Extract tool calls and inputs
- Track message metadata (tokens, model, etc.)
- Handle partial JSON updates

### CommandValidator (`command-validator.ts`)

Security and safety validation for commands:
- Whitelist/blacklist command filtering
- Dangerous pattern detection
- Path traversal protection
- Directory access control
- Destructive command warnings
- Argument sanitization

## Usage

### Basic Command Execution

```typescript
import { ShellExecutor } from './executors/index.js';

const executor = new ShellExecutor();

// Simple execution
const result = await executor.execute('echo', ['Hello, World!']);
console.log(result.stdout); // "Hello, World!"
console.log(result.exitCode); // 0
console.log(result.duration); // execution time in ms
```

### Streaming Execution

```typescript
// Execute with streaming callbacks
const result = await executor.executeStream(
  'claude',
  ['chat', 'Tell me a joke'],
  {
    onText: (text) => console.log('Text:', text),
    onEvent: (event) => console.log('Event:', event.type),
    onError: (error) => console.error('Error:', error),
    timeout: 30000, // 30 seconds
    cwd: '/workspace'
  }
);
```

### Command Validation

```typescript
import { CommandValidator, createDefaultValidator } from './executors/index.js';

const validator = createDefaultValidator();

// Validate command
const result = validator.validate('rm', ['-rf', '/']);
if (!result.valid) {
  console.error('Validation failed:', result.error);
}

// Validate and sanitize
const { sanitizedCommand, sanitizedArgs, warnings } =
  validator.validateAndSanitize('git', ['status', '../']);
```

### Custom Validator

```typescript
import { CommandValidator } from './executors/index.js';

const validator = new CommandValidator({
  allowedCommands: ['git', 'npm', 'node'],
  allowPathTraversal: false,
  allowDestructive: false,
  allowedDirectories: ['/workspace', '/tmp']
});

const result = validator.validate('git', ['status']);
```

### Output Parsing

```typescript
import { OutputParser, extractAllText, extractAllToolUses } from './executors/index.js';

const parser = new OutputParser();

// Parse events one by one
for (const line of output.split('\n')) {
  const event = JSON.parse(line);
  const result = parser.parseEvent(event);

  if (result.text) {
    console.log('Received text:', result.text.text);
  }

  if (result.toolUse) {
    console.log('Tool call:', result.toolUse.name, result.toolUse.input);
  }
}

// Or parse entire buffer
const { texts, toolUses, messageMeta } = parser.parseBuffer(output);

// Utility functions
const allText = extractAllText(events);
const allTools = extractAllToolUses(events);
```

## API Reference

### ExecutionResult

```typescript
interface ExecutionResult {
  exitCode: number;        // 0 for success
  stdout: string;          // Standard output
  stderr: string;          // Standard error
  timedOut: boolean;       // Whether command timed out
  duration: number;        // Execution time in milliseconds
}
```

### ExecutionOptions

```typescript
interface ExecutionOptions {
  cwd?: string;                    // Working directory
  env?: Record<string, string>;    // Environment variables
  timeout?: number;                // Timeout in milliseconds
  throwOnError?: boolean;          // Throw on non-zero exit code
}
```

### StreamExecutionOptions

```typescript
interface StreamExecutionOptions extends ExecutionOptions {
  onEvent?: (event: ClaudeStreamEvent) => void;
  onText?: (text: string) => void;
  onToolProgress?: (progress: ToolProgress) => void;
  onError?: (error: Error) => void;
}
```

### ValidationOptions

```typescript
interface ValidationOptions {
  allowedCommands?: string[];      // Whitelist of commands
  blockedCommands?: string[];      // Blacklist of commands
  allowedDirectories?: string[];   // Allowed directories
  allowPathTraversal?: boolean;    // Allow ../ in paths
  allowDestructive?: boolean;      // Allow destructive commands
  maxCommandLength?: number;       // Max command length
}
```

## Stream Events

The module supports Claude CLI's stream-json format:

- `message_start`: Message metadata
- `content_block_start`: Start of text or tool use block
- `content_block_delta`: Incremental content update
- `content_block_stop`: End of content block
- `message_delta`: Message metadata update
- `message_stop`: End of message
- `error`: Error event
- `system`: System message

## Security Features

### Built-in Protections

1. **Dangerous Pattern Detection**: Blocks commands like `rm -rf /`, `format c:`, etc.
2. **Path Traversal Protection**: Prevents `../` attacks by default
3. **Command Length Limits**: Prevents buffer overflow attacks
4. **Directory Whitelisting**: Restricts file access to specific directories
5. **Argument Sanitization**: Removes null bytes and control characters

### Custom Validators

Create validators for different security levels:

```typescript
// Strict validator for production
const productionValidator = new CommandValidator({
  allowedCommands: ['git', 'npm'],
  allowPathTraversal: false,
  allowDestructive: false,
  allowedDirectories: ['/workspace']
});

// Permissive validator for development
const devValidator = createDevValidator();
```

## Error Handling

```typescript
try {
  const result = await executor.execute('command', ['args']);
  if (result.exitCode !== 0) {
    console.error('Command failed:', result.stderr);
  }
} catch (error) {
  if (error.message.includes('Timeout')) {
    console.error('Command timed out');
  } else {
    console.error('Execution error:', error);
  }
}
```

## Testing

```bash
# Run tests
npm test

# Run with debug output
DEBUG=* npm test
```

## License

MIT
