# open-im

[中文](./README.zh-CN.md)

Multi-platform IM bridge for AI CLI tools. Connect Telegram, Feishu, WeCom, DingTalk, QQ, and WeChat to Claude Code, Codex, Cursor, and CodeBuddy so you can use your coding assistant remotely from a phone or chat window.

## Features

- Multi-platform support: Telegram, Feishu, WeCom, DingTalk, QQ, and WeChat (experimental), with multiple platforms enabled at the same time
- Multiple AI tools: Claude, Codex, Cursor, and CodeBuddy
- Per-platform AI routing: each IM platform can use a different AI tool, with `aiCommand` as the global default and `platforms.<name>.aiCommand` as the override
- Streaming replies: relay AI output and tool execution progress in real time (DingTalk streaming is not fully supported yet)
- Graphical configuration page and CLI setup flow
- Isolated sessions: each user gets an independent local session, and `/new` resets it
- Built-in commands: `/help`, `/new`, `/cd`, `/pwd`, `/status`

## Requirements

- Node.js >= 20
- At least one IM platform configured
- Authentication completed for the AI tool you want to use

## Quick Start

```bash
npx @wu529778790/open-im start
```

Or install globally:

```bash
npm install -g @wu529778790/open-im
open-im start
```

The config file is stored at `~/.open-im/config.json` by default.

## CLI Commands

| Command | Description |
| ---- | ---- |
| `open-im init` | Initialize or append configuration without starting the service |
| `open-im start` | Run the service in the background |
| `open-im stop` | Stop the background service |
| `open-im dev` | Run in the foreground for development/debugging |

## Graphical Config Page

- Default URL: `http://127.0.0.1:39282`
- `open-im start` also serves the local configuration page
- `open-im dev` only opens the page automatically when setup is incomplete
- If configuration already exists and you want to open the page manually, use `open-im start`

## Session Behavior

Session context is stored locally in `~/.open-im/data/sessions.json` and is separate from the IM chat history itself. Each user has an independent session directory and session metadata. Sending `/new` resets the current AI session.

## Configuration

The root-level `aiCommand` is the default AI tool for all platforms. If you want a specific IM platform to use a different tool, set `platforms.<platform>.aiCommand`.

Example:

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
      "aiCommand": "cursor"
    },
    "qq": {
      "enabled": true,
      "aiCommand": "codebuddy"
    }
  }
}
```

In that setup, Telegram uses Codex, Feishu uses Cursor, QQ uses CodeBuddy, and any platform without its own `aiCommand` continues using Claude.

### Claude

Claude uses the Agent SDK by default and does not depend on a local `claude` executable. In most cases you only need to provide API credentials.

Load order:

1. Environment variables
2. `env` in `~/.open-im/config.json`
3. `~/.claude/settings.json` or `~/.claude.json`

Both the official API and compatible third-party endpoints are supported:

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

CodeBuddy uses the local CLI. Install it first, then either log in interactively or provide credentials through `env`.

```bash
npm install -g @tencent-ai/codebuddy-code
codebuddy --version
codebuddy login
```

Common config keys:

- `tools.codebuddy.cliPath`: CLI path, defaults to `codebuddy`
- `tools.codebuddy.skipPermissions`: whether to skip permission confirmation, defaults to `true`
- `tools.codebuddy.timeoutMs`: total execution timeout, defaults to `600000`
- `platforms.<platform>.aiCommand`: set to `codebuddy` if that IM platform should use CodeBuddy

On Windows, if `cliPath` is still `codebuddy`, open-im also tries common npm global locations such as `AppData\\Roaming\\npm\\codebuddy.cmd`.

### Example Config File

The following is valid JSON and can be saved directly as `~/.open-im/config.json`:

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
      "aiCommand": "cursor",
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
    "wechat": {
      "enabled": false,
      "aiCommand": "claude",
      "allowedUserIds": [],
      "appId": "YOUR_WECHAT_APP_ID",
      "appSecret": "YOUR_WECHAT_APP_SECRET"
    }
  }
}
```

### Common Environment Variables

