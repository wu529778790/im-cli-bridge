# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IM CLI Bridge is a message routing system that bridges IM platforms (Feishu, Telegram) with AI CLI tools (claudecode, cursor, aider, etc.). It allows users to interact with AI coding assistants through chat interfaces, with special support for Claude CLI's stream-json format.

## Development Commands

```bash
# Development
npm run dev          # Run with ts-node (src/cli.ts)

# Build
npm run build        # Compile TypeScript to dist/

# Production
npm start            # Run compiled dist/cli.js
npm run start:direct # Run dist/index.js directly

# Testing
npm test             # Run Jest tests

# Standalone Binary
npm run pkg:build    # Create standalone executables
```

## Architecture

The system uses an **event-driven architecture** with the following flow:

1. **IM Clients** (`src/im-clients/`) receive messages from platforms
2. **EventEmitter** (`src/core/event-emitter.ts`) broadcasts `message:received` events
3. **Router** (`src/core/router.ts`) handles messages:
   - Commands are parsed by `CommandParser` and executed via `ShellExecutor`
   - Normal messages are added to `SessionManager`
4. **Responses** are sent back through registered IM clients

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `IMCLIBridge` | `src/index.ts` | Main orchestrator, initializes and starts all components |
| `EventEmitter` | `src/core/event-emitter.ts` | Pub/sub event system |
| `Router` | `src/core/router.ts` | Message routing and command handling |
| `SessionManager` | `src/core/session-manager.ts` | Conversation session persistence |
| `CommandParser` | `src/core/command-parser.ts` | Parse command strings (e.g., `/help`, `/new`) |
| `BaseExecutor` | `src/executors/base-executor.ts` | Abstract base for command executors |
| `ShellExecutor` | `src/executors/shell-executor.ts` | Execute shell commands with streaming |
| `CommandValidator` | `src/executors/command-validator.ts` | Security validation for commands |
| `FeishuClient` | `src/im-clients/feishu/` | Feishu/Lark platform integration |
| `TelegramClient` | `src/im-clients/telegram/` | Telegram bot integration |
| `FileStorage` | `src/storage/file-storage.ts` | JSON file persistence |
| `immessageToMessage` | `src/utils/message-adapter.ts` | Convert IM-specific messages to unified Message format |
| `extractDisplayText` | `src/utils/output-extractor.ts` | Parse Claude CLI stream-json format to plain text |
| `Watchdog` | `src/utils/watchdog.ts` | Auto-restart on service hang detection |

### Message Flow

The complete message processing pipeline:

1. **IM Client** receives raw message → emits `IMMessage` (platform-specific format)
2. **message-adapter.ts** converts `IMMessage` → `Message` (unified internal format)
3. **EventEmitter** broadcasts `message:received` event
4. **Router** handles message:
   - If command: parsed by `CommandParser` → executed via `ShellExecutor`
   - If normal: added to `SessionManager` → forwarded to AI CLI tool
5. **AI CLI Response** → `ShellExecutor` captures stdout/stderr
6. **output-extractor.ts** parses stream-json or passes through plain text
7. **Router** sends response via registered IM client

### Event Types

Key events emitted through `EventEmitter`:
- `message:received` - New message from IM platform
- `message:sent` - Message sent to platform
- `command:executed` - Command completed execution
- `session:created`, `session:updated` - Session lifecycle
- `error` - Error events

See `src/interfaces/types.ts` for complete `EventType` enum.

### Configuration

Configuration is loaded in this priority (later overrides earlier):
1. `src/config/default.config.ts` - Base defaults
2. Custom config file (via `--config` CLI flag)
3. CLI flags (`--port`, `--host`, `--log-level`)
4. Environment variables (e.g., `FEISHU_APP_ID`, `TELEGRAM_BOT_TOKEN`)

Validation is handled by `src/config/schema.ts`.

