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
- **AI CLI**：已安装 Claude Code CLI（或 Codex/Cursor）并加入 PATH

## 安装

```bash
npm install @wu529778790/open-im -g
```

## 快速开始

```bash
# 使用 npx 快速体验（无需全局安装）
npx @wu529778790/open-im init    # 初始化配置
npx @wu529778790/open-im start   # 后台运行
npx @wu529778790/open-im stop    # 停止后台服务
npx @wu529778790/open-im dev     # 前台运行（调试），Ctrl+C 停止
```

或全局安装后直接使用：

```bash
npm install @wu529778790/open-im -g
open-im init    # 初始化配置
open-im start   # 后台运行
```

配置保存到 `~/.open-im/config.json`。

## 命令说明

| 命令 | 说明 |
|------|------|
| `open-im init` | 初始化配置（不启动服务） |
| `open-im start` | 后台运行，适合长期使用 |
| `open-im stop` | 停止后台服务 |
| `open-im dev` | 前台运行（调试模式），Ctrl+C 停止 |

## 开发

```bash
npm run build      # 构建编译
npm run dev        # 直接运行源码（tsx，无需 build）
```

## 会话说明

**会话上下文存储在本地**（`~/.open-im/data/sessions.json`），与 IM 聊天记录无关。每用户在本地维护独立的 session 和 Claude 会话 ID，`/new` 可重置当前会话。

### 环境变量

| 变量 | 说明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token（从 @BotFather 获取） |
| `FEISHU_APP_ID` | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret |
| `WEWORK_CORP_ID` | 企业微信机器人 ID（Bot ID） |
| `WEWORK_SECRET` | 企业微信机器人 Secret |
| `WEWORK_WS_URL` | 企业微信 WebSocket URL（可选，默认官方） |
| `WECHAT_APP_ID` | 微信应用 App ID（AGP/Qclaw 协议，测试中） |
| `WECHAT_APP_SECRET` | 微信应用 App Secret |
| `WECHAT_WS_URL` | AGP WebSocket URL（可选，默认使用官方服务） |
| `ALLOWED_USER_IDS` | 白名单用户 ID（逗号分隔，空=所有人） |
| `AI_COMMAND` | `claude` \| `codex` \| `cursor`，默认 `claude` |
| `CLAUDE_CLI_PATH` | Claude CLI 路径，默认 `claude` |
| `CLAUDE_WORK_DIR` | 工作目录 |
| `CLAUDE_SKIP_PERMISSIONS` | 跳过权限确认，默认 `true` |
| `CLAUDE_TIMEOUT_MS` | Claude 超时（毫秒），默认 600000 |
| `CLAUDE_MODEL` | Claude 模型（可选） |
| `ALLOWED_BASE_DIRS` | 允许访问的目录（逗号分隔） |
| `LOG_DIR` | 日志目录，默认 `~/.open-im/logs` |
| `LOG_LEVEL` | 日志级别：INFO/DEBUG/WARN/ERROR |

### Claude API 配置

使用 Claude 时，需要配置 API 密钥。支持以下几种认证方式：

#### 认证方式

**方式 1：API Key（官方 API）**
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```
从 [Anthropic Console](https://console.anthropic.com/) 获取。

**方式 2：Auth Token（官方 API）**
```bash
export ANTHROPIC_AUTH_TOKEN="your-token"
```
运行 `claude setup-token` 生成 OAuth Token。

**方式 3：自定义 API（第三方模型/代理）**
```bash
export ANTHROPIC_AUTH_TOKEN="your-token"
export ANTHROPIC_BASE_URL="https://your-api-endpoint"
```

#### 配置方式

**方式 1：环境变量（推荐）**
```bash
export ANTHROPIC_API_KEY="your-api-key"
# 或
export ANTHROPIC_AUTH_TOKEN="your-auth-token"
```

**方式 2：配置文件**
在 `~/.open-im/config.json` 中添加：
```json
{
  "env": {
    "ANTHROPIC_API_KEY": "your-api-key"
  }
}
```

**方式 3：运行配置向导**
```bash
open-im init
```
配置向导会引导你设置 API 密钥（可留空，稍后配置）。

#### 完整配置选项

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "ANTHROPIC_AUTH_TOKEN": "00c4a6c7-bdc3-42b7-ab30-1b0f224135a4",
    "ANTHROPIC_BASE_URL": "https://ark.cn-beijing.volces.com/api/coding",
    "ANTHROPIC_MODEL": "glm-4.7",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.7",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-4.7",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-4.7"
  }
}
```

