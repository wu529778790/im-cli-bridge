# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IM CLI Bridge is a message routing system that bridges IM platforms (Feishu, Telegram) with command execution. It allows users to execute CLI commands through chat interfaces, with special support for Claude CLI's stream-json format.

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
| `ShellExecutor` | `src/executors/shell-executor.ts` | Execute shell commands with streaming |
| `OutputParser` | `src/executors/output-parser.ts` | Parse Claude CLI stream-json format |
| `CommandValidator` | `src/executors/command-validator.ts` | Security validation for commands |
| `FeishuClient` | `src/im-clients/feishu/` | Feishu/Lark platform integration |
| `TelegramClient` | `src/im-clients/telegram/` | Telegram bot integration |
| `FileStorage` | `src/storage/file-storage.ts` | JSON file persistence |

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

### IM Client Interface

All IM clients implement `IMClient` interface from `src/interfaces/im-client.interface.ts`:
- `initialize(config)` - Set up credentials
- `start()` / `stop()` - Lifecycle control
- `sendText()`, `sendCard()` - Send messages
- `on()`, `off()` - Event listener registration

### Command Execution

Commands are executed through `ShellExecutor` with streaming support:
- Uses `child_process.spawn` for real-time output
- Parses Claude CLI's stream-json format via `OutputParser`
- Validates commands via `CommandValidator` (whitelist, dangerous patterns)
- Timeout control and working directory isolation

## Adding a New IM Platform

1. Create client in `src/im-clients/<platform>/`
2. Implement `IMClient` interface
3. Register with router in `IMCLIBridge.initializeComponents()`
4. Add platform type to `Platform` in `src/interfaces/types.ts`
5. Update config schema in `src/config/schema.ts`

## Security Notes

- Commands are validated via `CommandValidator` before execution
- Default config restricts allowed commands (see `.env.example`)
- Never commit sensitive credentials - use environment variables
- Watchdog timer can restart the bridge on hangs (configurable)
