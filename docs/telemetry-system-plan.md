# 气质系统 — 集中式遥测与分析平台

## Context

当前 open-im 只能开发者自己测试，日志散落在各用户本地 `~/.open-im/logs/`，无法看到真实用户的使用情况。需要一套遥测系统，让多个 open-im 实例上报结构化事件（不含用户消息内容），集中分析后驱动迭代。

## 架构概览

```
open-im 实例 (用户A)  ──┐
open-im 实例 (用户B)  ──┤  HTTPS POST (批量)  ──>  遥测服务器 (SQLite)  ──> Web Dashboard
open-im 实例 (用户C)  ──┘
```

- **客户端**: 内嵌在 open-im 中，捕获结构化事件，批量上报
- **服务端**: 独立轻量 Node.js + SQLite 服务，接收+存储+查询
- **面板**: 服务端提供的静态 HTML 页，展示分析结果

## 分 5 个阶段实施

---

### Phase 1: 客户端核心 + AI 任务事件（最高优先级）

**目标**: 让每次 AI 任务执行产生遥测事件并上报

#### 1.1 新建 `src/telemetry/types.ts` — 事件类型定义

核心事件类型:

| 事件名 | 触发点 | 关键字段 |
|--------|--------|----------|
| `instance.start` | 进程启动 | version, nodeVersion, platform, enabledPlatforms |
| `instance.shutdown` | 优雅关闭 | uptimeMs |
| `ai_task.start` | `runAITask()` 开始 | platform, aiCommand, hasSession, promptLength |
| `ai_task.complete` | `onComplete` 回调 | durationMs, numTurns, toolStats, cost, model |
| `ai_task.error` | `onError` 回调 | durationMs, errorType, errorSnippet(200字) |
| `instance.heartbeat` | 每6小时 | uptimeMs, activeUsers |

**隐私原则**: 不收集用户消息内容，只收集元数据/指标。所有字符串字段经 `sanitize()` 脱敏。

#### 1.2 新建 `src/telemetry/telemetry.ts` — 核心模块

```typescript
class TelemetryClient {
  // 批量发送: 每60秒或累积50条事件时 POST 到服务端
  // 离线容错: 队列最大500条，超出丢弃最旧的
  // 网络失败: 最多重试3次，指数退避
  // 超时: 每次 POST 5秒
  capture(event: TelemetryEvent): void;  // 非阻塞，仅推入内存队列
  flush(): Promise<void>;                // POST 到服务端
  shutdown(): Promise<void>;             // 关闭前最终 flush
}
```

实例 ID: 首次启动生成 UUID，存入 `~/.open-im/data/instance-id`。

#### 1.3 新建 `src/telemetry/index.ts` — 单例导出

```typescript
initTelemetry(config): void;       // 对应 initLogger
captureEvent(event): void;         // 对应 createLogger
shutdownTelemetry(): Promise<void>; // 对应 closeLogger
```

#### 1.4 修改 `src/config.ts` — 添加遥测配置

```typescript
// FileConfig 新增:
telemetry?: {
  enabled?: boolean;      // 默认 false，需用户显式开启
  serverUrl?: string;     // 遥测服务器地址
};

// 环境变量覆盖:
// OPEN_IM_TELEMETRY_ENABLED=true|false
// OPEN_IM_TELEMETRY_URL=https://...
```

#### 1.5 修改集成点

| 文件 | 修改内容 |
|------|---------|
| `src/index.ts` | 启动时 `initTelemetry(config)` + 发 `instance.start`；关闭时发 `instance.shutdown` + `shutdownTelemetry()` |
| `src/shared/ai-task.ts` | `startRun()` 发 `ai_task.start`；`onComplete` 发 `ai_task.complete`；`onError` 发 `ai_task.error` |
| `src/constants.ts` | 添加 `TELEMETRY_FLUSH_INTERVAL_MS = 60_000` |

**涉及的关键文件**:
- `src/telemetry/types.ts` (新建)
- `src/telemetry/telemetry.ts` (新建)
- `src/telemetry/index.ts` (新建)
- `src/config.ts` (~930行, 添加 telemetry 字段)
- `src/index.ts` (添加初始化和事件发送)
- `src/shared/ai-task.ts` (~329行, 添加3处事件捕获)
- `src/constants.ts` (添加常量)
- `src/sanitize.ts` (复用现有脱敏逻辑)

