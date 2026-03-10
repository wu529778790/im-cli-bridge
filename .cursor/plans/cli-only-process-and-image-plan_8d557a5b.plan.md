---
name: cli-only-process-and-image-plan
overview: 在仅依赖 Claude CLI 的前提下，优化 open-im 的进程模型，并在可行范围内改进截图支持和体验。
todos:
  - id: cli-image-boundary
    content: 梳理并实现纯 CLI 模式下的图片策略（图片落盘 + 文字说明，不再尝试 stream-json base64）
    status: pending
  - id: process-short-term-opt
    content: 在现有一请求一进程模型下进行参数与 I/O 优化，确保超时与退出路径可靠
    status: pending
  - id: stdin-multi-turn-experiment
    content: 编写独立脚本验证 claude -p --input-format stream-json 是否实际支持多轮 stdin 输入
    status: pending
  - id: im-error-unification
    content: 统一飞书和 Telegram 上图片相关提示与错误文案，避免卡死和空输出
    status: pending
  - id: regression-tests-cli-only
    content: 对文字和图片场景做一次 CLI-only 回归测试，记录现状与瓶颈
    status: pending
isProject: false
---

### 目标

- **不引入 Agent SDK / HTTP API**，只使用本机已安装的 `claude` CLI。
- **优化进程模型**：尽量减少每条消息的冷启动开销、避免卡死，提升首帧速度和整体流畅度。
- **改进图片体验**：在 CLI 能力范围内，对截图消息提供更合理、稳定、可预期的行为，而不是卡住或空结果。

---

### 步骤一：进程与 CLI 调用现状梳理

- **阅读与确认现状代码**：
  - `src/claude/cli-runner.ts`：`runClaude` 的参数、`--output-format stream-json` 的使用方式；
  - `src/claude/process-pool.ts`：`ClaudeProcessPool.execute/runProcess`、会话缓存 TTL、`--resume` 使用场景；
  - `src/shared/ai-task.ts`：如何为每条 IM 消息创建任务、如何调用 Adapter。
- **在 README / docs 中记录现状**（可选）：将「每条消息 spawn 一次 CLI」与目前的瓶颈写入 `docs/process-model-optimization.md`，方便后续回顾。

---

### 步骤二：纯 CLI 模式下的图片支持策略

> 前提：不使用 Agent SDK / API，只走 `claude -p`。

- **明确设计边界**：
  - 承认当前 CLI 文档未说明「如何在 `-p`/stdin 中传入图片」，且实测 `stream-json + image block` 不返回事件；
  - 因此，本方案在 CLI 模式下不追求“真正像 UI 一样看图”，而是：
    - **保证请求不卡死、不空输出**；
    - 为用户与 Claude 提供尽量多的上下文（例如图片保存路径、用户描述）。
- **图片落盘策略**：
  - 继续使用 `IMAGE_DIR`（系统临时目录），避免污染工作目录：
    - `src/constants.ts` 中的 `IMAGE_DIR`；
    - `src/feishu/event-handler.ts` / `src/telegram/event-handler.ts` 的 `download*Image` 函数统一改用 `IMAGE_DIR`。
- **CLI 模式的图片 prompt 规范**：
  - 对于「文字 + 截图」消息：
    - 抽取文字部分 `text`；
    - 下载所有图片，记录其本地路径（统一转成 POSIX 风格路径方便阅读）；
    - 构造统一格式的 prompt，例如：
      - 有文字：`text + '\n\n[系统说明] 用户在本地发送了 N 张截图（路径：...），你无法直接看到图片，请根据文字内容和用户后续描述回答。'`
      - 纯图片：`[系统说明] 用户发送了 N 张截图（路径：...），你无法直接看到图片，请让用户用文字描述问题。`
  - 将上述 prompt 作为 **纯文本** 传给 `ClaudeAdapter`，不再在 CLI 层强行塞入 base64 图片。
- **用户体验提示**：
  - 在 README 和错误提示中明确：
    - CLI 模式目前无法像桌面 UI 那样“真看图”；
    - 推荐用户在发送截图时尽量配合文字描述；
    - 若未来 CLI 官方增加文档化的图片 stdin 协议，可在此处替换实现。

---

### 步骤三：进程模型短期优化（仍为「一请求一进程」）