Key environment variables (see `.env.example`):
- `TELEGRAM_BOT_TOKEN` - Telegram bot token from @BotFather
- `FEISHU_APP_ID`, `FEISHU_APP_SECRET` - Feishu/Lark credentials
- `AI_COMMAND` - AI CLI tool to use (default: `claudecode`)
- `LOG_LEVEL` - Logging level (debug/info/warn/error)
- `WATCHDOG_ENABLED`, `WATCHDOG_TIMEOUT` - Watchdog settings

### IM Client Interface

All IM clients implement `IMClient` interface from `src/interfaces/im-client.interface.ts`:
- `initialize(config)` - Set up credentials
- `start()` / `stop()` - Lifecycle control
- `sendText()`, `sendCard()` - Send messages
- `on()`, `off()` - Event listener registration

### Message Format

Two message types are used:

1. **`IMMessage`** (`src/interfaces/im-client.interface.ts`): Platform-specific format from IM clients
   - Contains `userId`, `receiverId`, `groupId`, platform-specific `content`
   - Different structures per platform (Telegram vs Feishu)

2. **`Message`** (`src/interfaces/types.ts`): Unified internal format
   - `id`, `userId`, `content` (string), `platform`, `timestamp`, `metadata`
   - Used throughout Router and core components
   - `userId` is set to the reply target (chat ID for Telegram, groupId/userId for Feishu)

### Command Execution

Commands are executed through `ShellExecutor` (extends `BaseExecutor`):
- Uses `child_process.spawn` for real-time output
- `BaseExecutor` provides timeout control and environment handling
- Forces UTF-8 encoding for subprocess (PYTHONIOENCODING, PYTHONUTF8)
- Validates commands via `CommandValidator` (whitelist, dangerous patterns)

### Output Parsing

The `extractDisplayText` utility (`src/utils/output-extractor.ts`) handles AI CLI output:
- **Proxy mode**: Passes through plain text unchanged (for direct AI CLI interaction)
- **Stream-json mode**: Parses Claude CLI's JSONL format to extract AI responses
  - Handles `type: "result"` with `result` field
  - Handles `type: "assistant"/"user"` with `message.content[]` blocks
  - Handles `type: "content_block_delta"` with `delta.text`
- Auto-detects format by checking if first line is valid JSON with `"type"` field

## Adding a New IM Platform

1. Create client in `src/im-clients/<platform>/`
2. Implement `IMClient` interface from `src/interfaces/im-client.interface.ts`:
   - Emit `message:received` events with `IMMessage` format
   - Implement `sendText(userId, content)` to send replies
   - Handle platform-specific message formats
3. Update `src/utils/message-adapter.ts`:
   - Add platform-specific logic to `getReplyTarget()` for userId extraction
   - Ensure `extractTextContent()` handles your platform's content format
4. Register with router in `IMCLIBridge.connectIMClients()`
5. Add platform type to `Platform` in `src/interfaces/types.ts`
6. Update config schema in `src/config/schema.ts`

## Security Notes

- Commands are validated via `CommandValidator` before execution
- Default config restricts allowed commands (see `.env.example`)
- Never commit sensitive credentials - use environment variables
- Watchdog timer can restart the bridge on hangs (configurable)
- `BaseExecutor.sanitizeArgs()` hides sensitive args (api_key, token, secret) from logs

## Testing AI CLI Integration

To verify the AI CLI tool works correctly:

```bash
# Test claudecode directly first
claudecode "hello world"

# Test with the -p flag (used by the bridge)
claudecode -p "explain recursion"

# Check if stream-json is being used
claudecode -p "test" | head -1  # Should see {"type":...
```

Common issues:
- If AI CLI isn't found: Ensure it's in PATH or use absolute path in config
- If responses appear as raw JSON: Check `extractDisplayText()` in output-extractor.ts
- If encoding issues appear with Chinese text: `BaseExecutor` forces UTF-8 via PYTHONIOENCODING