---

### Phase 2: 平台健康事件（中优先级）

**目标**: 跟踪各 IM 平台的连接稳定性

在6个平台客户端的连接状态变更处添加事件:

| 文件 | 事件 |
|------|------|
| `src/telegram/client.ts` | `platform.connected` |
| `src/feishu/client.ts` | `platform.connected` / `disconnected` |
| `src/wework/client.ts` | `connected` / `disconnected` / `reconnected` |
| `src/dingtalk/client.ts` | `connected` / `disconnected` |
| `src/workbuddy/client.ts` | `connected` / `disconnected` |
| `src/qq/client.ts` | `connected` / `disconnected` |
| `src/index.ts` | 平台初始化失败时发 `platform.init_failed` |
| `src/index.ts` | 全局错误处理器发 `error.unhandled` |

所有事件都在现有 `log.info/error` 调用的同位置添加，不改变控制流。

---

### Phase 3: 遥测服务器（高优先级，可与 Phase 1 并行）

**目标**: 搭建独立接收服务

#### 技术选型
- Node.js `http.createServer`（与 open-im 风格一致）
- SQLite (`better-sqlite3`，零运维，单文件数据库)
- 可部署到任意 VPS 或云函数

#### API 设计

```
POST /api/v1/events     — 接收批量事件
POST /api/v1/instances  — 实例注册/更新
GET  /api/v1/stats/*    — 查询接口(bearer token 鉴权)
```

#### 数据库 Schema

```sql
instances (id PK, first_seen_at, last_seen_at, version, node_version, os_platform, enabled_platforms, ai_commands)
events (id PK AUTO, instance_id, event_type, payload JSON, received_at, version)
```

索引: `event_type`, `received_at`, `instance_id`, `instances.last_seen_at`

数据保留: 原始事件90天，之后聚合为日汇总后删除。实例记录保留1年。

**存放位置**: `packages/telemetry-server/` 或独立仓库

---

### Phase 4: 分析 Dashboard（中优先级）

**目标**: 可视化分析收集的数据

服务端提供的静态 HTML 页面（与 open-im 的 `config-web-page.ts` 模式一致），包含:

| 面板 | 内容 |
|------|------|
| 概览 | 实例总数、活跃实例、版本分布 |
| AI 任务 | 耗时分布(p50/p95)、成功率、工具使用频率、模型分布、费用 |
| 平台 | 各平台使用量、连接稳定性、初始化失败率 |
| 错误 | 错误类型分布、频率趋势 |

查询 API:
```
GET /api/v1/stats/overview?range=30d
GET /api/v1/stats/ai-tasks?range=30d
GET /api/v1/stats/platforms?range=30d
GET /api/v1/stats/errors?range=7d
```

---

### Phase 5: 配置 UI 集成（低优先级）

**目标**: 让用户在 Web 配置页面一键开启遥测

- `src/config-web-page-template.ts`: 添加遥测开关 + 数据说明
- `src/config-web.ts`: 添加保存遥测配置的 API
- `src/setup.ts`: 交互式设置向导中添加遥测选项

---

## 设计决策

| 决策 | 原因 |
|------|------|
| 默认关闭 | 隐私优先，用户需明确同意 |
| 批量 POST | 减少网络开销，离线容错简单 |
| SQLite 而非 PostgreSQL | 低流量(百~千实例)无需运维，迁移容易 |
| 自建而非 Sentry/PostHog | 保持轻量，完全掌控数据 |
| 不收集消息内容 | 只收集元数据(耗时/工具名/错误类型) |

## 验证方式

1. **Phase 1 验证**: 启用遥测后，执行一次 AI 任务，检查 `~/.open-im/logs/` 日志中是否有 telemetry flush 记录；用 `nc -l` 或简单 HTTP 服务模拟接收端确认请求格式
2. **Phase 3 验证**: 部署服务器后，用 curl 发送测试事件，确认 SQLite 写入正确
3. **端到端**: 开启遥测 → 执行 AI 任务 → 服务器收到事件 → Dashboard 展示数据
4. **单元测试**: `src/telemetry/telemetry.test.ts` — 测试批量逻辑、脱敏、离线队列
