# open-im

多平台 IM 桥接，支持多种 AI CLI 工具（Claude Code、Codex、Cursor 等）。参考 [cc-im](https://github.com/congqiu/cc-im) 架构，借鉴 [ShellRemoteBot](https://github.com/Al-Muhandis/ShellRemoteBot) 的交互模式。

## 功能

- **多 AI 工具**：通过 `AI_COMMAND` 配置切换 Claude / Codex / Cursor
- **流式输出**：节流更新，Telegram editMessage 实时展示
- **会话管理**：每用户独立 session，`/new` 重置
- **命令**：`/help` `/new` `/cd` `/pwd` `/status`

## 快速开始

```bash
# 配置
export TELEGRAM_BOT_TOKEN=your_bot_token
export ALLOWED_USER_IDS=your_telegram_user_id
export AI_COMMAND=claude

# 运行
npx open-im@latest
# 或
npm run dev
```

## 配置

| 变量 | 说明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token |
| `ALLOWED_USER_IDS` | 白名单用户 ID（逗号分隔，空=所有人） |
| `AI_COMMAND` | `claude` \| `codex` \| `cursor`，默认 `claude` |
| `CLAUDE_CLI_PATH` | Claude CLI 路径，默认 `claude` |
| `CLAUDE_WORK_DIR` | 工作目录 |
| `CLAUDE_SKIP_PERMISSIONS` | 跳过权限确认，默认 `true` |

## 项目结构

```
src/
├── adapters/          # ToolAdapter 抽象与实现
│   ├── tool-adapter.interface.ts
│   ├── claude-adapter.ts
│   └── registry.ts
├── claude/            # Claude CLI 运行与解析
├── shared/            # ai-task、utils、types
├── telegram/          # Telegram 事件与消息
├── session/           # 会话管理
└── commands/          # 命令分发
```

## License

MIT
