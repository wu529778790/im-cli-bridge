# IM CLI Bridge

[English](README.md) | [中文](README.zh-CN.md)

A message routing bridge that connects IM platforms (Telegram) with AI CLI tools like Claude Code, Cursor, Codex, etc. Use AI coding assistants through chat interfaces.

## Features

- **Telegram Support**: Bot API, inline keyboards, file handling
- **AI CLI Integration**: Claude Code, Cursor, Codex, Aider
- **Streaming Output**: Appends new content as messages
- **Codex Output Filtering**: Strips header, exec, thinking; keeps only AI replies
- **Two Run Modes**: Foreground (Ctrl+C) and background (start/stop)

## Installation

```bash
npm install -g im-cli-bridge
```

## Quick Start

### 1. Configure

**Option A: Environment variables** (recommended)

Set in your shell profile (.bashrc / .zshrc) or system env:

```bash
export TELEGRAM_BOT_TOKEN=your_bot_token
export AI_COMMAND=claude
```

**Option B: Config file**

```bash
im-cli-bridge init   # Creates ~/.im-cli-bridge/.env
# Edit and add TELEGRAM_BOT_TOKEN and AI_COMMAND
```

### 2. Run

```bash
# Foreground (Ctrl+C to exit)
im-cli-bridge
# or
im-cli-bridge run

# Background
im-cli-bridge start   # Start
im-cli-bridge stop    # Stop
```

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `run`, `foreground` | Foreground mode (default) |
| `start` | Start in background |
| `stop` | Stop background service |
| `init` | Create config dir and .env template |

### Options

```bash
im-cli-bridge [COMMAND] [OPTIONS]

Options:
  -c, --config <path>    Custom config file
  -p, --port <number>    Server port (default 3000)
  -H, --host <address>   Server host
  -l, --log-level <level>  debug, info, warn, error
  -v, --verbose          Verbose logging
      --version          Show version
      --help             Show help
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (required) |
| `AI_COMMAND` | AI CLI command (default claude, or codex/cursor) |
| `LOG_LEVEL` | Log level (default info) |

## Troubleshooting

### Bot not responding?
1. Check bot token
2. Check logs: `tail -f ~/.im-cli-bridge/logs/combined.log`
3. Ensure only one bridge instance (avoid 409 Conflict)

### 409 Conflict?
Only one connection per Bot. Use `im-cli-bridge stop` before restarting.

### AI command not working?
1. Verify `AI_COMMAND`
2. Test manually: `claude "hello"`

## License

MIT License - see [LICENSE](LICENSE).
