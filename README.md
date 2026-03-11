# open-im

多平台 IM 桥接，将 Telegram、飞书 (Feishu/Lark)、企业微信和微信连接到 AI CLI 工具（Claude Code、Codex、Cursor），实现移动端/远程访问 AI 编程助手。

## 功能特性

- **多平台**：支持 Telegram、飞书、企业微信、微信（测试中），可同时启用
- **多 AI 工具**：通过配置切换 Claude Code / Codex / Cursor
- **流式输出**：节流更新，实时展示 AI 回复
- **会话管理**：每用户独立 session，`/new` 重置会话
- **命令支持**：`/help` `/new` `/cd` `/pwd` `/status` `/allow` `/deny`

## 环境要求

- **Node.js** >= 20
- **Claude API**：需要 API Key 或 Auth Token（[获取方式](https://console.anthropic.com/)）

## 快速开始

```bash
npx @wu529778790/open-im start
```

或全局安装后直接使用：

```bash
npm install @wu529778790/open-im -g
open-im start
```

配置保存到 `~/.open-im/config.json`。

## 命令说明

| 命令 | 说明 |
|------|------|
| `open-im init` | 初始化配置（不启动服务） |
| `open-im start` | 后台运行，适合长期使用 |
| `open-im stop` | 停止后台服务 |
| `open-im dev` | 前台运行（调试模式），Ctrl+C 停止 |

## 会话说明

**会话上下文存储在本地**（`~/.open-im/data/sessions.json`），与 IM 聊天记录无关。每用户在本地维护独立的 session 和 Claude 会话 ID，`/new` 可重置当前会话。

### 环境变量

| 变量 | 说明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token |
| `FEISHU_APP_ID` | 飞书 App ID |
| `FEISHU_APP_SECRET` | 飞书 App Secret |
| `WEWORK_CORP_ID` | 企业微信 Bot ID |
| `WEWORK_SECRET` | 企业微信 Secret |
| `ALLOWED_USER_IDS` | 白名单（逗号分隔，空=所有人） |
| `CLAUDE_WORK_DIR` | 工作目录，默认当前目录 |
| `ALLOWED_BASE_DIRS` | 允许访问的目录（逗号分隔） |
| `CURSOR_API_KEY` | Cursor Agent API Key（使用 cursor 时必填，或先运行 agent login） |

### Claude API 配置

**自动加载**：优先使用环境变量，其次从 `~/.open-im/config.json` 的 `env` 字段读取，最后从 `~/.claude/settings.json`（与 Claude Code 共用）自动加载。

**快速配置**：

```bash
# 方式 1：运行配置向导
open-im init

# 方式 2：编辑配置文件
cat > ~/.open-im/config.json << 'EOF'
{
  "aiCommand": "claude",
  "tools": {
    "claude": {
      "cliPath": "claude",
      "workDir": "YOUR_WORK_DIR",
      "skipPermissions": true,
      "timeoutMs": 600000
    },
    "cursor": { "cliPath": "agent" },
    "codex": { "cliPath": "codex", "workDir": "YOUR_WORK_DIR" }
  },
  "platforms": {
    # 企业微信配置
    "wework": {
      "enabled": true,
      "allowedUserIds": [],
      "corpId": "YOUR_WEWORK_CORP_ID",
      "secret": "YOUR_WEWORK_SECRET" # 从企业微信管理后台获取 Corp ID 和 Secret
    },
    # Telegram 配置
    "telegram": {
      "enabled": true,
      "proxy": "http://127.0.0.1:7890",
      "allowedUserIds": [],
      "botToken": "YOUR_TELEGRAM_BOT_TOKEN" # 从 @BotFather 获取 Bot Token
    },
    # 飞书配置
    "feishu": {
      "enabled": true,
      "allowedUserIds": [],
      "appId": "YOUR_FEISHU_APP_ID",
      "appSecret": "YOUR_FEISHU_APP_SECRET" # 从飞书开放平台获取 App ID 和 App Secret
    }
  }
}
EOF
```

**支持第三方模型**（可选）：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_BASE_URL": "https://your-api-endpoint",
    "ANTHROPIC_MODEL": "glm-4.7"
  }
}
```

### 平台配置

运行 `open-im init` 自动配置，或手动设置：

- **Telegram**：从 [@BotFather](https://t.me/BotFather) 获取 Bot Token
- **飞书**：[开放平台](https://open.feishu.cn/) 创建应用，启用机器人，配置 WebSocket 事件订阅
- **企业微信**：[管理后台](https://work.weixin.qq.com/) 创建应用，获取 Bot ID 和 Secret
- **微信**：测试中，基于 Qclaw 协议

## IM 内命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/mode` | 切换权限模式（卡片/按钮选择） |
| `/mode <模式>` | 直接切换：ask / accept-edits / plan / yolo |
| `/new` | 开始新会话 |
| `/status` | 显示状态（AI 工具、工作目录、费用等） |
| `/cd <路径>` | 切换工作目录 |
| `/pwd` | 显示当前工作目录 |
| `/allow` `/y` | 允许权限请求 |
| `/deny` `/n` | 拒绝权限请求 |

### 权限模式

与 Claude Code 官方命名一致，见 [permissions](https://code.claude.com/docs/en/permissions)：

| 模式 | Claude 名 | 说明 |
|------|-----------|------|
| ask | default | 首次使用每个工具时提示确认 |
| accept-edits | acceptEdits | 编辑权限自动通过 |
| plan | plan | 仅分析，不修改文件不执行命令 |
| yolo | bypassPermissions | 跳过所有权限确认 |

## 📝 License

[MIT](LICENSE)

## 🔧 故障排除

**Telegram 无响应**：检查网络，可能需要代理，在配置文件中添加 `"proxy": "http://127.0.0.1:7890"`

**飞书卡片报错**：未配置卡片回调，使用命令替代：`/mode ask`、`/mode yolo`

**企业微信收不到通知**：需先发一条消息给机器人，才能接收启动通知

**Cursor 报 Authentication required**：需先认证。方式 1：在终端运行 `agent login`；方式 2：在 `~/.open-im/config.json` 的 `env` 中添加 `"CURSOR_API_KEY": "你的 API Key"`