**配置说明**：
- **API Key / Auth Token**：必填其一（使用官方 API 时）
  - `ANTHROPIC_API_KEY`：以 `sk-` 开头，从 Console 获取
  - `ANTHROPIC_AUTH_TOKEN`：UUID 格式，运行 `claude setup-token` 生成，或使用第三方模型提供的 token
- **Base URL**：可选
  - 留空使用官方 API
  - 使用第三方模型或代理时填写自定义端点
- **模型配置**：可选，留空使用默认模型
  - `ANTHROPIC_MODEL`：默认模型
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL`：Haiku 层级模型
  - `ANTHROPIC_DEFAULT_SONNET_MODEL`：Sonnet 层级模型
  - `ANTHROPIC_DEFAULT_OPUS_MODEL`：Opus 层级模型

#### 使用官方 API

使用官方 API 时，只需配置 API Key 或 Auth Token：
```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-..."
  }
}
```

其他字段留空即可，系统会使用官方默认值。

#### 使用第三方模型/自定义 API

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-custom-token",
    "ANTHROPIC_BASE_URL": "https://your-api-endpoint",
    "ANTHROPIC_MODEL": "glm-4.7",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.7",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-4.7",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-4.7"
  }
}
```

### 配置文件

配置优先级：环境变量 > `~/.open-im/config.json` > 默认值。

至少需配置 **Telegram**、**飞书**、**企业微信** 或 **微信** 其中一个：

- **Telegram**：`TELEGRAM_BOT_TOKEN` 或 `telegramBotToken`
- **飞书**：`FEISHU_APP_ID` + `FEISHU_APP_SECRET` 或 `feishuAppId` + `feishuAppSecret`
- **企业微信**：`WEWORK_CORP_ID` + `WEWORK_SECRET` 或 `platforms.wework.corpId` + `platforms.wework.secret`
- **微信**：`WECHAT_APP_ID` + `WECHAT_APP_SECRET` 或 `wechatAppId` + `wechatAppSecret`（测试中，基于 Qclaw 通道，连接可能不稳定）

### 飞书配置说明

