# open-im

多平台 IM 桥接，将 Telegram 和飞书 (Feishu/Lark) 连接到 AI CLI 工具（Claude Code、Codex、Cursor），实现移动端/远程访问 AI 编程助手。

## 功能特性

- **多平台**：支持 Telegram 和飞书，可同时启用
- **多 AI 工具**：通过配置切换 Claude Code / Codex / Cursor
- **流式输出**：节流更新，实时展示 AI 回复
- **会话管理**：每用户独立 session，`/new` 重置会话
- **命令支持**：`/help` `/new` `/cd` `/pwd` `/status` `/allow` `/deny`

## 环境要求

- **Node.js** >= 20
- **AI CLI**：已安装 Claude Code CLI（或 Codex/Cursor）并加入 PATH

## 安装

### 正式版

```bash
npm install @wu529778790/open-im -g
```

### 预览版 (包含最新功能)

```bash
npm install @wu529778790/open-im@next -g
```

> 💡 `@next` 标签包含最新的预览版本（alpha/beta/rc），可能有实验性功能，不建议生产环境使用。

## ✨ 为什么选择 open-im

```bash
# 使用 npx 快速体验（无需全局安装）
npx @wu529778790/open-im start    # 后台运行
npx @wu529778790/open-im stop     # 停止后台进程
npx @wu529778790/open-im dev     # 前台运行（调试），Ctrl+C 停止
```

或全局安装后直接使用：

```bash
npm install @wu529778790/open-im -g
open-im start
```

首次运行会进入交互式配置向导，按提示输入 Token 后自动启动。配置保存到 `~/.open-im/config.json`。

## 运行方式

| 命令 | 说明 |
|------|------|
| `open-im start` | 后台运行，适合长期使用 |
| `open-im stop` | 停止后台进程 |
| `open-im dev` 或 `open-im` | 前台运行（调试），Ctrl+C 停止 |

## 会话说明

**会话上下文存储在本地**（`~/.open-im/data/sessions.json`），与 IM 聊天记录无关。每用户在本地维护独立的 session 和 Claude 会话 ID，`/new` 可重置当前会话。

```bash
npm i @wu529778790/open-im -g
open-im run
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token（从 @BotFather 获取） |
| `FEISHU_APP_ID` | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret |
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

### 配置文件

配置优先级：环境变量 > `~/.open-im/config.json` > 默认值。

至少需配置 **Telegram** 或 **飞书** 其一：

- **Telegram**：`TELEGRAM_BOT_TOKEN` 或 `telegramBotToken`
- **飞书**：`FEISHU_APP_ID` + `FEISHU_APP_SECRET` 或 `feishuAppId` + `feishuAppSecret`

### 飞书配置说明

1. 在 [飞书开放平台](https://open.feishu.cn/) 创建企业自建应用
2. 开启「机器人」能力
3. 配置事件订阅：启用 `im.message.receive_v1`，使用 **长连接** 模式（WebSocket）
4. 将机器人添加到目标群聊或发起私聊

## 开发

```bash
npm run build      # 构建
npm run dev        # 直接运行源码（tsx，无需 build）
npm run foreground # 前台运行已构建版本
```

## IM 内命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/new` | 开始新会话 |
| `/status` | 显示状态（AI 工具、工作目录、费用等） |
| `/cd <路径>` | 切换工作目录 |
| `/pwd` | 显示当前工作目录 |
| `/allow` `/y` | 允许权限请求 |
| `/deny` `/n` | 拒绝权限请求 |

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
     "telegramBotToken": "你的Bot Token",
     "allowedUserIds": ["你的Telegram用户ID"],
     "platforms": {
       "telegram": {
         "proxy": "http://127.0.0.1:7890"
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
npx @wu529778790/open-im run
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
