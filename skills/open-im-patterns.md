---
name: open-im-patterns
description: open-im 多平台 IM 桥接服务编码模式
version: 1.0.0
source: local-git-analysis
analyzed_commits: 200
---

# Open-IM 编码模式

## Commit 约定

本项目使用 **Conventional Commits** 格式：

- `feat:` - 新功能（如：添加新平台支持）
- `fix:` - Bug 修复
- `refactor:` - 代码重构（不改变功能）
- `chore:` - 维护任务（如：清理无用文件、版本更新）
- `docs:` - 文档更新

示例：
```
feat: Add WeWork platform integration via AI Bot WebSocket
fix: Update user ID extraction in Feishu event handler
refactor: Streamline process spawning in CLI and process pool
```

## 代码架构

```
src/
├── telegram/           # Telegram 平台模块
│   ├── client.ts       # Telegraf bot 初始化和代理支持
│   ├── event-handler.ts # 消息/命令路由处理
│   └── message-sender.ts # 消息发送到 Telegram
├── feishu/             # 飞书平台模块
│   ├── client.ts       # 飞书客户端和 WebSocket 事件处理
│   ├── event-handler.ts # 消息事件处理、权限控制
│   └── message-sender.ts # 消息发送（文本、图片、卡片等）
├── wework/             # 企业微信平台模块 (AI Bot WebSocket)
│   ├── client.ts       # WebSocket 连接、订阅认证、主动推送
│   ├── event-handler.ts # 消息事件处理
│   ├── message-sender.ts # 消息发送
│   └── types.ts        # 企业微信 API 类型
├── wechat/             # 微信平台模块 (AGP/Qclaw 协议，测试中)
│   ├── client.ts       # WebSocket 长连接管理
│   ├── event-handler.ts # AGP 消息事件处理
│   ├── message-sender.ts # AGP 消息发送
│   └── types.ts        # AGP 协议类型定义
├── adapters/           # AI 工具适配器层
│   ├── tool-adapter.interface.ts # 适配器接口定义
│   ├── claude-adapter.ts # Claude Code CLI 集成
│   └── registry.ts     # 适配器注册表
├── claude/             # Claude CLI 集成
│   ├── cli-runner.ts   # Claude 子进程管理
│   ├── process-pool.ts # 进程池管理
│   ├── stream-parser.ts # Claude 输出流解析
│   └── types.ts        # Claude 协议类型
├── commands/           # 命令处理
│   └── handler.ts      # /help, /mode, /new 等命令
├── config.ts           # 配置加载和验证
├── setup.ts            # 交互式配置向导
├── index.ts            # 主服务入口
├── cli.ts              # CLI 命令行入口
├── access/             # 访问控制
├── session/            # 会话管理
├── queue/              # 请求队列
├── shared/             # 共享工具
├── hook/               # 权限服务器
└── permission-mode/    # 权限模式管理
```

## 工作流

### 添加新平台

当添加新的 IM 平台支持时，需要同时修改以下文件：

1. **创建平台模块** `src/{platform}/`
   - `client.ts` - 客户端初始化和连接管理
   - `event-handler.ts` - 事件/消息路由处理
   - `message-sender.ts` - 消息发送到平台
   - `types.ts` - 类型定义（如需要）

2. **修改 `src/config.ts`**
   - 添加平台到 `Platform` 类型
   - 添加平台配置字段（token、secret、白名单等）
   - 添加环境变量支持
   - 更新 `needsSetup()` 和 `loadConfig()`

3. **修改 `src/setup.ts`**
   - 在平台选择中添加新平台选项
   - 添加配置收集逻辑

4. **修改 `src/index.ts`**
   - 导入平台模块
   - 在 `sendLifecycleNotification` 中添加平台支持
   - 在 `main()` 中初始化平台客户端
   - 添加关闭处理

5. **修改 `src/shared/active-chats.ts`**
   - 添加平台到 Data 接口
   - 更新 `getActiveChatId` 和 `setActiveChatId` 类型签名

