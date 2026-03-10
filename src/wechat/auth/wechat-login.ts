/**
 * 微信扫码登录流程
 * 1. 获取 state → 2. 显示二维码 → 3. 等待 code → 4. 换 token → 5. 设备绑定
 */

import { createInterface } from 'node:readline';
import type { QClawEnvironment, LoginCredentials } from './types.js';
import { QClawAPI } from './qclaw-api.js';
import { getDeviceGuid } from './device-guid.js';
import { getEnvironment } from './environments.js';
import { performDeviceBinding } from './device-bind.js';

function nested(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function buildAuthUrl(state: string, env: QClawEnvironment): string {
  const params = new URLSearchParams({
    appid: env.wxAppId,
    redirect_uri: env.wxLoginRedirectUri,
    response_type: 'code',
    scope: 'snsapi_login',
    state,
  });
  return `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}#wechat_redirect`;
}

async function displayQrCode(url: string): Promise<void> {
  console.log('\n' + '='.repeat(64));
  console.log('请用微信扫描下方二维码登录');
  console.log('='.repeat(64));

  try {
    const { generate } = await import('qrcode-terminal');
    if (generate) generate(url, { small: true }, (qrcode: string) => console.log(qrcode));
  } catch {
    console.log('\n(未安装 qrcode-terminal，无法在终端显示二维码)');
    console.log('可运行: npm install qrcode-terminal');
  }

  console.log('\n或在浏览器中打开以下链接：');
  console.log(url);
  console.log('='.repeat(64) + '\n');
}

function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function waitForAuthCode(): Promise<string> {
  console.log('微信扫码授权后，浏览器会跳转到新页面，地址栏 URL 形如：');
  console.log('https://security.guanjia.qq.com/login?code=0a1B2c...&state=xxx');
  console.log('\n请复制 code= 后面的值（到 & 之前），或直接粘贴完整 URL。\n');

  const raw = await readLine('请粘贴 code 值或完整 URL: ');
  if (!raw) return '';

  const cleaned = raw.replace(/\\([?=&#])/g, '$1');

  if (cleaned.includes('code=')) {
    try {
      const url = new URL(cleaned);
      const code = url.searchParams.get('code');
      if (code) return code;
      if (url.hash) {
        const fragmentParams = new URLSearchParams(url.hash.replace(/^#/, ''));
        const fCode = fragmentParams.get('code');
        if (fCode) return fCode;
      }
    } catch {
      /* ignore */
    }
    const match = cleaned.match(/[?&#]code=([^&#]+)/);
    if (match?.[1]) return match[1];
  }

  return cleaned;
}

export interface PerformWeChatLoginOptions {
  envName?: string;
  appId?: string;
  bypassInvite?: boolean;
}

/**
 * 执行微信扫码登录，返回 token、guid、userId
 */
export async function performWeChatLogin(
  options: PerformWeChatLoginOptions = {}
): Promise<LoginCredentials> {
  const envName = options.envName ?? 'production';
  const appId = options.appId;
  if (!appId) {
    throw new Error('appId is required. 请在配置中提供 wechatAppId 或通过环境变量 WECHAT_APP_ID 设置');
  }
  const env = getEnvironment(envName, appId);
  const guid = getDeviceGuid();
  const api = new QClawAPI(env, guid);

  // 1. 获取 state
  console.log('[微信登录] 步骤 1/5: 获取登录 state...');
  let state = String(Math.floor(Math.random() * 10000));
  const stateResult = await api.getWxLoginState();
  if (stateResult.success) {
    const s = nested(stateResult.data, 'state') as string | undefined;
    if (s) state = s;
  }

  // 2. 显示二维码
  console.log('[微信登录] 步骤 2/5: 生成微信登录二维码...');
  const authUrl = buildAuthUrl(state, env);
  await displayQrCode(authUrl);

  // 3. 等待 code
  console.log('[微信登录] 步骤 3/5: 等待微信扫码授权...');
  const code = await waitForAuthCode();
  if (!code) {
    throw new Error('未获取到授权 code');
  }

  // 4. 用 code 换 token
  console.log(`[微信登录] 步骤 4/5: 用授权码登录 (code=${code.substring(0, 10)}...)`);
  const loginResult = await api.wxLogin(code, state);
  if (!loginResult.success) {
    throw new Error(`登录失败: ${loginResult.message ?? '未知错误'}`);
  }

  const loginData = loginResult.data as Record<string, unknown>;
  const jwtToken = (nested(loginData, 'token') as string) || (nested(loginData, 'data', 'token') as string) || '';
  const channelToken =
    (nested(loginData, 'openclaw_channel_token') as string) ||
    (nested(loginData, 'data', 'openclaw_channel_token') as string) ||
    '';
  const userInfo = (nested(loginData, 'user_info') as Record<string, unknown>) ||
    (nested(loginData, 'data', 'user_info') as Record<string, unknown>) ||
    {};

  const loginKey = userInfo.loginKey as string | undefined;
  if (loginKey) api.loginKey = loginKey;

  api.jwtToken = jwtToken;
  api.userId = String(userInfo.user_id ?? '');

  const nickname = (userInfo.nickname as string) ?? 'unknown';
  console.log(`[微信登录] 登录成功! 用户: ${nickname}`);

  // 5. 设备绑定（服务端要求先绑定才接受 WebSocket，顺序不可颠倒）
  console.log('[微信登录] 步骤 5/5: 设备绑定...');
  const credentials: LoginCredentials = {
    channelToken,
    jwtToken,
    userId: api.userId,
    guid,
    loginKey: api.loginKey,
    userInfo,
  };
  const bindResult = await performDeviceBinding(api, {
    showQr: async (url) => {
      console.log('\n' + '='.repeat(64));
      console.log('【设备绑定】请复制下方链接，在微信中发给「文件传输助手」后点击打开：');
      console.log('='.repeat(64));
      console.log(url);
      console.log('='.repeat(64) + '\n');
    },
  });

  if (bindResult.success) {
    console.log(`[微信登录] ${bindResult.message}`);
  } else {
    console.warn(`[微信登录] ${bindResult.message}`);
    console.warn('[微信登录] 可稍后重新登录完成绑定。');
  }

  return {
    channelToken,
    jwtToken,
    userId: api.userId,
    guid,
    loginKey: api.loginKey,
    userInfo,
  };
}

export { getEnvironment };
export type { QClawEnvironment, LoginCredentials };
