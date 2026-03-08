# IM CLI Bridge

[English](README.md) | [中文](README.zh-CN.md)

连接 IM 平台（Telegram）与 AI CLI 工具（如 Claude Code、Cursor、Codex 等）的桥梁，让你通过聊天界面使用 AI 编程助手。

## 功能特性

- **多平台支持**：支持 Telegram
- **AI CLI 集成**：兼容 Claude Code、Cursor、Codex等
- **两种运行模式**：前台模式（Ctrl+C 退出）和后台模式（start/stop 管理）

## 快速开始

```bash
npx im-cli-bridge
```

首次运行时，若未配置，命令行会引导你输入 `TELEGRAM_BOT_TOKEN` 和 `AI_COMMAND`，保存到 `~/.im-cli-bridge/.env` 后自动启动。

之后再次运行 `npx im-cli-bridge` 将直接启动。

**后台模式**（需先 `npm install -g im-cli-bridge` 或确保 npx 可找到）：

```bash
npx im-cli-bridge start   # 启动
npx im-cli-bridge stop    # 停止
```

## 使用方法

### 命令

| 命令 | 说明 |
|------|------|
| `run`, `foreground` | 前台运行（默认） |
| `start` | 后台启动 |
| `stop` | 后台停止 |
| `init` | 初始化配置目录和 .env 模板 |

### 选项

```bash
npx im-cli-bridge [COMMAND] [OPTIONS]

选项:
  -c, --config <路径>   自定义配置文件
  -p, --port <端口>     服务器端口（默认：3000）
  -H, --host <地址>     服务器主机
  -l, --log-level <级别>  debug, info, warn, error
  -v, --verbose         详细日志
      --version         显示版本
      --help            显示帮助
```

### 示例

```bash
npx im-cli-bridge run --log-level debug
npx im-cli-bridge start -c ./custom.config.js
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot 令牌（必填） |
| `AI_COMMAND` | AI CLI 命令（默认 claude，可选 codex/cursor） |
| `LOG_LEVEL` | 日志级别（默认 info） |

## 故障排除

### 机器人不响应？

1. 检查 bot 令牌是否正确
2. 检查日志：`tail -f ~/.im-cli-bridge/logs/combined.log`
3. 确保只运行一个 bridge 实例（避免 409 Conflict）

### 409 Conflict？

同一 Bot 只能有一个连接。确保没有同时运行多个实例，后台模式用 `npx im-cli-bridge stop` 停掉后再重启。

### AI 命令不工作？

1. 验证 `AI_COMMAND` 正确
2. 在终端手动测试：`claude "hello"`

## 许可证

MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。
