# IM CLI Bridge

[English](https://github.com/wu529778790/im-cli-bridge/blob/main/README.md) | [中文](https://github.com/wu529778790/im-cli-bridge/blob/main/README.zh-CN.md)

A message routing bridge that connects IM platforms (Telegram) with AI CLI tools like Claude Code, Cursor, Codex, etc. Use AI coding assistants through chat interfaces.

## Features

- **Telegram Support**: Bot API, inline keyboards, file handling
- **AI CLI Integration**: Claude Code, Cursor, Codex, Aider
- **Streaming Output**: Appends new content as messages
- **Codex Output Filtering**: Strips header, exec, thinking; keeps only AI replies
- **Two Run Modes**: Foreground (Ctrl+C) and background (start/stop)

## Quick Start

Run with `npx`, no global install needed:

```bash
npx im-cli-bridge
```

On first run, if not configured, the CLI will prompt for `TELEGRAM_BOT_TOKEN` and `AI_COMMAND`, save to `~/.im-cli-bridge/.env`, then start automatically.

Subsequent runs will start directly.

**Background mode** (requires `npm install -g im-cli-bridge` or npx availability):

```bash
npx im-cli-bridge start   # Start
npx im-cli-bridge stop    # Stop
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
npx im-cli-bridge [COMMAND] [OPTIONS]

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
Only one connection per Bot. Use `npx im-cli-bridge stop` before restarting.

### AI command not working?
1. Verify `AI_COMMAND`
2. Test manually: `claude "hello"`

## License

MIT License - see [LICENSE](LICENSE).