| Variable | Description |
| ---- | ---- |
| `AI_COMMAND` | Select `claude`, `codex`, `cursor`, or `codebuddy` |
| `CLAUDE_WORK_DIR` | Default session working directory |
| `LOG_DIR` | Log directory |
| `LOG_LEVEL` | Log level |
| `HOOK_PORT` | Permission service port |
| `CODEX_PROXY` | Proxy used by Codex to access `chatgpt.com` |
| `OPENAI_API_KEY` | Codex API key, can replace `codex login` |
| `CURSOR_API_KEY` | Cursor API key, can replace `agent login` |
| `CODEBUDDY_CLI_PATH` | Override CodeBuddy CLI path |
| `CODEBUDDY_TIMEOUT_MS` | Override CodeBuddy timeout |
| `CODEBUDDY_SKIP_PERMISSIONS` | Override CodeBuddy skip-permissions behavior |
| `CODEBUDDY_IDLE_TIMEOUT_MS` | Abort CodeBuddy when it stays silent for too long |
| `CODEBUDDY_API_KEY` | CodeBuddy API key, can replace `codebuddy login` |
| `CODEBUDDY_AUTH_TOKEN` | CodeBuddy auth token, can replace `codebuddy login` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_PROXY` | Telegram proxy URL |
| `TELEGRAM_ALLOWED_USER_IDS` | Telegram allowlist |
| `FEISHU_APP_ID` | Feishu app ID |
| `FEISHU_APP_SECRET` | Feishu app secret |
| `FEISHU_ALLOWED_USER_IDS` | Feishu allowlist |
| `QQ_BOT_APPID` | QQ bot app ID |
| `QQ_BOT_SECRET` | QQ bot app secret |
| `QQ_BOT_SANDBOX` | QQ bot sandbox mode (`1` / `true` to enable, disabled by default) |
| `QQ_ALLOWED_USER_IDS` | QQ allowlist |
| `DINGTALK_CLIENT_ID` | DingTalk client ID / AppKey |
| `DINGTALK_CLIENT_SECRET` | DingTalk client secret / AppSecret |
| `DINGTALK_CARD_TEMPLATE_ID` | DingTalk AI card template ID; enables single-message streaming replies |
| `DINGTALK_ALLOWED_USER_IDS` | DingTalk allowlist |
| `WEWORK_CORP_ID` | WeCom bot ID |
| `WEWORK_SECRET` | WeCom secret |
| `WEWORK_WS_URL` | WeCom WebSocket URL |
| `WEWORK_ALLOWED_USER_IDS` | WeCom allowlist |
| `WECHAT_APP_ID` | WeChat standard mode app ID |
| `WECHAT_APP_SECRET` | WeChat standard mode app secret |
| `WECHAT_TOKEN` | WeChat AGP mode token |
| `WECHAT_GUID` | WeChat AGP mode GUID |
| `WECHAT_USER_ID` | WeChat AGP mode user ID |
| `WECHAT_WS_URL` | WeChat WebSocket URL |
| `WECHAT_ALLOWED_USER_IDS` | WeChat allowlist |

### Platform Setup Sources

- Telegram: get the bot token from [@BotFather](https://t.me/BotFather)
- Feishu: create an app and enable the bot in the [Feishu Open Platform](https://open.feishu.cn/)
- QQ: create a bot in the [QQ Open Platform](https://bot.q.qq.com/) and get the `App ID` and `App Secret`
- DingTalk: create an internal enterprise app in DingTalk Open Platform, enable bot Stream Mode, and get the `Client ID` and `Client Secret`
- WeCom: get the bot ID and secret from the [WeCom admin console](https://work.weixin.qq.com/)
- WeChat: experimental, supports both standard mode and AGP/Qclaw-related settings

Notes on DingTalk: the current implementation uses a hybrid model of "Stream Mode for receiving messages + OpenAPI for sending messages".

- Plain text replies in a session are sent through `sessionWebhook`
- If `cardTemplateId` is configured, the app will try AI assistant `prepare/update/finish` streaming cards; if that fails, it falls back to plain text. In custom bot or regular group scenarios, the interactive card API may return `param.error`, so single-message streaming updates are not available there yet
- Startup and shutdown notifications are sent to the most recently active DingTalk conversation. After a cold start, if no DingTalk conversation has interacted with the service yet, there is no target to notify

DingTalk AI card templates are already compatible with the official "Search Result Card" template and use the variables `lastMessage`, `content`, `resources`, `users`, and `flowStatus`. If you use that template, no template changes are required for streaming updates.

## IM Commands

| Command | Description |
| ---- | ---- |
| `/help` | Show help |
| `/new` | Start a new session |
| `/status` | Show AI tool, version, session directory, and session ID |
| `/cd <path>` | Change the session working directory |
| `/pwd` | Show the current session working directory |
| `/allow` `/y` | Approve a permission request |
| `/deny` `/n` | Reject a permission request |

## Troubleshooting

**Telegram does not respond**: check network access. If needed, add `"proxy": "http://127.0.0.1:7890"` to the Telegram platform config or set `TELEGRAM_PROXY`.

**QQ cannot connect**: make sure the bot has been created and enabled in QQ Open Platform, then verify `QQ_BOT_APPID`, `QQ_BOT_SECRET`, or `platforms.qq`.

**QQ sends duplicate replies**: update to the latest version. This issue was fixed recently.

**Feishu card errors**: if card callbacks are not configured, you can use `/mode ask` or `/mode yolo` directly.

**WeCom notifications are not received**: the bot must receive at least one message first before it can send proactive notifications.

**DingTalk cannot reply**: make sure bot Stream Mode is enabled for the app, then verify `DINGTALK_CLIENT_ID`, `DINGTALK_CLIENT_SECRET`, or `platforms.dingtalk`.

**DingTalk has no streaming updates**: when `prepare` fails, the app falls back to plain text replies. In custom bot or regular group scenarios, neither the AI assistant API nor the interactive card API is available, so only single plain text replies are supported.

**Cursor shows `Authentication required`**: run `agent login` first, or set `CURSOR_API_KEY` in `env`.

**Codex shows `stream disconnected` or `error sending request`**: `chatgpt.com` is not reachable. Configure `tools.codex.proxy` or set `CODEX_PROXY`.

**CodeBuddy prompts for login**: run `codebuddy login` first, or set `CODEBUDDY_API_KEY` / `CODEBUDDY_AUTH_TOKEN` in `env`.

## License

[MIT](LICENSE)
