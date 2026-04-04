# open-im

[中文文档](./README.zh-CN.md)

Multi-platform IM bridge for AI CLI tools. Connect Telegram, Feishu, WeCom, DingTalk, QQ, and WeChat to Claude Code, Codex, and CodeBuddy — use your AI coding assistant from any phone or chat window.

## Features

- **6 IM platforms** — Telegram, Feishu, WeCom, DingTalk, QQ, WeChat (WorkBuddy), all can run simultaneously
- **3 AI backends** — Claude (Agent SDK), Codex, CodeBuddy
- **Per-platform AI routing** — each IM can use a different AI tool
- **Streaming replies** — real-time AI output and tool progress (platform-dependent)
- **Media support** — send images, files, voice, video for AI analysis
- **Session isolation** — independent sessions per user, `/new` to reset
- **Web config UI** — graphical dashboard for setup and management
- **Built-in commands** — `/help`, `/new`, `/cd`, `/pwd`, `/status`, `/allow`, `/deny`

## Requirements

- Node.js >= 20
- At least one IM platform configured
- Authentication for the AI tool you want to use

## Quick Start

```bash
npx @wu529778790/open-im start
```

Or install globally:

```bash
npm install -g @wu529778790/open-im
open-im start
```

Config file: `~/.open-im/config.json`

## CLI Commands

| Command             | Description                            |
| ------------------- | -------------------------------------- |
| `open-im init`      | Configure without starting the service |
| `open-im start`     | Run as background service              |
| `open-im stop`      | Stop background service                |
| `open-im dev`       | Run in foreground (debugging)          |
| `open-im dashboard` | Web config UI only (no bridge)         |

## Web Configuration

### Local

