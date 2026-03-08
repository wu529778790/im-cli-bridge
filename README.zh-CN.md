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

### 方式三：下载二进制文件（用于部署）

在 [Releases](https://github.com/wu529778790/im-cli-bridge/releases) 页面下载 Linux、Windows 或 macOS 版本。

> **注意：** 这是一个**后台服务**，不是桌面应用程序。应该在服务器或终端中运行，不要双击可执行文件。

## 快速开始

### 1. 配置环境

复制 `.env.example` 到 `.env` 并配置凭证：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```bash
# Telegram 机器人令牌（从 @BotFather 获取）
TELEGRAM_BOT_TOKEN=你的bot令牌

# 飞书应用凭证（可选）
FEISHU_APP_ID=你的应用ID
FEISHU_APP_SECRET=你的应用密钥

# AI CLI 命令（claudecode、cursor、codex、aider 等）
AI_COMMAND=claudecode

# 日志
LOG_LEVEL=info
```

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

### 3. 创建独立可执行文件

```bash
npm run pkg:build
# 输出：dist/im-cli-bridge（单个可执行文件）
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

| 变量 | 说明 | 必需 | 默认值 |
|------|------|------|--------|
| `TELEGRAM_BOT_TOKEN` | 从 @BotFather 获取的 Telegram bot 令牌 | 条件* | - |
| `FEISHU_APP_ID` | 飞书应用 ID | 条件* | - |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | 条件* | - |
| `AI_COMMAND` | AI CLI 工具名称（claudecode、cursor、codex、aider） | 否 | `claudecode` |
| `LOG_LEVEL` | 日志级别（debug/info/warn/error） | 否 | `info` |
| `AI_SESSION_MODE` | 启用会话模式（需 CLI 支持 stdin） | 否 | `false` |

*至少需要配置一个 IM 平台

## 架构

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│  Telegram   │─────▶│              │─────▶│   AI CLI    │
│   客户端    │      │    路由器    │      │   工具      │
└─────────────┘      │              │      └─────────────┘
                     │              │
┌─────────────┐      │   事件       │      ┌─────────────┐
│   飞书      │─────▶│  发射器      │─────▶│   会话管理  │
│   客户端    │      │              │      │     器      │
└─────────────┘      └──────────────┘      └─────────────┘
```

### 核心组件

| 组件 | 说明 |
|------|------|
| **IM 客户端** | 平台集成（Telegram、飞书） |
| **事件发射器** | 消息路由的发布订阅系统 |
| **路由器** | 将消息转发给 AI CLI 工具 |
| **Shell 执行器** | 流式命令执行 |
| **输出解析器** | 过滤 Codex/Claude 输出，提取可读回复 |

## 配置文件

可以通过 JavaScript/TypeScript 模块提供自定义配置：

```javascript
// custom.config.js
module.exports = {
  server: {
    port: 8080,
    host: '0.0.0.0'
  },
  executor: {
    timeout: 60000,
    aiCommand: 'claudecode',  // 或 'cursor', 'codex', 'aider'
    allowedCommands: ['*'],
    blockedCommands: ['rm -rf /', 'mkfs', 'dd if=/dev/zero']
  },
  logging: {
    level: 'debug'
  }
};
```

使用：`im-cli-bridge run --config ./custom.config.js`

## 安全性

### 最佳实践

1. 永远不要提交 `.env` 文件或凭证
2. 生产环境使用 HTTPS webhook
3. 保持 AI CLI 工具更新
4. 设置合理的命令超时时间
5. 监控日志中的可疑活动
6. 保持依赖项更新

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
im-cli-bridge/
├── src/
│   ├── core/              # 核心逻辑（路由器、事件发射器）
│   ├── interfaces/        # TypeScript 接口和类型
│   ├── im-clients/        # 平台客户端（telegram、feishu）
│   ├── executors/         # 带流式输出的命令执行
│   ├── utils/             # 工具类（日志、输出解析）
│   └── config/            # 配置
├── dist/                  # 编译输出
├── logs/                  # 应用日志
├── .env.example           # 环境变量模板
└── CLAUDE.md              # 开发者架构指南
```

## 事件

系统通过 `EventEmitter` 发出以下事件：

- `message:received` - 从 IM 平台收到新消息
- `message:sent` - 消息已发送到平台
- `command:executed` - 命令执行完成
- `error` - 发生错误

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

# 创建独立可执行文件
npm run pkg:build
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
- 使用 pkg 创建独立可执行文件
