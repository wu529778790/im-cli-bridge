---
name: claude-image-support
overview: 为 open-im 增加稳定、官方支持的 Claude 图片理解能力，同时保持现有 CLI 流程可用。
todos:
  - id: config-backend-flag
    content: 在 config 模型和加载逻辑中增加 aiBackend / Agent SDK 配置项
    status: pending
  - id: adapter-registry-update
    content: 更新适配器注册表，根据配置返回 ClaudeAdapter 或 AgentSdkAdapter
    status: pending
  - id: implement-agent-sdk-adapter
    content: 实现 AgentSdkAdapter，使用官方 SDK/HTTP API 支持文本+图片多模态对话
    status: pending
  - id: wire-imagepaths-to-agent
    content: 确保飞书/Telegram 事件处理正确传入 imagePaths，并在 Agent 模式下真正使用
    status: pending
  - id: compat-cli-fallback
    content: 保留 CLI 模式并在存在图片时优雅退化为文本提示，不崩溃不卡死
    status: pending
  - id: testing-validation
    content: 为两种模式下的文字与图片场景编写和执行基本集成测试，验证行为稳定
    status: pending
isProject: false
---

### Claude 图片支持总体思路

- **保持现有 CLI 路径**：`ClaudeAdapter` + `claude -p` 原样保留，继续服务“只用 CLI、不开 API key”的用户。
- **新增 Agent SDK/HTTP 适配器**：实现 `AgentSdkAdapter`，通过官方 Agent SDK 或 HTTP API 调用 Claude 的多模态接口，真正支持截图。
- **按配置选择后端**：通过配置项切换使用 CLI 还是 Agent SDK，不改变 IM 侧（飞书/Telegram）代码的调用方式。

```mermaid
flowchart TB
  imMsg[imMessage] --> handler[platformHandler]
  handler --> aiTask[runAITask]
  aiTask --> adapter[ToolAdapter]
  adapter -->|CLI 模式| cli[ClaudeAdapter (CLI)]
  adapter -->|Agent 模式| agent[AgentSdkAdapter]
  cli --> claudeCli[claude -p]
  agent --> anthropicApi[Anthropic API]
```

---

### 步骤一：配置与类型扩展

- **更新配置模型**（`src/config.ts`）
  - 增加字段：`aiBackend: 'cli' | 'agent'`（或类似命名），默认 `cli`，保持向后兼容。
  - 增加 Agent SDK 所需配置：例如 `anthropicApiKey`、可选 `anthropicModel`（默认与 CLI 模型一致）。
- **文档更新**（`README.md`）
  - 新增一节说明两种模式的差异：
    - CLI 模式：无需 API key，不支持图片。
    - Agent 模式：需要 API key，支持截图和更灵活的控制。

---

### 步骤二：抽象适配层（复用现有接口）

- **复查 `ToolAdapter` 接口**（`src/adapters/tool-adapter.interface.ts`）
  - 确认已经支持：`run(prompt, sessionId, workDir, callbacks, options)` + `imagePaths?: string[]`。
  - 若有必要，补充：可选 `backend` / `metadata` 字段（仅在 Agent 模式下使用）。
- **更新适配器注册表**（`src/adapters/registry.ts`）
  - 根据 `config.aiBackend` / `config.aiCommand` 组合返回：
    - `ClaudeAdapter`（CLI）或
    - 新增的 `AgentSdkAdapter`。
  - 保证默认配置下行为与当前版本完全一致。

---

### 步骤三：实现 AgentSdkAdapter

- **新增文件**：`src/adapters/agent-sdk-adapter.ts`
  - 引入官方 SDK：`@anthropic-ai/claude-agent-sdk` 或 HTTP SDK；
  - 在适配器内部：
    - 将 `prompt` + `imagePaths` 组装成官方多模态 `messages` 结构：
      - 逐个读取 `imagePaths` 为二进制，转成 base64；
      - 构造 `[{ type: 'image', source: { type: 'base64', media_type, data } }, { type: 'text', text: prompt }]`；
    - 调用 SDK 的流式接口（Streaming Output）：
      - 对 text delta 调用 `callbacks.onText`；
      - 对 thinking / tool_use / result 映射到现有回调结构。
  - 支持会话：
    - 用 `sessionId` 作为 Agent 会话键；
    - 在适配器内部维护一个 `Map<sessionId, agentInstance>`，以复用上下文。
  - 实现 `RunHandle.abort()`：
    - 取消 SDK 的流式请求，释放会话资源。

---

### 步骤四：与现有任务与 IM 层对接

- **复用 `runAITask` 逻辑**（`src/shared/ai-task.ts`）
  - 不改任务调度和节流，只要保证：
    - CLI 模式下行为不变；
    - Agent 模式下 `RunCallbacks` 被正常触发（流式 + 完成 + 错误）。
- **飞书图片处理保持简单**（`src/feishu/event-handler.ts`）
  - 继续：
    - 从消息中解析图片 key；
    - 下载到临时目录（`IMAGE_DIR`）；
    - 构造 prompt（文字 + “【图片】请分析。”）；
    - 在调用 `handleAIRequest` 时传入 `imagePaths`。
  - 不再关心后端是 CLI 还是 Agent —— 由适配器决定是否真正利用 `imagePaths`。
- **Telegram 图片处理一致化**（`src/telegram/event-handler.ts`）
  - 参照飞书路径：统一将图片下载 → 封装 `imagePaths` → 交给 `runAITask`。

---

### 步骤五：回退/兼容策略

- **CLI 模式**：
  - `ClaudeAdapter` 忽略 `imagePaths`（只用文本 prompt），但可以在 prompt 里拼上「用户发送了图片」的文本提示，避免彻底丢失语义。
- **Agent 模式开启条件**：
  - 检查：
    - `config.aiBackend === 'agent'`；
    - 存在 `anthropicApiKey`；
  - 配置不完整时：
    - 回退到 CLI 模式，并在日志中告警（INFO 级别 + 明确文案）。

---

### 步骤六：测试与验证

- **单元/集成测试点**（可逐步补充）：
  - 无图片 + CLI 模式：行为必须与现在一致（包含会话复用与权限流程）。
  - 无图片 + Agent 模式：普通文本问答正常、流式不丢字符。
  - 单张图片 + 文本（飞书/Telegram 各一）：
    - Agent 模式下，Claude 能根据截图内容给出正确回答；
    - CLI 模式下，至少不报错，并提示“当前模式无法直接查看图片”。
  - 多张图片：Agent 模式能正常处理；CLI 模式仍然稳定退化为文字路径。
- **日志与诊断**：
  - 在适配器初始化和每次请求时记录后端类型（CLI/Agent）；
  - 发生图片相关错误时（文件读取/SDK 调用）提供明确信息，方便你后续排查。