Open [`http://127.0.0.1:39282`](http://127.0.0.1:39282) after starting. The dashboard includes:

- **Overview** — platform count, service status
- **Platforms** — enable and configure each IM (credentials, proxy, AI tool, allowed users)
- **AI Tooling** — default tool, work directory, per-tool settings (CLI path, timeout, proxy, API keys)
- **Service control** — validate, save, start/stop bridge

> WorkBuddy (WeChat) is configured via `open-im init` or directly in `~/.open-im/config.json`.

### Remote Server

```bash
export OPEN_IM_NO_BROWSER=1
# Optional: allow access from other devices
# export OPEN_IM_WEB_HOST=0.0.0.0
open-im dashboard
```

If `OPEN_IM_WEB_HOST=0.0.0.0`, the server prints a one-time login URL:

```
http://your-server-ip:39282/?login_token=xxxx
```

Complete setup in the browser, then start the bridge:

```bash
open-im start
```

## IM Commands

| Command       | Description                          |
| ------------- | ------------------------------------ |
| `/help`       | Show help                            |
| `/new`        | Start a new AI session               |
| `/status`     | Show AI tool, version, session info  |
| `/cd <path>`  | Change session working directory     |
| `/pwd`        | Show current working directory       |
| `/allow` `/y` | Approve a permission request         |
| `/deny` `/n`  | Reject a permission request          |

## Session Behavior

Sessions are stored locally in `~/.open-im/data/sessions.json`, separate from IM chat history. Each user gets an independent session directory. `/new` resets the AI session.

## Configuration

### Per-Platform AI Routing

The root-level `aiCommand` is the default AI tool. Override per-platform with `platforms.<name>.aiCommand`:

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

### Claude (Agent SDK)

Claude uses the Agent SDK by default — no local `claude` executable needed. Provide API credentials:

Credential load order:
1. Environment variables
2. `env` in `~/.open-im/config.json`
3. `~/.claude/settings.json` or `~/.claude.json`

Compatible with third-party endpoints:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_BASE_URL": "https://your-api-endpoint",
    "ANTHROPIC_MODEL": "glm-4.7"
  }
}
```

Claude automatically inherits plugins and settings from your local `~/.claude/settings.json`.

### CodeBuddy

Install the CLI and log in:

```bash
npm install -g @tencent-ai/codebuddy-code
codebuddy login
```

Config keys:
- `tools.codebuddy.cliPath` — CLI path (default: `codebuddy`)
- `tools.codebuddy.skipPermissions` — skip permission prompts (default: `true`)
- `tools.codebuddy.timeoutMs` — execution timeout (default: `600000`)

On Windows, if `cliPath` is `codebuddy`, open-im also checks `AppData\Roaming\npm\codebuddy.cmd`.

### Example Config

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

### Environment Variables

#### General

| Variable            | Description                                    |
| ------------------- | ---------------------------------------------- |
| `AI_COMMAND`        | Default AI tool (`claude` / `codex` / `codebuddy`) |
| `CLAUDE_WORK_DIR`   | Default session working directory              |
| `LOG_DIR`           | Log directory                                  |
| `LOG_LEVEL`         | Log level                                      |
| `HOOK_PORT`         | Permission service port                        |

#### AI Tool Credentials

| Variable                     | Description                                |
| ---------------------------- | ------------------------------------------ |
| `ANTHROPIC_API_KEY`          | Claude API key                             |
| `ANTHROPIC_AUTH_TOKEN`       | Claude OAuth token                         |
| `ANTHROPIC_BASE_URL`         | Claude API base URL                        |
| `ANTHROPIC_MODEL`            | Claude model name                          |
| `OPENAI_API_KEY`             | Codex API key                              |
| `CODEX_PROXY`                | Codex proxy for `chatgpt.com`              |
| `CODEBUDDY_CLI_PATH`         | CodeBuddy CLI path                         |
| `CODEBUDDY_TIMEOUT_MS`       | CodeBuddy timeout                          |
| `CODEBUDDY_API_KEY`          | CodeBuddy API key                          |
| `CODEBUDDY_AUTH_TOKEN`       | CodeBuddy auth token                       |

#### Platform Credentials

| Variable                     | Description                                |
| ---------------------------- | ------------------------------------------ |
| `TELEGRAM_BOT_TOKEN`         | Telegram bot token                         |
| `TELEGRAM_PROXY`             | Telegram proxy URL                         |
| `TELEGRAM_ALLOWED_USER_IDS`  | Telegram allowed user IDs                  |
| `FEISHU_APP_ID`              | Feishu app ID                              |
| `FEISHU_APP_SECRET`          | Feishu app secret                          |
| `FEISHU_ALLOWED_USER_IDS`    | Feishu allowed user IDs                    |
| `QQ_BOT_APPID`               | QQ bot app ID                              |
| `QQ_BOT_SECRET`              | QQ bot app secret                          |
| `QQ_BOT_SANDBOX`             | QQ sandbox mode (`1` / `true`)             |
| `QQ_ALLOWED_USER_IDS`        | QQ allowed user IDs                        |
| `DINGTALK_CLIENT_ID`         | DingTalk client ID / AppKey                |
| `DINGTALK_CLIENT_SECRET`     | DingTalk client secret / AppSecret         |
| `DINGTALK_CARD_TEMPLATE_ID`  | DingTalk AI card template ID               |
| `DINGTALK_ALLOWED_USER_IDS`  | DingTalk allowed user IDs                  |
| `WEWORK_CORP_ID`             | WeCom bot ID                               |
| `WEWORK_SECRET`              | WeCom secret                               |
| `WEWORK_WS_URL`              | WeCom WebSocket URL                        |
| `WEWORK_ALLOWED_USER_IDS`    | WeCom allowed user IDs                     |
| `WORKBUDDY_ACCESS_TOKEN`     | WorkBuddy OAuth access token               |
| `WORKBUDDY_REFRESH_TOKEN`    | WorkBuddy OAuth refresh token              |
| `WORKBUDDY_USER_ID`          | WorkBuddy user ID                          |
| `WORKBUDDY_BASE_URL`         | WorkBuddy API base URL                     |
| `WORKBUDDY_ALLOWED_USER_IDS` | WorkBuddy allowed user IDs                 |

### Platform Setup

| Platform  | Setup source                                                    |
| --------- | --------------------------------------------------------------- |
| Telegram  | [@BotFather](https://t.me/BotFather)                           |
| Feishu    | [Feishu Open Platform](https://open.feishu.cn/)                |
| QQ        | [QQ Open Platform](https://bot.q.qq.com/)                      |
| DingTalk  | DingTalk Open Platform — enable bot Stream Mode                |
| WeCom     | [WeCom admin console](https://work.weixin.qq.com/)             |
| WeChat    | Run `open-im init` and select "WorkBuddy" for OAuth + binding  |

**DingTalk notes:**
- Uses Stream Mode (receive) + OpenAPI (send)
- With `cardTemplateId`: AI assistant streaming cards; falls back to plain text on failure
- Custom bots and regular groups only support single text replies
- Startup/shutdown notifications are not sent to DingTalk

## Troubleshooting

| Issue | Solution |
| ----- | -------- |
| Telegram not responding | Check network, add `proxy` or set `TELEGRAM_PROXY` |
| QQ cannot connect | Verify bot is created and `QQ_BOT_APPID` / `QQ_BOT_SECRET` are correct |
| QQ duplicate replies | Update to latest version |
| Feishu card errors | Use `/mode ask` or `/mode yolo` without card callbacks |
| WeCom no notifications | Send at least one message to the bot first |
| DingTalk cannot reply | Verify Stream Mode is enabled and credentials are correct |
| DingTalk no streaming | Custom bots only support plain text; configure `cardTemplateId` for AI assistant streaming |
| Codex `stream disconnected` | Configure `tools.codex.proxy` or `CODEX_PROXY` for `chatgpt.com` access |
| CodeBuddy asks for login | Run `codebuddy login` first |
| WorkBuddy cannot connect | Run `open-im init` to re-authenticate; tokens may expire |
| WorkBuddy WeChat not receiving | Re-run `open-im init` to generate new WeChat KF binding link |

## License

[MIT](LICENSE)
