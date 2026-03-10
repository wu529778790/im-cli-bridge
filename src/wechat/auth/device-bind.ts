/**
 * 设备绑定：生成企微客服链接，用户在微信中打开后才有对话入口
 */

import type { QClawAPI } from './qclaw-api.js';

function nested(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const DEFAULT_OPEN_KFID = 'wkzLlJLAAAfbxEV3ZcS-lHZxkaKmpejQ';
const POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 180_000; // 3 分钟

export interface DeviceBindResult {
  success: boolean;
  contactUrl?: string;
  message: string;
}

export async function performDeviceBinding(
  api: QClawAPI,
  options?: { timeoutMs?: number; showQr?: (url: string) => void | Promise<void> }
): Promise<DeviceBindResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const showQr = options?.showQr;

  console.log('[微信登录] 正在调用 4018 接口生成绑定链接...');
  let linkResult;
  try {
    linkResult = await Promise.race([
      api.generateContactLink(DEFAULT_OPEN_KFID),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('4018 接口超时（15秒）')), 15_000)
      ),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `生成绑定链接失败: ${msg}` };
  }
  if (!linkResult.success) {
    return { success: false, message: `生成绑定链接失败: ${linkResult.message}` };
  }

  const linkData = linkResult.data as Record<string, unknown>;
  const bindUrl =
    (nested(linkData, 'url') as string) ||
    (nested(linkData, 'data', 'url') as string) ||
    (nested(linkData, 'resp', 'url') as string) ||
    (nested(linkData, 'resp', 'data', 'url') as string) ||
    '';
  if (!bindUrl) {
    console.warn('[微信登录] 4018 响应结构:', JSON.stringify(linkData, null, 2).slice(0, 500));
    return { success: false, message: '生成绑定链接失败，未返回 URL。服务端响应结构可能已变更' };
  }

  if (showQr) {
    await showQr(bindUrl);
  } else {
    console.log('\n' + '='.repeat(64));
    console.log('【设备绑定】请复制下方链接，在企微/微信中打开：');
    console.log('  → 打开后会进入客服会话，后续发消息必须在此会话中进行');
    console.log('='.repeat(64));
    console.log(bindUrl);
    console.log('='.repeat(64) + '\n');
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const queryResult = await api.queryDeviceByGuid();
    if (!queryResult.success) continue;

    const data = queryResult.data as Record<string, unknown>;
    const inner = nested(data, 'data') as Record<string, unknown> | undefined;
    const isBind = nested(data, 'is_bind') ?? inner?.is_bind;
    const nickname = (nested(data, 'nickname') ?? inner?.nickname) as string | undefined;
    const externalUserId = (nested(data, 'external_user_id') ?? inner?.external_user_id) as string | undefined;
    // 与 wechat-access 一致：nickname 或 external_user_id 表示已绑定
    if (isBind === true || isBind === 1 || !!nickname || !!externalUserId) {
      return { success: true, contactUrl: bindUrl, message: '设备绑定成功' };
    }
  }

  return {
    success: false,
    contactUrl: bindUrl,
    message: '绑定超时，请稍后重新登录并完成绑定',
  };
}
