# open-im

多平台 IM 桥接工具，把 Telegram、飞书、企业微信、钉钉、QQ、微信接到 AI CLI 工具（Claude Code、Codex、Cursor），方便在手机或聊天窗口里远程使用 AI 编程助手。

## 功能特性

- 多平台：支持 Telegram、飞书、企业微信、钉钉、QQ、微信（测试中），可同时启用
- 多 AI 工具：支持 Claude、Codex、Cursor
- 流式输出：实时回传 AI 回复与工具执行进度（目前钉钉暂未实现流式传输）
- 图形化配置页面 / cli配置引导
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

| 命令 | 说明 |
| ---- | ---- |
| `open-im init` | 初始化或追加配置，不启动服务 |
| `open-im start` | 后台运行服务 |
| `open-im stop` | 停止后台服务 |
| `open-im dev` | 前台运行（调试模式） |

## 图形化配置页面

- 默认地址：`http://127.0.0.1:39282`
- `open-im start` 会同时提供本地配置页面
- `open-im dev` 仅在未完成配置时自动打开页面
- 已有配置但想手动打开时，使用 `open-im start`

## 会话说明

会话上下文保存在本地 `~/.open-im/data/sessions.json`，与 IM 聊天记录本身无关。每个用户有独立会话目录和 session 信息，发送 `/new` 会重置当前 AI 会话。