6. **修改 `src/commands/handler.ts`**
   - 更新平台类型签名以包含新平台

7. **修改 `src/constants.ts`**
   - 添加平台的节流常量 `XXX_THROTTLE_MS`
   - 添加平台的消息长度限制 `MAX_XXX_MESSAGE_LENGTH`

### 平台模块标准接口

每个平台模块需要实现以下导出函数：

**client.ts:**
```typescript
export async function init{Platform}(config, eventHandler): Promise<void>
export function stop{Platform}(): void
```

**event-handler.ts:**
```typescript
export interface {Platform}EventHandlerHandle {
  stop: () => void;
  getRunningTaskCount: () => number;
  handleEvent?: (data: unknown) => Promise<void | Record<string, unknown>>;
}
export function setup{Platform}Handlers(config, sessionManager): Handle
```

**message-sender.ts:**
```typescript
export async function sendThinkingMessage(chatId, replyToMessageId, toolId): Promise<string>
export async function updateMessage(chatId, messageId, content, status, note, toolId): Promise<void>
export async function sendFinalMessages(chatId, messageId, fullContent, note, toolId): Promise<void>
export async function sendTextReply(chatId, text): Promise<void>
export async function sendImageReply(chatId, imagePath): Promise<void>
export function startTypingLoop(chatId): () => void
```

### 配置管理模式

1. **配置加载顺序**（环境变量优先级最高）：
   - 环境变量
   - config.json 中的 `platforms.{platform}` 字段
   - config.json 中的根级旧字段（向后兼容）

2. **分平台白名单**：
   - 优先使用 `{PLATFORM}_ALLOWED_USER_IDS` 环境变量
   - 其次使用 `platforms.{platform}.allowedUserIds`
   - 最后回退到全局 `allowedUserIds`

3. **启用平台检测**：
   - 检查凭证是否存在（token、appId+secret 等）
   - 检查 `platforms.{platform}.enabled` 不为 false

### 消息流式更新模式

所有平台实现相同的流式输出处理：

1. **发送思考中消息** → `sendThinkingMessage()`
2. **流式更新内容** → `updateMessage()` (带节流)
3. **发送最终结果** → `sendFinalMessages()` (处理长内容分片)

## 测试模式

- 本项目使用 **TDD（测试驱动开发）** 工作流
- 测试文件放置在对应模块目录下
- 目标覆盖率：80%+

## TypeScript 规范

- 目标：ES2022
- 模块：Node16
- 最小 Node 版本：20
- 使用 ES Module 导入/导出

## 依赖管理

- **使用 npm**（不是 pnpm）
- 包管理：`npm install`, `npm run build`, `npm start`

## 日志规范

使用 `createLogger('模块名')` 创建日志器：

```typescript
import { createLogger } from '../logger.js';
const log = createLogger('PlatformName');
log.info('信息');
log.debug('调试');
log.warn('警告');
log.error('错误');
```

## 命名约定

- **文件名**: kebab-case (如: `message-sender.ts`, `event-handler.ts`)
- **类名**: PascalCase
- **函数/变量**: camelCase
- **常量**: UPPER_SNAKE_CASE
- **类型/接口**: PascalCase

## 错误处理

1. **所有函数都显式处理错误**
2. **用户提供友好的错误消息**（UI 面向代码）
3. **记录详细的错误上下文**（服务端日志）
4. **不静默吞噬错误**

## 安全准则

- 不在源代码中硬编码 secrets
- 所有用户输入在系统边界进行验证
- 实现 SQL 注入、XSS、CSRF 防护
- 检查所有工具调用的权限

## 权限模式

项目支持四种权限模式：

- `ask` - 每次询问
- `accept-edits` - 自动批准编辑
- `plan` - 仅分析
- `yolo` - 跳过所有权限

通过 `/mode` 命令或交互式按钮切换。
