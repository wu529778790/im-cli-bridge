# IM CLI Bridge

[English](README.md) | [中文](README.zh-CN.md)

A bridge between IM platforms (Telegram, WeChat, Feishu) and CLI execution, allowing you to execute terminal commands through chat interfaces.

## Features

- **Multi-Platform Support**: Works with Telegram, Feishu (Lark), and more
- **Secure Execution**: Configurable command whitelist and user permissions
- **Real-time Streaming**: Live command output streaming with Claude CLI stream-json format support
- **Session Management**: Persistent conversation sessions with context history
- **Event-Driven Architecture**: Flexible pub/sub event system for extensibility
- **Type-Safe**: Full TypeScript implementation with comprehensive interfaces
- **Standalone Binary**: Can be packaged as a single executable with pkg

## Installation

```bash
npm install
```

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

# Feishu App Credentials
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret

# Security Settings
ALLOWED_USERS=your_telegram_id,another_user_id
ALLOWED_COMMANDS=ls,pwd,echo,cat,git
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

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather | No* |
| `FEISHU_APP_ID` | Feishu/Lark app ID | No* |
| `FEISHU_APP_SECRET` | Feishu/Lark app secret | No* |
| `ALLOWED_USERS` | Comma-separated user IDs allowed to use the bot | Yes |
| `ALLOWED_COMMANDS` | Comma-separated list of allowed commands | Yes |
| `LOG_LEVEL` | Logging level (debug/info/warn/error) | No |

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
| **Router** | Message handler with command parsing and session management |
| **CommandExecutor** | Shell command execution with streaming output |
| **SessionManager** | Persistent conversation history and context |
| **CommandValidator** | Security layer for command validation |

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
    allowedCommands: ['git', 'npm', 'ls', 'cat'],
    blockedCommands: ['rm', 'dd', 'mkfs']
  },
  logging: {
    level: 'debug'
  }
};
```

Use with: `im-cli-bridge --config ./custom.config.js`

## Security

### Built-in Protections

- **Command Whitelist**: Only explicitly allowed commands can be executed
- **User Authorization**: Only specified user IDs can interact with the bot
- **Dangerous Pattern Detection**: Blocks destructive commands like `rm -rf /`
- **Path Traversal Protection**: Prevents `../` directory escape attacks
- **Command Timeout**: Automatic termination of long-running commands
- **Argument Sanitization**: Removes dangerous input characters

### Best Practices

1. Never commit `.env` files or credentials
2. Use HTTPS webhooks in production
3. Restrict `ALLOWED_COMMANDS` to minimum necessary
4. Set reasonable command timeouts
5. Monitor logs for suspicious activity
6. Keep dependencies updated

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
2. Verify user ID is in `ALLOWED_USERS`
3. Check logs: `tail -f logs/app.log`
4. Ensure webhook/port is accessible

### Commands not executing?
1. Verify command is in `ALLOWED_COMMANDS`
2. Check command timeout setting
3. Review logs for validation errors

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
