# IM CLI Bridge - 开发者指南

IM 平台（Telegram/飞书）与 AI CLI（codex、claude 等）的桥梁，支持流式输出与 Codex 输出过滤。

## 命令

```bash
npm run dev      # 前台开发
npm run build    # 编译
npm start        # 前台运行
npm run start:bg # 后台启动
npm run stop     # 后台停止
npm run pkg:build # 打包独立可执行文件
```

## 架构

1. **IM 客户端** → 接收消息
2. **EventEmitter** → 广播 `message:received`
3. **Router** → 解析命令 / 普通消息 → ShellExecutor 执行 AI CLI
4. **output-extractor** → 过滤 Codex 输出，提取可读回复
5. **IM 客户端** → 追加发送回复（不覆盖）

### 核心文件

| 文件 | 说明 |
|------|------|
| `src/index.ts` | 主入口，初始化 Telegram + Router |
| `src/core/router.ts` | 消息路由、流式执行、追加发送 |
| `src/executors/shell-executor.ts` | 流式执行 shell 命令 |
| `src/config/ai-adapters.ts` | 各 AI CLI 的参数配置 |
| `src/utils/output-extractor.ts` | Codex/Claude 输出过滤 |

### 配置

- `src/config/default.config.ts` - 默认配置
- `.env` - TELEGRAM_BOT_TOKEN、AI_COMMAND、LOG_LEVEL

### 环境变量

- `TELEGRAM_BOT_TOKEN` - 必填
- `AI_COMMAND` - codex / claude / claudecode
- `LOG_LEVEL` - debug / info / warn / error
