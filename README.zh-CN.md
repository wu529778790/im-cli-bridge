# open-im

[English](./README.md)

多平台 IM 桥接工具，把 Telegram、飞书、企业微信、钉钉、QQ、微信接到 AI CLI 工具（Claude Code、Codex、CodeBuddy），在手机或聊天窗口远程使用 AI 编程助手。

## 功能特性

- **6 个 IM 平台** — Telegram、飞书、企业微信、钉钉、QQ、微信（WorkBuddy），可同时启用
- **3 种 AI 后端** — Claude（Agent SDK）、Codex、CodeBuddy
- **按平台分配 AI** — 每个 IM 平台可以使用不同的 AI 工具
- **流式输出** — 实时回传 AI 回复与工具执行进度（因平台而异）
- **多媒体支持** — 支持发送图片、文件、语音、视频进行 AI 分析
- **会话隔离** — 每个用户独立维护本地会话，`/new` 可重置
- **Web 配置页面** — 图形化仪表板，在线管理配置
- **内置命令** — `/help`、`/new`、`/cd`、`/pwd`、`/status`、`/allow`、`/deny`

## 环境要求

- Node.js >= 20
- 至少配置一个 IM 平台
- 根据所选 AI 工具完成认证

## 快速开始

```bash
npx @wu529778790/open-im start
```

或全局安装：

```bash
npm install -g @wu529778790/open-im
open-im start
```

配置文件：`~/.open-im/config.json`

## CLI 命令

| 命令                | 说明                           |
| ------------------- | ------------------------------ |
| `open-im init`      | 配置平台和 AI 工具，不启动服务 |
| `open-im start`     | 后台运行服务                   |
| `open-im stop`      | 停止后台服务                   |
| `open-im dev`       | 前台运行（调试模式）           |
| `open-im dashboard` | 仅启动 Web 配置页（不启动桥接）|

## Web 配置页面

### 本机使用

