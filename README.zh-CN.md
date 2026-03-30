# open-im

[English](./README.md)

多平台 IM 桥接工具，把 Telegram、飞书、企业微信、钉钉、QQ、微信接到 AI CLI 工具（Claude Code、Codex、CodeBuddy），方便在手机或聊天窗口里远程使用 AI 编程助手。

## 功能特性

- 多平台：支持 Telegram、飞书、企业微信、钉钉、QQ、微信（WorkBuddy），可同时启用
- 多 AI 工具：支持 Claude、Codex、CodeBuddy
- 按平台分配 AI：根级 `aiCommand` 作为默认值，`platforms.<name>.aiCommand` 可为不同 IM 单独指定 AI 工具
- 流式输出：实时回传 AI 回复与工具执行进度（目前钉钉暂未实现流式传输）
- 图形化配置页面 / CLI 配置引导
- 会话隔离：每个用户独立维护本地会话，`/new` 可重置
- 常用命令：支持 `/help`、`/new`、`/cd`、`/pwd`、`/status`

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

配置文件默认保存在 `~/.open-im/config.json`。

## CLI 命令

| 命令              | 说明                           |
| ----------------- | ------------------------------ |
| `open-im init`    | 初始化或追加配置，不启动服务   |
| `open-im start`   | 后台运行服务                   |
| `open-im stop`    | 停止后台服务                   |
| `open-im dev`     | 前台运行（调试模式）           |
| `open-im dashboard` | 仅启动 Web 配置页（不启动桥接服务） |

## 服务器部署与图形化配置

### 本机（带浏览器）使用

在本机直接运行：

```bash
open-im start
```

