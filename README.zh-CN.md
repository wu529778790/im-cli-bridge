# IM CLI Bridge

[English](README.md) | [中文](README.zh-CN.md)

连接 IM 平台（Telegram）与 AI CLI 工具（如 Claude Code、Cursor、Codex 等）的桥梁，让你通过聊天界面使用 AI 编程助手。

## 功能特性

- **多平台支持**：支持 Telegram
- **AI CLI 集成**：兼容 Claude Code、Cursor、Codex、Aider 等
- **实时流式输出**：输出追加为新消息，不覆盖已发送内容
- **Codex 输出优化**：过滤 header、exec、thinking、tokens 等噪音，只保留 AI 回复
- **两种运行模式**：前台模式（Ctrl+C 退出）和后台模式（start/stop 管理）

## 安装

```bash
npm install -g im-cli-bridge
```

## 快速开始

### 1. 配置环境

在运行目录下创建 `.env` 文件：

```bash
cp .env.example .env
```

编辑 `.env`，至少配置 `TELEGRAM_BOT_TOKEN` 和 `AI_COMMAND`（如 codex/claude）。

### 2. 运行

```bash
# 前台模式（Ctrl+C 退出）
im-cli-bridge
# 或
im-cli-bridge run

# 后台模式
im-cli-bridge start   # 启动
im-cli-bridge stop    # 停止
```

## 使用方法

### 命令

| 命令 | 说明 |
|------|------|
| `run`, `foreground` | 前台运行（默认） |
| `start` | 后台启动 |
| `stop` | 后台停止 |

### 选项

```bash
im-cli-bridge [COMMAND] [OPTIONS]

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
im-cli-bridge run --log-level debug
im-cli-bridge start -c ./custom.config.js
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot 令牌（必填） |
| `AI_COMMAND` | AI CLI 命令（codex/claude/claudecode） |
| `LOG_LEVEL` | 日志级别（默认 info） |

## 故障排除

### 机器人不响应？
1. 检查 bot 令牌是否正确
2. 检查日志：`tail -f logs/combined.log`
3. 确保只运行一个 bridge 实例（避免 409 Conflict）

### 409 Conflict？
同一 Bot 只能有一个连接。确保没有同时运行多个实例，后台模式用 `im-cli-bridge stop` 停掉后再重启。

### AI 命令不工作？
1. 验证 `AI_COMMAND` 正确
2. 在终端手动测试：`codex "hello"`

## 许可证

MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。