1. 在 [飞书开放平台](https://open.feishu.cn/) 创建企业自建应用
2. 开启「机器人」能力
3. 配置事件订阅：启用 `im.message.receive_v1`（接收消息），使用 **长连接** 模式（WebSocket）
4. **卡片按钮（/mode、权限允许/拒绝）需额外配置回调**：
   - 打开 [开放平台](https://open.feishu.cn/app) → 进入你的应用 → **「事件与回调」**
   - 注意：页面有 **「事件」** 和 **「回调」** 两个 Tab，卡片在 **「回调」** 里，不在「事件」里
   - 切换到 **「回调」** Tab → 选择 **「使用长连接接收回调」**
   - 点击 **「添加回调」**（或类似按钮）→ 在列表中找到 **「卡片回传交互」**（`card.action.trigger`）
   - 若列表里搜不到，可尝试：切换分类、搜「action」或「trigger」、或直接浏览「消息与群组」相关分类
5. 将机器人添加到目标群聊或发起私聊

**若点击 /mode 卡片按钮报错**：说明未配置卡片回调。配置较复杂时，可直接用 `/mode ask`、`/mode yolo` 等命令切换模式，无需卡片。

### 企业微信配置说明

1. 在 [企业微信管理后台](https://work.weixin.qq.com/) 创建企业自建应用
2. 进入「应用管理」→ 选择你的应用 → 获取 **AgentId** 和 **Secret**
3. 开启「智能机器人」能力，获取 **机器人 ID（Bot ID）** 和 **机器人 Secret**
4. 配置到 `~/.open-im/config.json`：
   ```json
   {
     "platforms": {
       "wework": {
         "enabled": true,
         "corpId": "你的机器人ID",
         "secret": "你的机器人Secret",
         "allowedUserIds": []
       }
     }
   }
   ```
5. 将机器人添加到目标群聊或发起私聊

**说明**：企业微信使用 WebSocket 长连接（`wss://openws.work.weixin.qq.com`），连接建立后会自动订阅，支持接收消息、回复消息和主动推送（如启动/关闭通知）。首次启动时，需用户先发一条消息，机器人才能向其推送启动通知。

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

### Q: 首次运行没有配置引导？

如果配置引导没有出现，尝试以下方法：

1. **手动运行配置命令：**

   ```bash
   npx @wu529778790/open-im init
   ```

2. **检查是否已有配置文件：**

   ```bash
   cat ~/.open-im/config.json
   ```

3. **手动创建配置文件：**

   ```bash
   mkdir -p ~/.open-im
   cat > ~/.open-im/config.json << 'EOF'
   {
     "platforms": {
       "telegram": {
         "enabled": true,
         "botToken": "你的Bot Token",
         "allowedUserIds": ["你的Telegram用户ID"]
       },
       "wework": {
         "enabled": true,
         "corpId": "你的企业微信机器人ID",
         "secret": "你的企业微信机器人Secret",
         "allowedUserIds": []
       }
     },
     "claudeWorkDir": "$(pwd)",
     "claudeSkipPermissions": true,
     "aiCommand": "claude"
   }
   EOF
   ```

### Q: 启动后服务立即退出？

可能是配置文件无效，检查配置：

```bash
# 查看日志
tail -f ~/.open-im/logs/*.log

# 重新配置
rm ~/.open-im/config.json
open-im init
```

### Q: 如何获取 Telegram Bot Token？

1. 在 Telegram 中搜索 @BotFather
2. 发送 `/newbot` 创建新机器人
3. 按提示设置机器人名称
4. BotFather 会返回 Token，格式如：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

### Q: 如何获取 Telegram 用户 ID？

1. 在 Telegram 中搜索 @userinfobot
2. 点击"START"或发送任意消息
3. 机器人会返回你的用户 ID（数字）

### Q: 如何配置代理？

如果你的网络环境无法直接访问 Telegram，需要在配置文件中添加代理设置：

```json
{
  "platforms": {
    "telegram": {
      "proxy": "http://127.0.0.1:7890"
    }
  }
}
```

支持的代理格式：

- HTTP：`http://127.0.0.1:7890`
- HTTPS：`https://127.0.0.1:7890`
- SOCKS5：`socks5://127.0.0.1:1080`

注意：代理仅用于访问 Telegram API，不影响 AI 工具的网络请求。

### Q: Telegram 机器人无响应？

可能原因及解决方法：

1. **网络问题 - Telegram 被阻断**
   - 配置代理（见上方"如何配置代理"）
   - 测试代理是否可用：`curl -x http://127.0.0.1:7890 https://api.telegram.org`

2. **Token 错误**
   - 重新获取 Token：在 @BotFather 中使用 `/revoke` 命令

3. **用户 ID 白名单问题**
   - 检查配置文件中的 `allowedUserIds` 是否包含你的用户 ID
   - 或留空允许所有人访问（仅开发环境建议）

### Q: 飞书 /mode 卡片点击报错（如 200340）？

说明未配置**卡片回调**。注意：卡片在 **「回调」** Tab，不在「事件」Tab。

1. 打开 [飞书开放平台](https://open.feishu.cn/app) → 进入你的应用 → **「事件与回调」**
2. 切换到 **「回调」** Tab（不是「事件」）
3. 选择 **「使用长连接接收回调」**
4. 添加 **「卡片回传交互」**（`card.action.trigger`）— 若搜不到，可尝试搜「action」「trigger」或浏览分类

**更简单**：直接用 `/mode ask`、`/mode yolo` 等命令切换模式，无需配置卡片。

### Q: 企业微信 846609（aibot websocket not subscribed）？

说明在订阅确认完成前就发送了主动消息。当前版本已修复：连接建立后会等待服务端订阅确认（`errcode: 0`）后再发送启动通知。若仍出现，请检查网络或重启服务。

### Q: 企业微信收不到启动通知？

启动通知需要用户先发过消息，系统才能获取到 chatId。请先向机器人发送任意消息（如「你好」），之后重启服务即可收到启动/关闭通知。

### Q: 微信连接失败（错误 1006 或 500）？

微信通道基于 **Qclaw** 接入，目前处于**测试阶段**，连接可能不稳定。若出现连接失败，可能原因：

1. **Qclaw 通道限制**
   - Qclaw 通道可能有白名单限制
   - 独立客户端可能不在允许列表中
   - token 或 guid 无效或已过期

2. **建议**
   - 确认 token 和 guid 是否正确
   - 尝试更新 token/guid（如果提供商支持）
   - 或暂时使用其他平台（Telegram/飞书/企业微信）

**注意**：微信通道为测试功能，基于 Qclaw 接入，连接稳定性取决于第三方服务。建议优先使用 Telegram、飞书或企业微信。
