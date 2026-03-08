# IM CLI Bridge

[English](README.md) | [中文](README.zh-CN.md)

A message routing bridge that connects IM platforms (Telegram, Feishu) with AI CLI tools like Claude Code, Cursor, etc. Allows you to interact with AI coding assistants through chat interfaces.

## Features

- **Multi-Platform Support**: Works with Telegram, Feishu (Lark), and more
- **AI CLI Integration**: Compatible with Claude Code, Cursor, Codex, Aider, etc.
- **Real-time Streaming**: Supports Claude CLI stream-json format for live responses
- **Session Management**: Persistent conversation sessions with context history
- **Event-Driven Architecture**: Flexible pub/sub event system for extensibility
- **Watchdog Protection**: Auto-restart on service hang detection
- **Type-Safe**: Full TypeScript implementation with comprehensive interfaces

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
# Development mode (with ts-node)
npm run dev

# Build TypeScript
npm run build

# Production mode
npm start
```

### 3. Create Standalone Binary

```bash
npm run pkg:build
# Output: dist/im-cli-bridge (single executable)
```

## Usage

### CLI Options

```bash
im-cli-bridge [OPTIONS]

Options:
  -c, --config <path>      Path to custom configuration file
  -p, --port <number>      Server port (default: 3000)
  -h, --host <address>     Server host (default: localhost)
  -l, --log-level <level>  Log level: debug, info, warn, error
  -v, --verbose            Enable verbose logging
      --version            Show version information
      --help               Show help message
```

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather | No* | - |
| `FEISHU_APP_ID` | Feishu/Lark app ID | No* | - |
| `FEISHU_APP_SECRET` | Feishu/Lark app secret | No* | - |
| `AI_COMMAND` | AI CLI tool to use (claudecode, cursor, codex, aider) | No | `claudecode` |
| `LOG_LEVEL` | Logging level (debug/info/warn/error) | No | `info` |
| `WATCHDOG_ENABLED` | Enable watchdog auto-restart | No | `true` |
| `WATCHDOG_TIMEOUT` | Watchdog timeout in milliseconds | No | `60000` |

*At least one IM platform must be configured

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│  Telegram   │─────▶│              │─────▶│   Command   │
│   Client    │      │   Router     │      │  Executor   │
└─────────────┘      │              │      └─────────────┘
                     │              │
┌─────────────┐      │   Event      │      ┌─────────────┐
│   Feishu    │─────▶│   Emitter    │─────▶│    Session  │
│   Client    │      │              │      │   Manager   │
└─────────────┘      └──────────────┘      └─────────────┘
```

### Core Components

| Component | Description |
|-----------|-------------|
| **IM Clients** | Platform-specific integrations (Telegram, Feishu) |
| **EventEmitter** | Pub/sub event system for message routing |
| **Router** | Message handler that forwards to AI CLI tool |
| **ShellExecutor** | Command execution with streaming output support |
| **SessionManager** | Persistent conversation history and context |
| **Watchdog** | Auto-restart on service hang detection |

## Configuration File

Custom configuration can be provided via JavaScript/TypeScript module:

```javascript
// custom.config.js
module.exports = {
  server: {
    port: 8080,
    host: '0.0.0.0'
  },
  executor: {
    timeout: 60000,
    maxConcurrent: 5,
    aiCommand: 'claudecode',  // or 'cursor', 'codex', 'aider'
    allowedCommands: ['*'],
    blockedCommands: ['rm -rf /', 'mkfs', 'dd if=/dev/zero']
  },
  watchdog: {
    enabled: true,
    timeout: 60000
  },
  logging: {
    level: 'debug'
  }
};
```

Use with: `im-cli-bridge --config ./custom.config.js`

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
im-cli-bridge/
├── src/
│   ├── core/              # Core logic (router, event-emitter, sessions)
│   ├── interfaces/        # TypeScript interfaces and types
│   ├── im-clients/        # Platform clients (telegram, feishu)
│   ├── executors/         # Command execution with streaming
│   ├── storage/           # Data persistence layer
│   ├── utils/             # Utilities (logger, queue, watchdog)
│   └── config/            # Configuration and schema validation
├── dist/                  # Compiled output
├── logs/                  # Application logs
├── data/                  # Storage and sessions
├── .env.example           # Environment template
└── CLAUDE.md              # Architecture guide for developers
```

## Events

The system emits the following events through `EventEmitter`:

- `message:received` - New message from IM platform
- `message:sent` - Message sent to platform
- `command:executed` - Command execution completed
- `session:created` - New conversation session created
- `session:updated` - Session messages updated
- `error` - Error occurred

## Development

```bash
# Run in development mode
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Create standalone binary
npm run pkg:build
```

## Troubleshooting

### Bot not responding?
1. Check bot token is correct
2. Check logs: `tail -f logs/combined.log`
3. Ensure webhook/port is accessible

### AI command not working?
1. Verify `AI_COMMAND` is set correctly (default: `claudecode`)
2. Test the command manually in your terminal: `claudecode "hello"`
3. Check logs for execution errors

### Watchdog keeps restarting?
1. Increase `WATCHDOG_TIMEOUT` if AI responses take longer
2. Check if AI CLI tool is hanging
3. Review logs for timeout patterns

### Session issues?
1. Check storage file permissions
2. Ensure `data/` directory exists
3. Review session manager logs

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
