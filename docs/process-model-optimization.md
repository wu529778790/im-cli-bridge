# 进程模型优化方案

## 现状

当前每次用户发消息都会 **spawn 新的 Claude CLI 进程**（`claude -p "prompt"`），进程执行完即退出。冷启动包括：

- 启动 Node 子进程
- Claude CLI 初始化（加载配置、插件、MCP 等）
- 建立 API 连接
- 加载 `--resume` 的会话历史

导致首轮响应明显变慢。

## 可选方案

### 方案 A：Agent SDK 持久会话（推荐）

使用 `@anthropic-ai/claude-agent-sdk` 的 **Streaming Input Mode**，在进程内维持长连接 Agent，通过 AsyncGenerator 持续喂入消息。

**优点：**

- 无冷启动，多轮对话复用同一 Agent
- 支持中断、权限回调、hooks
- 官方 SDK，行为与 Claude Code 一致

**缺点：**

- 需引入新依赖并重构 adapter 层
- 需处理 permission server 与 SDK 的集成（`permission-prompt-tool` 等）

**实现要点：**

```typescript
// 伪代码：每用户/会话维护一个 Agent 实例
const agentSessions = new Map<string, { agent, messageQueue }>();

async function* messageGenerator(userId: string, sessionId: string) {
  while (true) {
    const prompt = await getNextPrompt(userId, sessionId); // 从队列取
    if (!prompt) break;
    yield { type: "user", message: { role: "user", content: prompt } };
  }
}

// 启动长连接
for await (const msg of query({
  prompt: messageGenerator(userId, sessionId),
  options: { maxTurns: 50, ... }
})) {
  // 流式回调到 IM
}
```

### 方案 B：CLI stdin stream-json（实验性）

CLI 支持 `--input-format stream-json`，可从 stdin 读 NDJSON。理论上可保持一个进程，持续往 stdin 写新消息。

**问题：**

- 文档主要描述的是管道链式调用，单进程多轮输入协议未明确
- 需验证 `claude -p --input-format stream-json` 是否支持在 stdin 上持续接收多条消息

**验证命令：**

```bash
# 测试：能否通过 stdin 发送多条消息
(echo '{"type":"message","role":"user","content":[{"type":"text","text":"hi"}]}'
 sleep 2
 echo '{"type":"message","role":"user","content":[{"type":"text","text":"again"}]}') | \
  claude -p --input-format stream-json --output-format stream-json
```

### cc-im 流式输出对比（节流差异）

cc-im 与 open-im 的 **JSON 解析方式完全一致**（readline + parseStreamLine），差异主要在 **节流间隔**：

| 平台   | open-im | cc-im | 说明                          |
|--------|---------|-------|-------------------------------|
| 飞书   | 200ms   | 80ms  | CardKit 支持更高频率          |
| Telegram | 600ms | 200ms | editMessage 限频，cc-im 更激进 |

cc-im 的飞书更新频率约为 open-im 的 2.5 倍，Telegram 约 3 倍，因此流式输出会显得更“快”。可将 open-im 的节流常量与 cc-im 对齐以提升观感。

### 方案 C：预热 + 会话复用（当前可做）

在现有 CLI spawn 模型下做轻量优化：

1. **会话复用**：已用 `--resume sessionId`，历史加载比全新会话快
2. **预热**：用户首次发消息时，可先 spawn 一个空 prompt（如 `"ping"`）做预加载，再处理真实请求（实现复杂，收益有限）
3. **进程池 TTL 调大**：当前 process-pool 只缓存 session 元数据，不保活进程；可考虑在用户活跃时提前 spawn 下一个进程（实现复杂）

### 方案 D：减少冷启动耗时

不改架构，只优化单次启动：

1. **精简 CLI 参数**：`--verbose` 在使用 `-p` + `stream-json` 时被 CLI 强制要求，无法去掉
2. **减少插件/MCP**：通过 `--setting-sources` 或环境变量限制加载范围
3. **使用更快的 spawn**：在 Windows 上优先用 `spawn` 而非 `shell: true`（若环境允许）

## 建议路线

1. **短期**：方案 D，先做参数和 spawn 优化，改动小
2. **中期**：验证方案 B，若 CLI 支持 stdin 多轮，可做「单进程 + stdin 队列」
3. **长期**：方案 A，迁移到 Agent SDK 持久会话，体验最佳

## 相关资源

- [Agent SDK Streaming Input](https://docs.claude.com/en/docs/claude-code/sdk/streaming-vs-single-mode)
- [Claude Code Headless](https://code.claude.com/docs/en/headless)
- [CLI --input-format](https://code.claude.com/docs/en/cli-reference)
