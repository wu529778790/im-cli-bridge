# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Build TypeScript to JavaScript (outputs to dist/)
npm run build

# Development mode - run directly from source with tsx
npm run dev

# Run the compiled version (production)
npm start
npm stop

# CLI commands (after building)
open-im init            # Interactive configuration wizard (does not start service)
open-im start           # Start service in background
open-im stop            # Stop background service
open-im dev             # Run in foreground (debug mode)
```

## Project Architecture

This is a multi-platform IM bridge that connects Telegram, Feishu (Lark), and WeChat to AI CLI tools like Claude Code, enabling mobile/remote access to AI coding assistance.

### Core Architecture

- **Entry Points**:
  - `src/index.ts` - Main service entry, handles lifecycle and platform initialization
  - `src/cli.ts` - CLI interface for start/stop/init/dev commands, manages background daemon
  - `src/setup.ts` - Interactive configuration wizard using `prompts` library

- **Platform Layer**:
  - `src/telegram/` - Telegram bot via Telegraf
    - `client.ts` - Telegraf bot initialization with platform-specific proxy support
    - `event-handler.ts` - Message/command routing from Telegram to AI adapters
    - `message-sender.ts` - Sending responses back to Telegram
  - `src/feishu/` - Feishu/Lark via @larksuiteoapi/node-sdk
    - `client.ts` - Feishu client and WebSocket event handling
    - `event-handler.ts` - Message/command routing from Feishu
    - `message-sender.ts` - Sending responses back to Feishu
  - `src/wework/` - WeWork (企业微信) via AI Bot WebSocket
    - `client.ts` - WeWork WebSocket client, subscribe/auth, proactive send
    - `event-handler.ts` - Message/command routing from WeWork
    - `message-sender.ts` - Sending responses back to WeWork
  - `src/wechat/` - WeChat via AGP/Qclaw (testing, may be unstable)
    - `client.ts` - WeChat WebSocket client initialization
    - `event-handler.ts` - Message/command routing from WeChat
    - `message-sender.ts` - Sending responses back to WeChat

- **AI Adapter Layer** (`src/adapters/`):
  - `tool-adapter.interface.ts` - Common interface for all AI tools
  - `claude-adapter.ts` - Claude Code CLI integration (spawn per message)
  - `claude-sdk-adapter.ts` - Claude Agent SDK (in-process, no spawn, faster)
  - `registry.ts` - Adapter registry, initialized based on config

- **Session Management** (`src/session/`):
  - `session-manager.ts` - Per-user session state (workDir, sessionId, conversation IDs)
  - Persists to `~/.open-im/data/sessions.json`
  - Handles conversation isolation and `/new` command

- **Claude Integration** (`src/claude/`):
  - `cli-runner.ts` - Spawns and manages Claude Code subprocess
  - `stream-parser.ts` - Parses Claude's output format for tool calls and content
  - `types.ts` - TypeScript types for Claude's protocol

- **Shared Utilities** (`src/shared/`):
  - `ai-task.ts` - AI task execution and cleanup
  - `active-chats.ts` - Active chat tracking
  - `message-dedup.ts` - Message deduplication
  - `task-cleanup.ts` - Task cleanup utilities

### Configuration

Config file: `~/.open-im/config.json`

Config loading order (environment variables take precedence):
1. Environment variables (TELEGRAM_BOT_TOKEN, FEISHU_APP_ID, WECHAT_APP_ID, etc.)
2. File config (`~/.open-im/config.json`)
3. Default values

Key config options:
- `enabledPlatforms` - Array of enabled platforms ('telegram' | 'feishu' | 'wechat')
- `allowedUserIds` - Whitelist of user IDs (empty = all users)
- `allowedBaseDirs` - Security: restrict which directories users can access
- `aiCommand` - Which AI tool to use (claude/codex/cursor)
- `tools.claude.cliPath` - Path to Claude CLI executable
- `tools.claude.workDir` - Default working directory
- `tools.claude.skipPermissions` - Auto-approve tool permissions (default: true)
- `claudeTimeoutMs` - Claude CLI timeout (default: 600000)
- `logDir` - Log directory (default: `~/.open-im/logs`)
- `logLevel` - Log level (INFO/DEBUG/WARN/ERROR)
- `useSdkMode` - For non-Claude tools only; Claude always uses SDK mode (faster, no CLI required)

### Important Design Decisions

- **npm, not pnpm** - Use npm for all package operations (see commit history for reasoning)
- **ES Module + Node16** - TypeScript target ES2022, module Node16
- **Node >= 20** - Minimum Node version requirement
- **First-run setup** - `src/setup.ts` provides interactive configuration wizard; if stdin is not a TTY, prints manual setup instructions
- **Multi-platform** - Telegram, Feishu, and WeChat can be enabled simultaneously; `enabledPlatforms` is dynamically determined based on available tokens
- **Permission Server** - `src/hook/permission-server.ts` handles auto-approving tool permissions when `claudeSkipPermissions` is enabled
- **Request Queue** - `src/queue/request-queue.ts` handles concurrent message processing per user
- **Access Control** - `src/access/access-control.ts` validates user IDs against whitelist
