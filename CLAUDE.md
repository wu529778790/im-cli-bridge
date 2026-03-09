# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Build TypeScript to JavaScript (outputs to dist/)
npm run build

# Development mode - run directly from source
npm run dev

# Run the compiled version
npm run run

# CLI commands (after building)
npm start                 # Alias for: node dist/cli.js start
open-im start            # Start service in background
open-im stop             # Stop background service
open-im restart          # Restart service
open-im run              # Run in foreground (default)
open-im init             # Interactive configuration wizard

# Test (currently just runs build)
npm test
```

## Project Architecture

This is an IM bridge that connects Telegram (and potentially other platforms) to AI CLI tools like Claude Code, enabling mobile/remote access to AI coding assistance.

### Core Architecture

- **Entry Points**:
  - `src/index.ts` - Main service entry, handles lifecycle and platform initialization
  - `src/cli.ts` - CLI interface for start/stop/restart/init commands, manages background daemon

- **Platform Layer** (`src/telegram/`):
  - `client.ts` - Telegraf bot initialization with platform-specific proxy support
  - `event-handler.ts` - Message/command routing from Telegram to AI adapters
  - `message-sender.ts` - Sending responses back to Telegram

- **AI Adapter Layer** (`src/adapters/`):
  - `tool-adapter.interface.ts` - Common interface for all AI tools
  - `claude-adapter.ts` - Claude Code CLI integration
  - `registry.ts` - Adapter registry, initialized based on config

- **Session Management** (`src/session/`):
  - `session-manager.ts` - Per-user session state (workDir, sessionId, conversation IDs)
  - Persists to `~/.open-im/data/sessions.json`
  - Handles conversation isolation and `/new` command

- **Claude Integration** (`src/claude/`):
  - `cli-runner.ts` - Spawns and manages Claude Code subprocess
  - `stream-parser.ts` - Parses Claude's output format for tool calls and content
  - `types.ts` - TypeScript types for Claude's protocol

### Configuration

Config file: `~/.open-im/config.json`

Key config aspects:
- `platforms.{platform}.proxy` - Platform-specific proxy (http/https/socks5), only affects that platform's API calls
- `allowedBaseDirs` - Security: restrict which directories users can access
- `aiCommand` - Which AI tool to use (claude/codex/cursor)

### Important Design Decisions

- **npm, not pnpm** - Use npm for all package operations (see commit history for reasoning)
- **ES Module + Node16** - TypeScript target ES2022, module Node16
- **Permission Server** - `src/hook/permission-server.ts` handles auto-approving tool permissions when `claudeSkipPermissions` is enabled
- **Request Queue** - `src/queue/request-queue.ts` handles concurrent message processing per user
- **Access Control** - `src/access/access-control.ts` validates user IDs against whitelist
