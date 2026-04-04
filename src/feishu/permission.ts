/**
 * 飞书权限检测与友好提示
 *
 * 统一管理权限错误码、提示消息构建、控制台输出。
 * 所有飞书发送函数遇到错误时应通过此模块检测权限问题。
 */

import { createLogger } from '../logger.js';

const log = createLogger('FeishuPerm');

// ── 权限错误码 ──

const PERMISSION_ERROR_CODES = [
  99991400,  // 权限不足
  99991401,  // 没有API权限
  99991663,  // 应用未获取 scope
  99991672,  // 应用未开通相关能力
  99991670,  // 应用未上架/未授权
  99991668,  // 应用可见性限制
];

// ── 权限 scope 定义 ──

interface ScopeDef {
  scope: string;
  label: string;
}

const REQUIRED_SCOPES: ScopeDef[] = [
  { scope: 'im:message', label: '获取与发送单聊、群组消息' },
  { scope: 'im:message:send_as_bot', label: '以应用身份发消息' },
  { scope: 'im:resource', label: '获取与上传图片或文件资源' },
  { scope: 'im:chat', label: '获取群组信息' },
];

const OPTIONAL_SCOPES: ScopeDef[] = [
  { scope: 'cardkit:card', label: 'CardKit 卡片管理（打字机效果）' },
];

// ── 错误码提取与判断 ──

interface FeishuApiError {
  code?: number;
  msg?: string;
  message?: string;
  response?: { data?: { code?: number; msg?: string } };
}

/**
 * 从异常中提取飞书 API 错误码
 */
function extractFeishuErrorCode(err: unknown): number | undefined {
  const e = err as FeishuApiError;
  if (e?.response?.data?.code) return e.response.data.code;
  if (e?.code) return e.code;
  return undefined;
}

/**
 * 根据错误码判断是否为权限不足
 */
export function isPermissionError(err: unknown): boolean {
  const code = extractFeishuErrorCode(err);
  if (!code) {
    const msg = (err as Error)?.message ?? String(err);
    return /permission|权限|scope|not authorized|no access|forbidden/i.test(msg);
  }
  return PERMISSION_ERROR_CODES.includes(code);
}

// ── 权限直达链接 ──

/**
 * 构建飞书应用权限设置页直达链接
 */
export function buildPermissionUrl(appId: string): string {
  return `https://open.feishu.cn/app/${appId}/permission`;
}

/**
 * 构建飞书开放平台应用列表页链接
 */
function buildAppListUrl(): string {
  return 'https://open.feishu.cn/app';
}

// ── 消息构建 ──

/**
 * 构建飞书卡片用的权限指引消息（lark_md 格式）
 */
function buildPermissionGuideMessage(err: unknown, appId?: string): string {
  const code = extractFeishuErrorCode(err);
  const codeHint = code ? ` (错误码: ${code})` : '';

  const lines = [
    '⚠️ **飞书应用权限不足，无法发送消息**' + codeHint,
    '',
    '请按以下步骤开通所需权限：',
    '',
    '**1. 进入飞书开放平台**',
    '👉 https://open.feishu.cn/app',
  ];

  if (appId) {
    lines.push('', `**2. 进入你的应用权限管理页面**`, `👉 [点击直接打开](${buildPermissionUrl(appId)})`);
    lines.push('', '**3. 搜索并添加以下权限：**');
  } else {
    lines.push('', '**2. 找到你的应用，进入「权限管理」**');
    lines.push('', '**3. 开通以下权限（搜索权限名称添加）：**');
  }

  for (const s of REQUIRED_SCOPES) {
    lines.push(`• \`${s.scope}\` — ${s.label}`);
  }

  lines.push('', '**4. 如需使用卡片打字机效果，还需开通：**');
  for (const s of OPTIONAL_SCOPES) {
    lines.push(`• \`${s.scope}\` — ${s.label}`);
  }

  lines.push(
    '',
    '**5. 发布版本**',
    '权限修改后需点击「创建版本」→「发布」，管理员审批后生效。',
  );

  return lines.join('\n');
}

// ── 控制台输出 ──

/**
 * 启动时输出权限要求提示（仅输出一次）
 */
export function logPermissionGuide(appId: string): void {
  const permUrl = buildPermissionUrl(appId);

  log.info('─── 飞书权限配置 ───');
  log.info(`权限设置页: ${permUrl}`);
  log.info('必需权限:');
  for (const s of REQUIRED_SCOPES) {
    log.info(`  · ${s.scope} — ${s.label}`);
  }
  log.info('可选权限:');
  for (const s of OPTIONAL_SCOPES) {
    log.info(`  · ${s.scope} — ${s.label}`);
  }
  log.info('权限修改后需发布版本，管理员审批后生效。');
  log.info('───────────────────');
}

// ── 统一错误处理 ──

let lastPermissionLogTime = 0;
const PERMISSION_LOG_COOLDOWN_MS = 60_000; // 60 秒内不重复输出

/**
 * 统一权限错误处理入口。
 * 始终输出到控制台（保证可见），尽力尝试通过飞书 API 发送提示。
 */
export function handlePermissionError(err: unknown, chatId?: string): void {
  const now = Date.now();
  const silenced = now - lastPermissionLogTime < PERMISSION_LOG_COOLDOWN_MS;

  if (!silenced) {
    lastPermissionLogTime = now;

    const code = extractFeishuErrorCode(err);
    const codeHint = code ? ` (错误码: ${code})` : '';
    log.error(`飞书权限不足${codeHint}，无法发送消息。`);

    // 动态 import 避免循环依赖
    import('./client.js').then(({ getAppId }) => {
      const appId = getAppId();
      log.error(`请前往开通权限: ${buildPermissionUrl(appId)}`);
    }).catch(() => {
      log.error(`请前往开通权限: ${buildAppListUrl()}`);
    });
  }

  // Best-effort: 尝试通过飞书 API 发送权限指引
  if (chatId) {
    sendPermissionFallback(chatId, err).catch(() => {
      // 预期会失败（权限不足本身就是根因），log 已经输出过了
    });
  }
}

/**
 * 尝试通过飞书 API 发送权限指引消息（降级链：卡片 → 纯文本）
 */
async function sendPermissionFallback(chatId: string, err: unknown): Promise<void> {
  // 动态 import 避免循环依赖
  const { sendTextReply } = await import('./message-sender.js');
  const { getAppId } = await import('./client.js');

  const guide = buildPermissionGuideMessage(err, getAppId());

  // 1. 尝试卡片消息
  try {
    await sendTextReply(chatId, guide);
    return;
  } catch {
    // 降级
  }

  // 2. 尝试纯文本消息
  try {
    const { getClient } = await import('./client.js');
    const client = getClient();
    const plainGuide = guide.replace(/\*\*/g, '').replace(/`/g, '');
    await client.im.message.create({
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: plainGuide }),
      },
      params: { receive_id_type: 'chat_id' },
    });
    return;
  } catch {
    // 全部失败，控制台已输出
  }
}
