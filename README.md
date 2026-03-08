# IM CLI Bridge

A bridge between IM platforms (Telegram, WeChat, Feishu) and CLI execution, allowing you to execute terminal commands through chat interfaces.

## Features

- Support for multiple IM platforms (Telegram, Feishu)
- Secure command execution with configurable permissions
- Real-time command output streaming
- WebSocket support for live updates
- Comprehensive logging with Winston
- Type-safe TypeScript implementation
- Packagable as standalone executable

## Installation

```bash
npm install
```

## Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Update the `.env` file with your configuration:
   - Add your Telegram bot token
   - Configure Feishu app credentials
   - Set up security parameters
   - Configure allowed commands and users

## Usage

### Development Mode
```bash
npm run dev
```

### Build
```bash
npm run build
```

### Production
```bash
npm start
```

### Create Standalone Binary
```bash
npm run pkg:build
```

## Project Structure

```
im-cli-bridge/
├── src/
│   ├── core/           # Core bridge logic
│   ├── interfaces/     # TypeScript interfaces
│   ├── im-clients/     # IM platform clients
│   ├── executors/      # Command executors
│   ├── storage/        # Data persistence
│   └── utils/          # Utility functions
├── config/             # Configuration files
├── tests/              # Test files
└── dist/               # Compiled output
```

## Security Considerations

- Always use environment variables for sensitive data
- Implement proper user authentication
- Restrict commands that can be executed
- Use HTTPS in production
- Keep dependencies updated
- Configure firewall rules appropriately

## Supported IM Platforms

- **Telegram**: Full support via bot API
- **Feishu**: Full support via open API
- **WeChat**: Planned support

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