然后在浏览器中打开 [`http://127.0.0.1:39282`](http://127.0.0.1:39282)（或命令行里提示的地址），页面结构如下：

- **概览** – 已配置/已启用平台数量、服务状态（未启动或运行中）
- **平台配置** – 启用并填写 Telegram、飞书、QQ、企业微信、钉钉的凭证（Bot Token/App ID/Secret、代理、该平台使用的 AI 工具、白名单用户 ID）。每个平台提供「校验配置」按钮
- **AI 工具配置** – **公共**：默认 AI 工具（Claude / Codex / CodeBuddy）、工作目录、Hook 端口、日志级别。**分工具**：Claude（CLI 路径、超时、代理、配置路径、ANTHROPIC\_\* 等）、Codex（CLI 路径、超时、代理）、CodeBuddy（CLI 路径、超时）
- **服务控制** – 校验配置、保存、启动桥接、停止桥接

WorkBuddy（微信）暂不在网页中配置，如需使用请在 `~/.open-im/config.json` 中手动配置或通过 `open-im init` 引导。

- `open-im start` 会同时启动桥接服务并提供该配置页（本机场景）。
- `open-im dev` 仅在未完成配置时自动打开页面。
- 已有配置但想单独打开配置页时，可以使用 `open-im dashboard` 启动仅 Web 配置服务。

### 推荐的服务器端使用方式

在远程服务器上，建议的最简单、安全的方式是：

1. **先通过 `dashboard` 在浏览器里完成配置**

   在服务器上执行：

   ```bash
   export OPEN_IM_NO_BROWSER=1
   # 可选：如果希望从其他设备访问配置页，可以绑定到所有网卡
   # export OPEN_IM_WEB_HOST=0.0.0.0
   open-im dashboard
   ```

   - 这只会启动 Web 配置页，不会同时启动桥接服务。
   - 若设置了 `OPEN_IM_WEB_HOST=0.0.0.0`，服务端会输出一次性登录链接，例如：

     ```text
     http://your-server-ip:39282/?login_token=xxxx
     ```

   - 在浏览器中打开该链接，按照页面提示完成各个平台 / AI 工具配置，最后在页面中点击 **「Start bridge」** 按钮启动桥接服务。

2. **后台运行桥接服务**

   配置保存后，有两种启动方式：
   - 在 Web 页面 Service 面板中直接点击 **「Start bridge」**；
   - 或者在服务器上运行：

     ```bash
     open-im start
     ```

   这会根据已保存的配置，在后台长期运行桥接服务。

## 会话说明

会话上下文保存在本地 `~/.open-im/data/sessions.json`，与 IM 聊天记录本身无关。每个用户有独立会话目录和 session 信息，发送 `/new` 会重置当前 AI 会话。

## 配置说明

根级 `aiCommand` 是所有平台共用的默认 AI 工具。若某个 IM 平台需要单独绑定其他工具，可以设置 `platforms.<platform>.aiCommand`。

示例：

```json
{
  "aiCommand": "claude",
  "platforms": {
    "telegram": {
      "enabled": true,
      "aiCommand": "codex"
    },
    "feishu": {
      "enabled": true,
      "aiCommand": "codex"
    },
    "qq": {
      "enabled": true,
      "aiCommand": "codebuddy"
    }
  }
}
```

这个配置下，Telegram 会走 Codex，飞书会走 Codex，QQ 会走 CodeBuddy，其他未单独指定 `aiCommand` 的平台仍然使用 Claude。

### Claude

Claude 默认使用 Agent SDK，不依赖本地 `claude` 可执行文件；通常只需要配置 API 凭证。

自动加载顺序：

1. 环境变量
2. `~/.open-im/config.json` 的 `env`
3. `~/.claude/settings.json` 或 `~/.claude.json`

支持官方 API，也支持第三方兼容接口：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_BASE_URL": "https://your-api-endpoint",
    "ANTHROPIC_MODEL": "glm-4.7"
  }
}
```

### CodeBuddy

CodeBuddy 依赖本地 CLI。先安装 CLI，再通过交互登录或在 `env` 中提供凭证。

```bash
npm install -g @tencent-ai/codebuddy-code
codebuddy --version
codebuddy login
```

常用配置项：

- `tools.codebuddy.cliPath`：CLI 路径，默认 `codebuddy`
- `tools.codebuddy.skipPermissions`：是否跳过权限确认，默认 `true`
- `tools.codebuddy.timeoutMs`：总执行超时，默认 `600000`
- `platforms.<platform>.aiCommand`：若某个平台要走 CodeBuddy，可设为 `codebuddy`

在 Windows 上，如果 `cliPath` 仍然是 `codebuddy`，open-im 还会自动尝试 `AppData\\Roaming\\npm\\codebuddy.cmd` 等常见全局安装路径。

### 配置文件示例

下面示例是合法 JSON，可直接保存为 `~/.open-im/config.json`：

```json
{
  "aiCommand": "claude",
  "tools": {
    "claude": {
      "cliPath": "claude",
      "workDir": "D:/coding/open-im",
      "skipPermissions": true,
      "timeoutMs": 600000
    },
    "codex": {
      "cliPath": "codex",
      "workDir": "D:/coding/open-im",
      "skipPermissions": true,
      "proxy": "http://127.0.0.1:7890"
    },
    "codebuddy": {
      "cliPath": "codebuddy",
      "skipPermissions": true,
      "timeoutMs": 600000
    }
  },
  "platforms": {
    "telegram": {
      "enabled": true,
      "aiCommand": "codex",
      "proxy": "http://127.0.0.1:7890",
      "allowedUserIds": [],
      "botToken": "YOUR_TELEGRAM_BOT_TOKEN"
    },
    "feishu": {
      "enabled": false,
      "aiCommand": "codex",
      "allowedUserIds": [],
      "appId": "YOUR_FEISHU_APP_ID",
      "appSecret": "YOUR_FEISHU_APP_SECRET"
    },
    "qq": {
      "enabled": false,
      "aiCommand": "codebuddy",
      "allowedUserIds": [],
      "appId": "YOUR_QQ_APP_ID",
      "secret": "YOUR_QQ_APP_SECRET"
    },
    "wework": {
      "enabled": false,
      "aiCommand": "claude",
      "allowedUserIds": [],
      "corpId": "YOUR_WEWORK_CORP_ID",
      "secret": "YOUR_WEWORK_SECRET"
    },
    "dingtalk": {
      "enabled": false,
      "aiCommand": "claude",
      "allowedUserIds": [],
      "clientId": "YOUR_DINGTALK_CLIENT_ID",
      "clientSecret": "YOUR_DINGTALK_CLIENT_SECRET",
      "cardTemplateId": "YOUR_DINGTALK_AI_CARD_TEMPLATE_ID"
    },
    "workbuddy": {
      "enabled": false,
      "aiCommand": "claude",
      "allowedUserIds": [],
      "accessToken": "",
      "refreshToken": "",
      "userId": ""
    }
  }
}
```

### 常用环境变量

| 变量                         | 说明                                           |
| ---------------------------- | ---------------------------------------------- |
| `AI_COMMAND`                 | 选择 `claude` / `codex` / `codebuddy`          |
| `CLAUDE_WORK_DIR`            | 默认会话目录                                   |
| `LOG_DIR`                    | 日志目录                                       |
| `LOG_LEVEL`                  | 日志级别                                       |
| `HOOK_PORT`                  | 权限服务端口                                   |
| `CODEX_PROXY`                | Codex 访问 `chatgpt.com` 的代理                |
| `OPENAI_API_KEY`             | Codex API Key，可替代 `codex login`            |
| `CODEBUDDY_CLI_PATH`         | 覆盖 CodeBuddy CLI 路径                        |
| `CODEBUDDY_TIMEOUT_MS`       | 覆盖 CodeBuddy 超时                            |
| `CODEBUDDY_SKIP_PERMISSIONS` | 覆盖 CodeBuddy 的跳过权限确认行为              |
| `CODEBUDDY_IDLE_TIMEOUT_MS`  | CodeBuddy 长时间无输出时自动终止               |
| `CODEBUDDY_API_KEY`          | CodeBuddy API Key，可替代 `codebuddy login`    |
| `CODEBUDDY_AUTH_TOKEN`       | CodeBuddy Auth Token，可替代 `codebuddy login` |
| `TELEGRAM_BOT_TOKEN`         | Telegram Bot Token                             |
| `TELEGRAM_PROXY`             | Telegram 代理地址                              |
| `TELEGRAM_ALLOWED_USER_IDS`  | Telegram 白名单                                |
| `FEISHU_APP_ID`              | 飞书 App ID                                    |
| `FEISHU_APP_SECRET`          | 飞书 App Secret                                |
| `FEISHU_ALLOWED_USER_IDS`    | 飞书白名单                                     |
| `QQ_BOT_APPID`               | QQ 机器人 App ID                               |
| `QQ_BOT_SECRET`              | QQ 机器人 App Secret                           |
| `QQ_BOT_SANDBOX`             | QQ 机器人沙箱模式（`1`/`true` 启用，默认关闭） |
| `QQ_ALLOWED_USER_IDS`        | QQ 白名单                                      |
| `DINGTALK_CLIENT_ID`         | 钉钉应用 Client ID / AppKey                    |
| `DINGTALK_CLIENT_SECRET`     | 钉钉应用 Client Secret / AppSecret             |
| `DINGTALK_CARD_TEMPLATE_ID`  | 钉钉 AI 卡片模板 ID，配置后启用单条流式回复    |
| `DINGTALK_ALLOWED_USER_IDS`  | 钉钉白名单                                     |
| `WEWORK_CORP_ID`             | 企业微信 Bot ID                                |
| `WEWORK_SECRET`              | 企业微信 Secret                                |
| `WEWORK_WS_URL`              | 企业微信 WebSocket 地址                        |
| `WEWORK_ALLOWED_USER_IDS`    | 企业微信白名单                                 |
| `WORKBUDDY_ACCESS_TOKEN`     | WorkBuddy OAuth 访问令牌（由 `open-im init` 自动生成） |
| `WORKBUDDY_REFRESH_TOKEN`    | WorkBuddy OAuth 刷新令牌（由 `open-im init` 自动生成） |
| `WORKBUDDY_USER_ID`          | WorkBuddy 用户 ID                              |
| `WORKBUDDY_BASE_URL`         | WorkBuddy API 地址，默认 `https://copilot.tencent.com` |
| `WORKBUDDY_GUID`             | WorkBuddy 连接 GUID（可选）                    |
| `WORKBUDDY_WORKSPACE_PATH`   | WorkBuddy 工作区路径（可选）                   |
| `WORKBUDDY_ALLOWED_USER_IDS` | WorkBuddy 白名单                               |