- **精简 CLI 参数与 I/O**：
  - 在 `cli-runner.ts` 与 `process-pool.ts` 中：
    - 确认 `--verbose` 是否是 `stream-json` 模式的硬性要求；在不影响事件输出的前提下，尝试移除或降低日志量；
    - 确保 stderr 截断逻辑生效（首 4KB + 尾 6KB），避免日志过大影响性能。
- **统一与收敛超时逻辑**：
  - 巩固 `claudeTimeoutMs` 的行为：
    - 在 CLI 模式下所有路径（含 `process-pool` 和 `cli-runner` fallback）都遵守该超时；
    - 超时后：终止子进程、在 IM 中返回明确的“执行超时”提示，而不是一直“思考中”。
- **改进结果与退出路径处理**：
  - 在 `process-pool.ts` 中保留并强化：
    - 正常收到 `result` 事件时，立即 resolve 并清理资源；
    - 若进程以 `code=0` 退出但没有 `result` 事件：
      - 使用已累积的文本或一个清晰的错误提示作为 fallback；
      - 避免无输出或前端一直 loading。

---

### 步骤四：验证 CLI stdin 多轮能力（实验性，不影响主线）

> 这一部分是 **验证性工作**，即便失败也不会影响主路径。

- **设计验证脚本**（独立于 open-im）：
  - 编写一个 Node/TS 或 Bash 脚本，直接调用：
    - `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`；
  - 通过 stdin 连续写入多行 NDJSON 消息，形式为：
    - 第一行：一个简单 `{"type":"message","role":"user","content":[{"type":"text","text":"hi"}]}`；
    - 第二行：几秒后再写入另一个独立消息；
  - 观察：
    - CLI 是否会为第二条输入继续产生 `stream-json` 事件；
    - 还是只处理第一条后就退出 / 忽略后续输入。
- **根据实验结果决策**：
  - 若 **不支持多轮 stdin**：
    - 记录结论到 `docs/process-model-optimization.md`，说明 CLI 限制；
    - 明确放弃「单进程多轮 stdin」方案，转而将长期目标留给 Agent SDK（当前不实施，只做文档标注）。
  - 若 **确认支持多轮 stdin**（极不确定）：
    - 再另起一个更大范围的重构计划：
      - 为每个会话维护一个长期运行的 CLI 进程；
      - 通过队列向该进程写入多条消息；
      - 管理进程崩溃、`/new` reset 与 TTL 等问题。

（本次 plan 只要求完成「实验与结论」，不强制实施这一大改动。）

---

### 步骤五：IM 交互体验与错误提示统一

- **统一带图片消息的提示文案**：
  - 飞书与 Telegram 上，带图片的请求都遵循同一种策略：
    - 首条“thinking”消息正常显示；
    - 最终消息中：
      - 若 CLI 能给出合理文本回答，直接展示；
      - 若因为无图片能力导致回答质量有限，附上一小段说明：「当前运行模式下看不到图片，只能根据你的文字来判断」。
- **统一错误处理**：
  - 图片下载失败（网络问题、鉴权失败等）：
    - 在 IM 内返回明确错误：「图片下载失败，请稍后重试或改用文字描述」；
    - 日志中记录详细的 HTTP 状态码与响应片段，便于调试。
  - CLI 异常退出（非 0 exit code）：
    - 将 stderr 截断后的内容贴到日志；
    - IM 侧只展示一条精简且对用户友好的错误文案。

---

### 步骤六：回归与性能测试

- **文字-only 基线回归**：
  - 确认在无图片、常规开发对话场景中：
    - 首次响应时间没有明显回退；
    - 流式输出节流（飞书 200ms / Telegram 200ms）表现正常。
- **图片场景回归**：
  - 飞书：
    - 发送「纯文字 + 截图」/「纯截图」/「多图」三种组合；
    - 观察是否：
      - 永不再出现“思考中卡死”；
      - 最终都有明确文本结果（正常回答或合理错误提示）。
  - Telegram：
    - 同样三种组合，确认行为对齐。
- **记录瓶颈与后续方向**：
  - 在 `docs/process-model-optimization.md` 中补充：
    - 纯 CLI 模式下的极限与当前性能表现；
    - 若未来要实现“真 · 看图”，需要切换到 Agent SDK / API 的原因与大致方案链接（指向你现在的另一份 plan）。
