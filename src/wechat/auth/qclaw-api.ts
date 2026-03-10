/**
 * QClaw JPRX 网关 API 客户端
 * 用于微信扫码登录、token 刷新、设备绑定
 */

import type { QClawEnvironment } from './types.js';

function nested(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export interface QClawApiResponse {
  success: boolean;
  data?: Record<string, unknown>;
  message?: string;
}

export class QClawAPI {
  private env: QClawEnvironment;
  private guid: string;
  loginKey = 'm83qdao0AmE5';
  jwtToken = '';
  userId = '';

  constructor(env: QClawEnvironment, guid: string, jwtToken = '') {
    this.env = env;
    this.guid = guid;
    this.jwtToken = jwtToken;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Version': '1',
      'X-Token': this.loginKey,
      'X-Guid': this.guid,
      'X-Account': this.userId || '1',
      'X-Session': '',
    };
    if (this.jwtToken) h['X-OpenClaw-Token'] = this.jwtToken;
    return h;
  }

  private async post(path: string, body: Record<string, unknown> = {}): Promise<QClawApiResponse> {
    const url = `${this.env.jprxGateway}${path}`;
    const payload = { ...body, web_version: '1.4.0', web_env: 'release' };

    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    const newToken = res.headers.get('X-New-Token');
    if (newToken) this.jwtToken = newToken;

    const data = (await res.json()) as Record<string, unknown>;
    const ret = data.ret;
    const commonCode =
      (nested(data, 'data', 'resp', 'common', 'code') as number) ??
      (nested(data, 'data', 'common', 'code') as number) ??
      (nested(data, 'resp', 'common', 'code') as number) ??
      (nested(data, 'common', 'code') as number);

    if (ret === 0 || commonCode === 0) {
      const respData =
        nested(data, 'data', 'resp', 'data') ??
        nested(data, 'data', 'data') ??
        data.data ??
        data;
      return { success: true, data: respData as Record<string, unknown> };
    }

    const message =
      (nested(data, 'data', 'common', 'message') as string) ??
      (nested(data, 'resp', 'common', 'message') as string) ??
      (nested(data, 'common', 'message') as string) ??
      '请求失败';
    return { success: false, message, data: data as Record<string, unknown> };
  }

  async getWxLoginState(): Promise<QClawApiResponse> {
    return this.post('data/4050/forward', { guid: this.guid });
  }

  async wxLogin(code: string, state: string): Promise<QClawApiResponse> {
    return this.post('data/4026/forward', { guid: this.guid, code, state });
  }

  async generateContactLink(openKfId: string): Promise<QClawApiResponse> {
    return this.post('data/4018/forward', {
      guid: this.guid,
      user_id: Number(this.userId),
      open_id: openKfId,
      contact_type: 'open_kfid',
    });
  }

  async queryDeviceByGuid(): Promise<QClawApiResponse> {
    return this.post('data/4019/forward', { guid: this.guid });
  }

  /** 刷新渠道 token（4058），连接前调用以获取最新 channel_token */
  async refreshChannelToken(): Promise<string | null> {
    const result = await this.post('data/4058/forward', {});
    if (result.success && result.data) {
      const d = result.data as Record<string, unknown>;
      const token =
        (nested(d, 'openclaw_channel_token') as string) ??
        (nested(d, 'data', 'openclaw_channel_token') as string) ??
        (nested(d, 'resp', 'openclaw_channel_token') as string) ??
        (nested(d, 'resp', 'data', 'openclaw_channel_token') as string) ??
        null;
      return token;
    }
    return null;
  }
}