### 平台配置来源

- Telegram：从 [@BotFather](https://t.me/BotFather) 获取 Bot Token
- 飞书：从 [飞书开放平台](https://open.feishu.cn/) 创建应用并启用机器人
- QQ：从 [QQ 开放平台](https://bot.q.qq.com/) 创建机器人，获取 `App ID` 和 `App Secret`
- 钉钉：从钉钉开放平台创建企业内部应用，启用机器人 Stream Mode，获取 `Client ID` 和 `Client Secret`
- 企业微信：从 [企业微信管理后台](https://work.weixin.qq.com/) 获取 Bot ID 和 Secret
- 微信（WorkBuddy）：通过 CodeBuddy（copilot.tencent.com）Centrifuge WebSocket 接入微信客服；运行 `open-im init` 并选择 "WorkBuddy 微信客服 (WeChat KF)" 完成 OAuth 登录和微信客服绑定

说明：钉钉当前采用“Stream Mode 收消息 + OpenAPI 发送消息”的混合模式。

- 会话内普通文本回复默认走 `sessionWebhook`
- 若配置了 `cardTemplateId`，会尝试 AI 助理 `prepare/update/finish` 流式卡片；失败则 fallback 为普通文本（自定义机器人/普通群场景下互动卡片 API 报 `param.error`，暂不支持单条流式更新）
- 启动/关闭通知不会发给钉钉（OpenAPI 机器人接口不支持主动发消息）；其他已配置平台（如 Telegram、飞书、企业微信）仍会收到生命周期通知

钉钉 AI 卡片模板：已适配官方「搜索结果卡片」模板，使用变量 `lastMessage`、`content`、`resources`、`users`、`flowStatus`。若使用该模板，无需修改模板即可实现流式更新。

## IM 内命令

| 命令          | 说明                                  |
| ------------- | ------------------------------------- |
| `/help`       | 显示帮助                              |
| `/new`        | 开始新会话                            |
| `/status`     | 显示 AI 工具、版本、会话目录、会话 ID |
| `/cd <路径>`  | 切换会话目录                          |
| `/pwd`        | 显示当前会话目录                      |
| `/allow` `/y` | 允许权限请求                          |
| `/deny` `/n`  | 拒绝权限请求                          |

## 故障排除

**Telegram 无响应**：检查网络，必要时在 Telegram 平台配置中添加 `"proxy": "http://127.0.0.1:7890"` 或设置 `TELEGRAM_PROXY`。

**QQ 无法连接**：确认机器人已在 QQ 开放平台创建并启用，检查 `QQ_BOT_APPID`、`QQ_BOT_SECRET` 或 `platforms.qq` 配置是否正确。

**QQ 重复回复**：如遇到消息重复发送，请确保使用最新版本，该问题已在近期修复。

**飞书卡片报错**：未配置卡片回调时，可直接用 `/mode ask`、`/mode yolo`。

**企业微信收不到通知**：需要先给机器人发过一条消息，后续才能收到主动通知。

**钉钉无法回复**：确认应用已启用机器人 Stream Mode，并检查 `DINGTALK_CLIENT_ID`、`DINGTALK_CLIENT_SECRET` 或 `platforms.dingtalk` 配置是否正确。

**钉钉没有流式更新**：`prepare` 失败时 fallback 为普通文本回复。自定义机器人/普通群场景下，AI 助理和互动卡片 API 均不可用，仅支持单条文本回复。

**Codex 报 `stream disconnected` / `error sending request`**：无法访问 `chatgpt.com`，请配置 `tools.codex.proxy` 或环境变量 `CODEX_PROXY`。

**CodeBuddy 提示需要登录**：先执行 `codebuddy login`。`open-im` 不会从 `~/.open-im/config.json` 读取 CodeBuddy 的登录态。

**WorkBuddy 无法连接**：重新运行 `open-im init` 登录。Token 可能过期——客户端会尝试自动重连，但如果 refresh token 失效，需要重新登录。

**WorkBuddy 微信客服收不到消息**：确认在 `open-im init` 中完成了微信客服绑定。可重新运行 init 生成新的绑定链接。

## License

[MIT](LICENSE)
