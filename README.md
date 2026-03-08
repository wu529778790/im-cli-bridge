# open-im

多平台 IM 桥接，支持多种 AI CLI 工具（Claude Code、Codex、Cursor 等）。

## 功能

- **多 AI 工具**：通过 `AI_COMMAND` 配置切换 Claude / Codex / Cursor
- **流式输出**：节流更新，Telegram editMessage 实时展示
- **会话管理**：每用户独立 session，`/new` 重置
- **命令**：`/help` `/new` `/cd` `/pwd` `/status`

## 快速开始

### 方式一：npx（推荐，无需安装）

```bash
npx @wu529778790/open-im
```

### 方式二：全局安装

```bash
# 安装
pnpm i @wu529778790/open-im -g

# 启动
open-im
```

首次运行会进入交互式配置，按提示输入后自动启动服务。配置保存到 `~/.open-im/config.json`。

### 后台运行

```bash
# Linux / macOS
nohup open-im > /dev/null 2>&1 &

# Windows (PowerShell)
Start-Process -WindowStyle Hidden -FilePath "open-im"
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
