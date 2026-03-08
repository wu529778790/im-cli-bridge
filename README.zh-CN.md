# IM CLI Bridge

[English](README.md) | [中文](README.zh-CN.md)

连接 IM 平台（Telegram、飞书等）与 AI CLI 工具（如 Claude Code、Cursor 等）的桥梁，让你通过聊天界面使用 AI 编程助手。

## 功能特性

- **多平台支持**：支持 Telegram、飞书等平台
- **AI CLI 集成**：兼容 Claude Code、Cursor、Codex、Aider 等
- **实时流式输出**：输出追加为新消息，不覆盖已发送内容
- **Codex 输出优化**：过滤 header、exec、thinking、tokens 等噪音，只保留 AI 回复
- **两种运行模式**：前台模式（Ctrl+C 退出）和后台模式（start/stop 管理）
- **事件驱动架构**：灵活的发布订阅事件系统
- **类型安全**：完整的 TypeScript 实现

## 安装

### 方式一：从 npm 安装（推荐）

```bash
npm install -g im-cli-bridge
```

### 方式二：从源码安装

```bash
git clone https://github.com/wu529778790/im-cli-bridge.git
cd im-cli-bridge
npm install
npm run build
npm link
```

## 快速开始

### 1. 配置环境

复制 `.env.example` 到 `.env` 并配置凭证：

```bash
cp .env.example .env
```

编辑 `.env`，至少配置 `TELEGRAM_BOT_TOKEN` 和 `AI_COMMAND`（如 codex/claude）。

### 2. 构建和运行

```bash
# 编译 TypeScript
npm run build

# 前台模式（日志输出到控制台，Ctrl+C 退出）
npm start
# 或
npm run dev

# 后台模式（需 start/stop 管理）
npm run start:bg   # 启动后台服务
npm run stop       # 停止后台服务
```

## 使用方法

### 运行模式

| 命令 | 说明 |
|------|------|
| `run`, `foreground` | 前台模式：直接运行，日志输出到控制台，**Ctrl+C 退出**（默认） |
| `start` | 后台模式：启动后台服务，需用 `stop` 停止 |
| `stop` | 后台模式：停止后台服务 |

### 命令行选项

```bash
im-cli-bridge [COMMAND] [OPTIONS]

命令:
  run, foreground    前台运行（默认）
  start              后台启动
  stop               后台停止

选项:
  -c, --config <路径>   自定义配置文件
  -p, --port <端口>     服务器端口（默认：3000）
  -H, --host <地址>     服务器主机
  -l, --log-level <级别> 日志级别：debug, info, warn, error
  -v, --verbose         详细日志
      --version         显示版本
      --help            显示帮助
```

### 示例

```bash
# 前台运行，Ctrl+C 退出
im-cli-bridge
im-cli-bridge run

# 后台运行
im-cli-bridge start
im-cli-bridge stop

# 带参数
im-cli-bridge run --log-level debug
im-cli-bridge start -c ./config/custom.js
```

### 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot 令牌 | 必填 |
| `AI_COMMAND` | AI CLI（codex/claude/claudecode） | `claude` |
| `LOG_LEVEL` | 日志级别 | `info` |

## 架构

```
Telegram → EventEmitter → Router → ShellExecutor → AI CLI
                ↓                        ↓
            output-extractor ← 过滤 Codex 输出
```

## 自定义配置

`im-cli-bridge run --config ./custom.config.js` 可加载自定义配置，覆盖 `server`、`executor`、`logging` 等。

## 安全性

### 最佳实践

1. 永远不要提交 `.env` 文件或凭证
2. 保持 AI CLI 工具更新
3. 设置合理的命令超时时间
4. 监控日志中的可疑活动
5. 保持依赖项更新

### 注意事项

此桥接服务将消息转发给配置的 AI CLI 工具（如 Claude Code）。AI 工具本身处理命令执行和安全。请确保你的 AI 工具已正确配置并具有适当的安全措施。

## 支持的 IM 平台

| 平台 | 状态 | 功能 |
|------|------|------|
| **Telegram** | ✅ 完整支持 | Bot API、内联键盘、文件处理 |
| **飞书/Lark** | ✅ 完整支持 | 开放 API、卡片消息、webhook 事件 |
| **微信** | 🚧 计划中 | - |

## 项目结构

```
src/
├── core/        # 路由器、事件、命令解析
├── im-clients/  # Telegram、飞书客户端
├── executors/   # Shell 执行器
├── utils/       # 日志、输出过滤、消息适配
├── config/      # 配置、AI 适配器
└── interfaces/  # 类型定义
```

## 开发

```bash
# 前台开发模式
npm run dev

# 运行测试
npm test

# 生产构建
npm run build

# 后台启动/停止
npm run start:bg
npm run stop
```

## 故障排除

### 机器人不响应？
1. 检查 bot 令牌是否正确
2. 检查日志：`tail -f logs/combined.log`
3. 确保只运行一个 bridge 实例（避免 409 Conflict）

### 409 Conflict: terminated by other getUpdates？
同一 Bot 只能有一个长轮询连接。请确保：
- 没有同时运行 `npm start` 和 `npm run start:bg`
- 后台模式用 `npm run stop` 停掉后再重启

### AI 命令不工作？
1. 验证 `AI_COMMAND` 正确（codex、claudecode 等）
2. 在终端手动测试：`codex "hello"`

## 许可证

MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 贡献

欢迎贡献！请随时提交 Pull Request。

1. Fork 本仓库
2. 创建特性分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m 'Add some amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 开启 Pull Request

## 致谢

- 使用 TypeScript 和 Node.js 构建
- 使用 [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) 支持 Telegram
- 使用 Winston 进行日志记录