启动后打开 [`http://127.0.0.1:39282`](http://127.0.0.1:39282)，页面包括：

- **概览** — 已配置/已启用平台数量、服务状态
- **平台配置** — 启用并填写各 IM 的凭证（Token/App ID/Secret、代理、AI 工具、白名单）
- **AI 工具配置** — 默认 AI 工具、工作目录、各工具单独设置（CLI 路径、超时、代理、API Key）
- **服务控制** — 校验配置、保存、启动/停止桥接

> WorkBuddy（微信）通过 `open-im init` 或直接编辑 `~/.open-im/config.json` 配置。

### 远程服务器

```bash
export OPEN_IM_NO_BROWSER=1
# 可选：允许从其他设备访问配置页
# export OPEN_IM_WEB_HOST=0.0.0.0
open-im dashboard
```

若设置了 `OPEN_IM_WEB_HOST=0.0.0.0`，服务端会输出一次性登录链接：

```
http://your-server-ip:39282/?login_token=xxxx
```

在浏览器中完成配置后，启动桥接服务：

```bash
open-im start
```

## IM 内命令

| 命令          | 说明                   |
| ------------- | ---------------------- |
| `/help`       | 显示帮助               |
| `/new`        | 开始新的 AI 会话       |
| `/status`     | 显示 AI 工具和会话信息 |
| `/cd <路径>`  | 切换会话目录           |
| `/pwd`        | 显示当前会话目录       |
| `/allow` `/y` | 允许权限请求           |
| `/deny` `/n`  | 拒绝权限请求           |

## 会话说明

会话保存在本地 `~/.open-im/data/sessions.json`，与 IM 聊天记录无关。每个用户有独立的会话目录。`/new` 重置当前 AI 会话。

## 配置说明

### 按平台分配 AI 工具

根级 `aiCommand` 是默认 AI 工具，可通过 `platforms.<name>.aiCommand` 为不同 IM 单独指定：

```json
{
  "aiCommand": "claude",
  "platforms": {
    "telegram": { "enabled": true, "aiCommand": "codex" },
    "feishu":   { "enabled": true, "aiCommand": "codex" },
    "qq":       { "enabled": true, "aiCommand": "codebuddy" }
  }
}
```

### Claude（Agent SDK）

Claude 默认使用 Agent SDK，不需要本地 `claude` 可执行文件，只需配置 API 凭证。

凭证加载顺序：
1. 环境变量
2. `~/.open-im/config.json` 的 `env`
3. `~/.claude/settings.json` 或 `~/.claude.json`

支持第三方兼容接口：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_BASE_URL": "https://your-api-endpoint",
    "ANTHROPIC_MODEL": "glm-4.7"
  }
}
```

Claude 会自动继承本地 `~/.claude/settings.json` 中的插件和配置。

### CodeBuddy

安装 CLI 并登录：

```bash
npm install -g @tencent-ai/codebuddy-code
codebuddy login
```

配置项：
- `tools.codebuddy.cliPath` — CLI 路径（默认：`codebuddy`）
- `tools.codebuddy.skipPermissions` — 跳过权限确认（默认：`true`）
- `tools.codebuddy.timeoutMs` — 执行超时（默认：`600000`）

Windows 上若 `cliPath` 为 `codebuddy`，会自动尝试 `AppData\Roaming\npm\codebuddy.cmd`。

### 配置文件示例

```json
{
  "aiCommand": "claude",
  "tools": {
    "claude": {
      "workDir": "/path/to/project",
      "skipPermissions": true,
      "timeoutMs": 600000
    },
    "codex": {
      "workDir": "/path/to/project",
      "skipPermissions": true,
      "proxy": "http://127.0.0.1:7890"
    },
    "codebuddy": {
      "skipPermissions": true,
      "timeoutMs": 600000
    }
  },
  "platforms": {
    "telegram": {
      "enabled": true,
      "botToken": "YOUR_TELEGRAM_BOT_TOKEN"
    },
    "feishu": {
      "enabled": false,
      "appId": "YOUR_FEISHU_APP_ID",
      "appSecret": "YOUR_FEISHU_APP_SECRET"
    },
    "qq": {
      "enabled": false,
      "appId": "YOUR_QQ_APP_ID",
      "secret": "YOUR_QQ_APP_SECRET"
    },
    "wework": {
      "enabled": false,
      "corpId": "YOUR_WEWORK_CORP_ID",
      "secret": "YOUR_WEWORK_SECRET"
    },
    "dingtalk": {
      "enabled": false,
      "clientId": "YOUR_DINGTALK_CLIENT_ID",
      "clientSecret": "YOUR_DINGTALK_CLIENT_SECRET",
      "cardTemplateId": "YOUR_DINGTALK_AI_CARD_TEMPLATE_ID"
    },
    "workbuddy": {
      "enabled": false,
      "accessToken": "",
      "refreshToken": "",
      "userId": ""
    }
  }
}
```

### 环境变量

#### 通用

| 变量              | 说明                                       |
| ----------------- | ------------------------------------------ |
| `AI_COMMAND`      | 默认 AI 工具（`claude` / `codex` / `codebuddy`）|
| `CLAUDE_WORK_DIR` | 默认会话工作目录                           |
| `LOG_DIR`         | 日志目录                                   |
| `LOG_LEVEL`       | 日志级别                                   |
| `HOOK_PORT`       | 权限服务端口                               |

#### AI 工具凭证

| 变量                         | 说明                          |
| ---------------------------- | ----------------------------- |
| `ANTHROPIC_API_KEY`          | Claude API Key                |
| `ANTHROPIC_AUTH_TOKEN`       | Claude OAuth Token            |
| `ANTHROPIC_BASE_URL`         | Claude API 地址               |
| `ANTHROPIC_MODEL`            | Claude 模型名称               |
| `OPENAI_API_KEY`             | Codex API Key                 |
| `CODEX_PROXY`                | Codex 访问 `chatgpt.com` 的代理|
| `CODEBUDDY_CLI_PATH`         | CodeBuddy CLI 路径            |
| `CODEBUDDY_TIMEOUT_MS`       | CodeBuddy 超时                |
| `CODEBUDDY_API_KEY`          | CodeBuddy API Key             |
| `CODEBUDDY_AUTH_TOKEN`       | CodeBuddy Auth Token          |

#### 平台凭证

| 变量                         | 说明                          |
| ---------------------------- | ----------------------------- |
| `TELEGRAM_BOT_TOKEN`         | Telegram Bot Token            |
| `TELEGRAM_PROXY`             | Telegram 代理地址             |
| `TELEGRAM_ALLOWED_USER_IDS`  | Telegram 白名单               |
| `FEISHU_APP_ID`              | 飞书 App ID                   |
| `FEISHU_APP_SECRET`          | 飞书 App Secret               |
| `FEISHU_ALLOWED_USER_IDS`    | 飞书白名单                    |
| `QQ_BOT_APPID`               | QQ 机器人 App ID              |
| `QQ_BOT_SECRET`              | QQ 机器人 App Secret          |
| `QQ_BOT_SANDBOX`             | QQ 沙箱模式（`1`/`true`）     |
| `QQ_ALLOWED_USER_IDS`        | QQ 白名单                     |
| `DINGTALK_CLIENT_ID`         | 钉钉应用 Client ID / AppKey   |
| `DINGTALK_CLIENT_SECRET`     | 钉钉应用 Client Secret        |
| `DINGTALK_CARD_TEMPLATE_ID`  | 钉钉 AI 卡片模板 ID           |
| `DINGTALK_ALLOWED_USER_IDS`  | 钉钉白名单                    |
| `WEWORK_CORP_ID`             | 企业微信 Bot ID               |
| `WEWORK_SECRET`              | 企业微信 Secret               |
| `WEWORK_WS_URL`              | 企业微信 WebSocket 地址       |
| `WEWORK_ALLOWED_USER_IDS`    | 企业微信白名单                |
| `WORKBUDDY_ACCESS_TOKEN`     | WorkBuddy OAuth 访问令牌      |
| `WORKBUDDY_REFRESH_TOKEN`    | WorkBuddy OAuth 刷新令牌      |
| `WORKBUDDY_USER_ID`          | WorkBuddy 用户 ID             |
| `WORKBUDDY_BASE_URL`         | WorkBuddy API 地址            |
| `WORKBUDDY_ALLOWED_USER_IDS` | WorkBuddy 白名单              |

### 平台配置来源

| 平台     | 配置来源                                                        |
| -------- | --------------------------------------------------------------- |
| Telegram | 从 [@BotFather](https://t.me/BotFather) 获取 Bot Token         |
| 飞书     | 从 [飞书开放平台](https://open.feishu.cn/) 创建应用并启用机器人 |
| QQ       | 从 [QQ 开放平台](https://bot.q.qq.com/) 创建机器人              |
| 钉钉     | 从钉钉开放平台创建应用，启用机器人 Stream Mode                  |
| 企业微信 | 从 [企业微信管理后台](https://work.weixin.qq.com/) 获取凭证     |
| 微信     | 运行 `open-im init` 并选择 "WorkBuddy" 完成 OAuth 登录和绑定   |

**钉钉说明：**
- 采用 Stream Mode 收消息 + OpenAPI 发消息的混合模式
- 配置 `cardTemplateId` 后启用 AI 助理流式卡片，失败时回退为纯文本
- 自定义机器人和普通群仅支持单条文本回复
- 启动/关闭通知不会发送到钉钉

## 故障排除

| 问题                     | 解决方案                                                         |
| ------------------------ | ---------------------------------------------------------------- |
| Telegram 无响应          | 检查网络，添加 `proxy` 或设置 `TELEGRAM_PROXY`                  |
| QQ 无法连接              | 确认机器人已创建，检查 `QQ_BOT_APPID` / `QQ_BOT_SECRET`        |
| QQ 重复回复              | 更新到最新版本                                                   |
| 飞书卡片报错             | 未配置卡片回调时使用 `/mode ask` 或 `/mode yolo`                |
| 企业微信收不到通知       | 先给机器人发一条消息                                             |
| 钉钉无法回复             | 确认 Stream Mode 已启用，检查凭证配置                           |
| 钉钉没有流式更新         | 自定义机器人仅支持纯文本；配置 `cardTemplateId` 启用流式卡片    |
| Codex `stream disconnected` | 配置 `tools.codex.proxy` 或 `CODEX_PROXY`                    |
| CodeBuddy 需要登录       | 先执行 `codebuddy login`                                        |
| WorkBuddy 无法连接       | 运行 `open-im init` 重新登录，Token 可能已过期                  |
| WorkBuddy 微信收不到消息 | 重新运行 `open-im init` 生成新的微信客服绑定链接                |

## License

[MIT](LICENSE)