## 配置说明

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
    "cursor": {
      "cliPath": "agent",
      "skipPermissions": true
    },
    "codex": {
      "cliPath": "codex",
      "workDir": "D:/coding/open-im",
      "skipPermissions": true,
      "proxy": "http://127.0.0.1:7890"
    }
  },
  "platforms": {
    "telegram": {
      "enabled": true,
      "proxy": "http://127.0.0.1:7890",
      "allowedUserIds": [],
      "botToken": "YOUR_TELEGRAM_BOT_TOKEN"
    },
    "feishu": {
      "enabled": false,
      "allowedUserIds": [],
      "appId": "YOUR_FEISHU_APP_ID",
      "appSecret": "YOUR_FEISHU_APP_SECRET"
    },
    "qq": {
      "enabled": false,
      "allowedUserIds": [],
      "appId": "YOUR_QQ_APP_ID",
      "secret": "YOUR_QQ_APP_SECRET"
    },
    "wework": {
      "enabled": false,
      "allowedUserIds": [],
      "corpId": "YOUR_WEWORK_CORP_ID",
      "secret": "YOUR_WEWORK_SECRET"
    },
    "dingtalk": {
      "enabled": false,
      "allowedUserIds": [],
      "clientId": "YOUR_DINGTALK_CLIENT_ID",
      "clientSecret": "YOUR_DINGTALK_CLIENT_SECRET",
      "cardTemplateId": "YOUR_DINGTALK_AI_CARD_TEMPLATE_ID"
    },
    "wechat": {
      "enabled": false,
      "allowedUserIds": [],
      "appId": "YOUR_WECHAT_APP_ID",
      "appSecret": "YOUR_WECHAT_APP_SECRET"
    }
  }
}
```

### 常用环境变量

| 变量 | 说明 |
| ---- | ---- |
| `AI_COMMAND` | 选择 `claude` / `codex` / `cursor` |
| `CLAUDE_WORK_DIR` | 默认会话目录 |
| `LOG_DIR` | 日志目录 |
| `LOG_LEVEL` | 日志级别 |
| `HOOK_PORT` | 权限服务端口 |
| `CODEX_PROXY` | Codex 访问 `chatgpt.com` 的代理 |
| `OPENAI_API_KEY` | Codex API Key，可替代 `codex login` |
| `CURSOR_API_KEY` | Cursor API Key，可替代 `agent login` |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token |
| `TELEGRAM_PROXY` | Telegram 代理地址 |
| `TELEGRAM_ALLOWED_USER_IDS` | Telegram 白名单 |
| `FEISHU_APP_ID` | 飞书 App ID |
| `FEISHU_APP_SECRET` | 飞书 App Secret |
| `FEISHU_ALLOWED_USER_IDS` | 飞书白名单 |
| `QQ_BOT_APPID` | QQ 机器人 App ID |
| `QQ_BOT_SECRET` | QQ 机器人 App Secret |
| `QQ_BOT_SANDBOX` | QQ 机器人沙箱模式（`1`/`true` 启用，默认关闭）|
| `QQ_ALLOWED_USER_IDS` | QQ 白名单 |
| `DINGTALK_CLIENT_ID` | 钉钉应用 Client ID / AppKey |
| `DINGTALK_CLIENT_SECRET` | 钉钉应用 Client Secret / AppSecret |
| `DINGTALK_CARD_TEMPLATE_ID` | 钉钉 AI 卡片模板 ID，配置后启用单条流式回复 |
| `DINGTALK_ALLOWED_USER_IDS` | 钉钉白名单 |
| `WEWORK_CORP_ID` | 企业微信 Bot ID |
| `WEWORK_SECRET` | 企业微信 Secret |
| `WEWORK_WS_URL` | 企业微信 WebSocket 地址 |
| `WEWORK_ALLOWED_USER_IDS` | 企业微信白名单 |
| `WECHAT_APP_ID` | 微信标准模式 App ID |
| `WECHAT_APP_SECRET` | 微信标准模式 App Secret |
| `WECHAT_TOKEN` | 微信 AGP 模式 Token |
| `WECHAT_GUID` | 微信 AGP 模式 GUID |
| `WECHAT_USER_ID` | 微信 AGP 模式 User ID |
| `WECHAT_WS_URL` | 微信 WebSocket 地址 |
| `WECHAT_ALLOWED_USER_IDS` | 微信白名单 |

### 平台配置来源

- Telegram：从 [@BotFather](https://t.me/BotFather) 获取 Bot Token
- 飞书：从 [飞书开放平台](https://open.feishu.cn/) 创建应用并启用机器人
- QQ：从 [QQ 开放平台](https://bot.q.qq.com/) 创建机器人，获取 `App ID` 和 `App Secret`
- 钉钉：从钉钉开放平台创建企业内部应用，启用机器人 Stream Mode，获取 `Client ID` 和 `Client Secret`
- 企业微信：从 [企业微信管理后台](https://work.weixin.qq.com/) 获取 Bot ID 和 Secret
- 微信：测试中，支持标准模式和 AGP/Qclaw 相关配置

说明：钉钉当前采用“Stream Mode 收消息 + OpenAPI 发送消息”的混合模式。

- 会话内普通文本回复默认走 `sessionWebhook`
- 若配置了 `cardTemplateId`，会尝试 AI 助理 `prepare/update/finish` 流式卡片；失败则 fallback 为普通文本（自定义机器人/普通群场景下互动卡片 API 报 param.error，暂不支持单条流式更新）
- 启动/关闭通知会发给最近一次已互动的钉钉会话；如果服务冷启动后还没有任何钉钉会话互动过，则没有可用目标可发

钉钉 AI 卡片模板：已适配官方「搜索结果卡片」模板，使用变量 `lastMessage`、`content`、`resources`、`users`、`flowStatus`。若使用该模板，无需修改模板即可实现流式更新。

## IM 内命令

| 命令 | 说明 |
| ---- | ---- |
| `/help` | 显示帮助 |
| `/new` | 开始新会话 |
| `/status` | 显示 AI 工具、版本、会话目录、会话 ID |
| `/cd <路径>` | 切换会话目录 |
| `/pwd` | 显示当前会话目录 |
| `/allow` `/y` | 允许权限请求 |
| `/deny` `/n` | 拒绝权限请求 |

## 故障排除

**Telegram 无响应**：检查网络，必要时在 Telegram 平台配置中添加 `"proxy": "http://127.0.0.1:7890"` 或设置 `TELEGRAM_PROXY`。

**QQ 无法连接**：确认机器人已在 QQ 开放平台创建并启用，检查 `QQ_BOT_APPID`、`QQ_BOT_SECRET` 或 `platforms.qq` 配置是否正确。

**QQ 重复回复**：如遇到消息重复发送，请确保使用最新版本，该问题已在近期修复。

**飞书卡片报错**：未配置卡片回调时，可直接用 `/mode ask`、`/mode yolo`。

**企业微信收不到通知**：需要先给机器人发过一条消息，后续才能收到主动通知。

**钉钉无法回复**：确认应用已启用机器人 Stream Mode，并检查 `DINGTALK_CLIENT_ID`、`DINGTALK_CLIENT_SECRET` 或 `platforms.dingtalk` 配置是否正确。

**钉钉没有流式更新**：prepare 失败时 fallback 为普通文本回复。自定义机器人/普通群场景下，AI 助理和互动卡片 API 均不可用，仅支持单条文本回复。

**Cursor 报 `Authentication required`**：先执行 `agent login`，或在 `env` 中设置 `CURSOR_API_KEY`。

**Codex 报 `stream disconnected` / `error sending request`**：无法访问 `chatgpt.com`，请配置 `tools.codex.proxy` 或环境变量 `CODEX_PROXY`。

## License

[MIT](LICENSE)
