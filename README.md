# IM CLI Bridge

[English](README.md) | [中文](README.zh-CN.md)

A message routing bridge that connects IM platforms (Telegram, Feishu) with AI CLI tools like Claude Code, Cursor, etc. Allows you to interact with AI coding assistants through chat interfaces.

## Features

- **Multi-Platform Support**: Works with Telegram, Feishu (Lark), and more
- **AI CLI Integration**: Compatible with Claude Code, Cursor, Codex, Aider, etc.
- **Streaming Output**: Appends new content as messages instead of overwriting
- **Codex Output Filtering**: Strips header, exec, thinking, tokens; keeps only AI replies
- **Two Run Modes**: Foreground (Ctrl+C to exit) and background (start/stop)
- **Event-Driven Architecture**: Pub/sub event system
- **Type-Safe**: Full TypeScript implementation

## Installation

### Option 1: Install from npm (Recommended)

```bash
npm install -g im-cli-bridge
```

### Option 2: Install from source

```bash
git clone https://github.com/wu529778790/im-cli-bridge.git
cd im-cli-bridge
npm install
npm run build
npm link
```

### Option 3: Download binary (for deployment)

Binaries are available on the [Releases](https://github.com/wu529778790/im-cli-bridge/releases) page for Linux, Windows, and macOS.

> **Note:** This is a **backend service**, not a desktop application. It should be run on a server or in a terminal, not by double-clicking the executable.

## Quick Start

### 1. Configure Environment

Copy `.env.example` to `.env` and configure your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# Telegram Bot Token (get from @BotFather)
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Feishu App Credentials (optional)
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret

# AI CLI Command (claudecode, cursor, codex, aider, etc.)
AI_COMMAND=claudecode

# Logging
LOG_LEVEL=info
```

### 2. Build and Run

```bash
# Build TypeScript
npm run build

# Foreground mode (logs to console, Ctrl+C to exit)
npm start
# or
npm run dev

# Background mode
npm run start:bg   # Start in background
npm run stop       # Stop background service
```

### 3. Create Standalone Binary

```bash
npm run pkg:build
# Output: dist/im-cli-bridge (single executable)
```

## Usage

### Run Modes

| Command | Description |
|---------|-------------|
| `run`, `foreground` | Foreground: logs to console, **Ctrl+C to exit** (default) |
| `start` | Background: start daemon, use `stop` to stop |
| `stop` | Background: stop daemon |

### CLI Options

```bash
im-cli-bridge [COMMAND] [OPTIONS]

Commands:
  run, foreground    Foreground mode (default)
  start              Start in background
  stop               Stop background service

Options:
  -c, --config <path>    Custom config file
  -p, --port <number>    Server port (default: 3000)
  -H, --host <address>   Server host
  -l, --log-level <level>  debug, info, warn, error
  -v, --verbose          Verbose logging
      --version          Show version
      --help             Show help
```

### Examples

```bash
# Foreground, Ctrl+C to exit
im-cli-bridge
im-cli-bridge run

# Background
im-cli-bridge start
im-cli-bridge stop

# With options
im-cli-bridge run --log-level debug
im-cli-bridge start -c ./config/custom.js
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | Required |
| `AI_COMMAND` | AI CLI (codex/claude/claudecode) | `claude` |
| `LOG_LEVEL` | Logging level | `info` |

## Architecture

```
Telegram → EventEmitter → Router → ShellExecutor → AI CLI
                ↓                        ↓
            output-extractor ← filters Codex output
```

Use `--config ./custom.config.js` to override `server`, `executor`, `logging`.

## Security

### Best Practices

1. Never commit `.env` files or credentials
2. Use HTTPS webhooks in production
3. Keep your AI CLI tool updated
4. Set reasonable command timeouts
5. Monitor logs for suspicious activity
6. Keep dependencies updated

### Note

This bridge forwards messages to your configured AI CLI tool (e.g., Claude Code). The AI tool itself handles command execution and safety. Ensure your AI tool is properly configured with appropriate safeguards.

## Supported IM Platforms

| Platform | Status | Features |
|----------|--------|----------|
| **Telegram** | ✅ Full | Bot API, inline keyboards, file handling |
| **Feishu/Lark** | ✅ Full | Open API, card messages, webhook events |
| **WeChat** | 🚧 Planned | - |

## Project Structure

```
src/
├── core/        # Router, event emitter, command parser
├── im-clients/  # Telegram, Feishu clients
├── executors/   # Shell executor
├── utils/       # Logger, output filter, message adapter
├── config/      # Config, AI adapters
└── interfaces/  # Type definitions
```

## Development

```bash
# Foreground dev mode
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Background start/stop
npm run start:bg
npm run stop

# Create standalone binary
npm run pkg:build
```

## Troubleshooting

### Bot not responding?
1. Check bot token is correct
2. Check logs: `tail -f logs/combined.log`
3. Ensure only one bridge instance is running (avoid 409 Conflict)

### 409 Conflict: terminated by other getUpdates?
Only one polling connection per Bot. Ensure:
- Not running both `npm start` and `npm run start:bg`
- Use `npm run stop` before restarting in background mode

### AI command not working?
1. Verify `AI_COMMAND` (codex, claudecode, etc.)
2. Test manually: `codex "hello"`

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Acknowledgments

- Built with TypeScript and Node.js
- Uses [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) for Telegram
- Uses Winston for logging
- Uses pkg for creating standalone binaries
