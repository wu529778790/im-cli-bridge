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
npx @wu529778790/open-im start
```

### 方式二：全局安装（推荐常用用户）

```bash
npm i @wu529778790/open-im -g
open-im start
```

首次运行会引导你完成配置，30 秒即可搞定。

## 📖 常用命令

| 命令 | 说明 |
|------|------|
| `open-im start` | 启动服务（后台运行） |
| `open-im stop` | 停止服务 |

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
npx @wu529778790/open-im start

# npm 全局安装
npm i @wu529778790/open-im -g

# yarn 全局安装
yarn global add @wu529778790/open-im

# pnpm 全局安装
pnpm i @wu529778790/open-im -g
```

## 📝 License

[MIT](LICENSE)
