# IM CLI Bridge

[English](README.md) | [中文](README.zh-CN.md)

即时通讯平台与命令行执行之间的桥梁，允许通过聊天界面执行终端命令。

## 功能特性

- **多平台支持**：支持 Telegram、飞书等平台
- **安全执行**：可配置的命令白名单和用户权限控制
- **实时流式输出**：支持 Claude CLI stream-json 格式的实时命令输出
- **会话管理**：持久化的对话会话和历史记录
- **事件驱动架构**：灵活的发布订阅事件系统，易于扩展
- **类型安全**：完整的 TypeScript 实现，包含全面的接口定义

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

# 飞书应用凭证
FEISHU_APP_ID=你的应用ID
FEISHU_APP_SECRET=你的应用密钥

# 安全设置
ALLOWED_USERS=你的Telegram ID,其他用户ID
ALLOWED_COMMANDS=ls,pwd,echo,cat,git
```

### 2. 构建和运行

```bash
# 开发模式（使用 ts-node）
npm run dev

# 编译 TypeScript
npm run build

# 生产模式
npm start
```

### 3. 创建独立可执行文件

```bash
npm run pkg:build
# 输出：dist/im-cli-bridge（单个可执行文件）
```

## 使用方法

### 命令行选项

```bash
im-cli-bridge [选项]

选项:
  -c, --config <路径>     自定义配置文件路径
  -p, --port <端口>       服务器端口（默认：3000）
  -h, --host <地址>       服务器主机（默认：localhost）
  -l, --log-level <级别>  日志级别：debug, info, warn, error
  -v, --verbose           启用详细日志
      --version           显示版本信息
      --help              显示帮助信息
```

### 环境变量

| 变量 | 说明 | 必需 |
|------|------|------|
| `TELEGRAM_BOT_TOKEN` | 从 @BotFather 获取的 Telegram bot 令牌 | 条件* |
| `FEISHU_APP_ID` | 飞书应用 ID | 条件* |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | 条件* |
| `ALLOWED_USERS` | 允许使用机器人的逗号分隔用户 ID 列表 | 是 |
| `ALLOWED_COMMANDS` | 允许执行的逗号分隔命令列表 | 是 |
| `LOG_LEVEL` | 日志级别（debug/info/warn/error） | 否 |

*至少需要配置一个 IM 平台

## 架构

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│  Telegram   │─────▶│              │─────▶│   命令执行   │
│   客户端    │      │    路由器    │      │    器       │
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
| **IM 客户端** | 平台特定的集成（Telegram、飞书） |
| **事件发射器** | 用于消息路由的发布订阅事件系统 |
| **路由器** | 带命令解析和会话管理的消息处理器 |
| **命令执行器** | 支持流式输出的 Shell 命令执行 |
| **会话管理器** | 持久化的对话历史和上下文 |
| **命令验证器** | 用于命令验证的安全层 |

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
    maxConcurrent: 5,
    allowedCommands: ['git', 'npm', 'ls', 'cat'],
    blockedCommands: ['rm', 'dd', 'mkfs']
  },
  logging: {
    level: 'debug'
  }
};
```

使用方式：`im-cli-bridge --config ./custom.config.js`

## 安全性

### 内置保护

- **命令白名单**：只能执行明确允许的命令
- **用户授权**：只有指定的用户 ID 才能与机器人交互
- **危险模式检测**：阻止破坏性命令如 `rm -rf /`
- **路径遍历保护**：防止 `../` 目录逃逸攻击
- **命令超时**：自动终止长时间运行的命令
- **参数清理**：移除危险的输入字符

### 最佳实践

1. 永远不要提交 `.env` 文件或凭证
2. 生产环境使用 HTTPS webhook
3. 将 `ALLOWED_COMMANDS` 限制为最小必要集
4. 设置合理的命令超时时间
5. 监控日志中的可疑活动
6. 保持依赖项更新

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
│   ├── core/              # 核心逻辑（路由器、事件发射器、会话）
│   ├── interfaces/        # TypeScript 接口和类型
│   ├── im-clients/        # 平台客户端（telegram、feishu）
│   ├── executors/         # 带流式输出的命令执行
│   ├── storage/           # 数据持久化层
│   ├── utils/             # 工具类（日志、队列、看门狗）
│   └── config/            # 配置和模式验证
├── dist/                  # 编译输出
├── logs/                  # 应用日志
├── data/                  # 存储和会话
├── .env.example           # 环境变量模板
└── CLAUDE.md              # 开发者架构指南
```

## 事件

系统通过 `EventEmitter` 发出以下事件：

- `message:received` - 从 IM 平台收到新消息
- `message:sent` - 消息已发送到平台
- `command:executed` - 命令执行完成
- `session:created` - 创建新对话会话
- `session:updated` - 会话消息已更新
- `error` - 发生错误

## 开发

```bash
# 开发模式运行
npm run dev

# 运行测试
npm test

# 生产构建
npm run build

# 创建独立可执行文件
npm run pkg:build
```

## 故障排除

### 机器人不响应？
1. 检查 bot 令牌是否正确
2. 验证用户 ID 在 `ALLOWED_USERS` 中
3. 检查日志：`tail -f logs/app.log`
4. 确保 webhook/端口可访问

### 命令无法执行？
1. 验证命令在 `ALLOWED_COMMANDS` 中
2. 检查命令超时设置
3. 查看日志中的验证错误

### 会话问题？
1. 检查存储文件权限
2. 确保 `data/` 目录存在
3. 查看会话管理器日志

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
