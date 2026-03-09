# open-im

> 🚀 把你的 AI 助手装进口袋里 - 在 Telegram 随时随地使用 Claude Code

还在受限于终端吗？用手机也能 Coding 了！

open-im 是一个轻量级的 IM 桥接工具，让你通过 Telegram 就能使用 Claude Code、Codex、Cursor 等 AI CLI 工具。无论是在咖啡厅、地铁上，还是躺在床上，你的 AI 助手随时在线。

## ✨ 为什么选择 open-im

- **📱 移动友好** - 告别终端，用手机照样写代码
- **⚡ 实时流式输出** - AI 思考过程实时可见，像在终端一样流畅
- **🔒 安全可控** - 支持白名单，只有你能用
- **🔄 独立会话** - 每个人独立 session，互不干扰
- **🛠️ 多 AI 支持** - Claude / Codex / Cursor 随意切换

## 🚀 快速开始

### 方式一：npx（无需安装）

```bash
npx @wu529778790/open-im run
```

### 方式二：全局安装（推荐常用用户）

```bash
npm i @wu529778790/open-im -g
open-im run
```

首次运行会引导你完成配置，30 秒即可搞定。

如果配置引导未出现，可以手动运行：

```bash
npx @wu529778790/open-im init
```

## ⚙️ 配置说明

配置文件位置：`~/.open-im/config.json`

配置文件示例：

```json
{
  "telegramBotToken": "你的Bot Token（从 @BotFather 获取）",
  "allowedUserIds": ["你的Telegram用户ID"],
  "claudeWorkDir": "/path/to/your/work/dir",
  "claudeSkipPermissions": true,
  "aiCommand": "claude",
  "platforms": {
    "telegram": {
      "proxy": "http://127.0.0.1:7890"
    }
  }
}
```

### 🌐 代理配置

如果你的网络环境无法直接访问 Telegram，需要配置代理。代理配置按平台独立设置，互不影响。

**配置方式：**

在 JSON 配置文件中添加：
```json
{
  "platforms": {
    "telegram": {
      "proxy": "http://127.0.0.1:7890"
    }
  }
}
```

**支持的代理类型：**
- HTTP 代理：`http://127.0.0.1:7890`
- HTTPS 代理：`https://127.0.0.1:7890`
- SOCKS5 代理：`socks5://127.0.0.1:1080`

**注意：**
- 代理仅用于访问 Telegram API，不会影响 AI 工具（Claude/Codex/Cursor）的网络请求
- 飞书等其他国内 IM 平台无需配置代理
- 如果你的网络能直接访问 Telegram，则无需配置代理

### 获取 Telegram Bot Token
1. 在 Telegram 中搜索 @BotFather
2. 发送 `/newbot` 创建新机器人
3. 按提示设置机器人名称
4. BotFather 会返回 Token，格式如：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

获取 Telegram 用户 ID（可选）：
1. 在 Telegram 中搜索 @userinfobot
2. 发送任意消息
3. 机器人会返回你的用户 ID
4. 如不设置，则所有人都可以使用你的机器人

## 📖 常用命令

| 命令 | 说明 |
|------|------|
| `open-im` / `open-im run` | 前台运行（首次使用会引导配置） |
| `open-im init` | 初始化配置（首次使用或重新配置） |
| `open-im start` | 后台启动服务 |
| `open-im stop` | 停止服务 |
| `open-im restart` | 重启服务 |

### Telegram 机器人命令

| 命令 | 功能 |
|------|------|
| `/help` | 查看帮助 |
| `/new` | 开启新会话 |
| `/cd <路径>` | 切换工作目录 |
| `/pwd` | 查看当前目录 |
| `/status` | 查看运行状态 |

## 💡 使用场景

- 🚇 **通勤路上** - 用手机处理简单的代码问题
- ☕ **咖啡厅** - 没带电脑也能快速调试
- 🛋️ **沙发模式** - 躺着看 AI 帮你写代码
- 🌙 **紧急修复** - 半夜收到报警，手机直接处理

## 📦 安装方式

```bash
# npx（无需安装）
npx @wu529778790/open-im run

# npm 全局安装
npm i @wu529778790/open-im -g

# yarn 全局安装
yarn global add @wu529778790/open-im

# pnpm 全局安装
pnpm i @wu529778790/open-im -g
```

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
