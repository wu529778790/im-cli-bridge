/**
 * WorkBuddy OAuth - CodeBuddy authentication for WeChat KF integration
 */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { createLogger } from '../logger.js';
import type { WorkBuddyCredentials, CentrifugeTokens } from './types.js';

const log = createLogger('WorkBuddyOAuth');
const DEFAULT_BASE_URL = 'https://copilot.tencent.com';
const PLATFORM = 'ide';

export class WorkBuddyOAuth {
  private baseUrl: string;
  private hostId: string;

  // Credentials
  accessToken = '';
  refreshToken = '';
  userId = '';

  constructor(baseUrl = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.hostId = hostname();
  }

  private getHeaders(auth = true): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (auth && this.accessToken) {
      h['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return h;
  }

  /**
   * Get login URL and state for OAuth flow
   */
  async fetchAuthState(): Promise<{ authUrl: string; state: string }> {
    const url = `${this.baseUrl}/v2/plugin/auth/state?platform=${PLATFORM}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(false),
        'X-No-Authorization': 'true',
        'X-No-User-Id': 'true',
        'X-No-Enterprise-Id': 'true',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`fetchAuthState failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as any;
    const result = data?.data;
    if (!result?.authUrl || !result?.state) {
      throw new Error('fetchAuthState: missing authUrl or state in response');
    }
    return { authUrl: result.authUrl, state: result.state };
  }

  /**
   * Poll for OAuth token after user completes login
   */
  async pollToken(
    state: string,
    signal?: AbortSignal,
    timeoutMs = 5 * 60 * 1000,
  ): Promise<{ accessToken: string; refreshToken: string; userId?: string }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) throw new Error('登录已取消');
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const url = `${this.baseUrl}/v2/plugin/auth/token?state=${state}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            ...this.getHeaders(false),
            'X-No-Authorization': 'true',
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          // code 11217 = still waiting
          if (body.includes('11217')) continue;
          throw new Error(`pollToken: ${res.status} ${body}`);
        }
        const data = (await res.json()) as any;
        const token = data?.data;
        if (token?.accessToken) {
          this.accessToken = token.accessToken;
          this.refreshToken = token.refreshToken || '';
          return {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken || '',
            userId: token.userId,
          };
        }
      } catch (e: any) {
        // code 11217 = still waiting, continue polling
        if (e?.message?.includes('11217')) continue;
        // network errors: retry
        if (e?.code === 'UND_ERR_CONNECT_TIMEOUT' || e?.code === 'ECONNREFUSED') continue;
        throw e;
      }
    }
    throw new Error('登录超时（5 分钟）');
  }

  /**
   * Get account info
   */
  async getAccount(state: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const start = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) throw new Error('操作已取消');
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const url = `${this.baseUrl}/v2/plugin/login/account?state=${state}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            ...this.getHeaders(),
            'X-No-User-Id': 'true',
            'X-No-Enterprise-Id': 'true',
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          if (body.includes('12151')) continue;
          throw new Error(`getAccount: ${res.status} ${body}`);
        }
        const data = (await res.json()) as any;
        if (data?.data) return data.data;
      } catch (e: any) {
        if (e?.message?.includes('12151')) continue;
        throw e;
      }
    }
    throw new Error('获取账号信息超时');
  }

  /**
   * Refresh access token
   */
  async refreshTokenAuth(): Promise<{ accessToken: string; refreshToken: string }> {
    const url = `${this.baseUrl}/v2/plugin/auth/token/refresh`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'X-Refresh-Token': this.refreshToken,
        'X-Auth-Refresh-Source': 'ide-main',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const status = res.status;
      if (status === 401 || status === 403) {
        throw new Error('Token 已过期，请重新登录');
      }
      throw new Error(`refreshToken failed: ${status} ${res.statusText}`);
    }
    const data = (await res.json()) as any;
    const token = data?.data;
    if (token?.accessToken) {
      this.accessToken = token.accessToken;
      if (token.refreshToken) this.refreshToken = token.refreshToken;
      return { accessToken: token.accessToken, refreshToken: token.refreshToken || this.refreshToken };
    }
    throw new Error('refreshToken: missing accessToken in response');
  }

  /**
   * Build sessionId for WorkBuddy workspace
   */
  buildSessionId(_workspacePath?: string): string {
    // Keep session ID ≤64 chars: WeChat KF uses it as `touser` in send_msg.
    // userId (36) + "_" + hostId (≤26) is always well under the 64-char limit.
    return `${this.userId}_${this.hostId}`;
  }

  /**
   * Get WeChat KF binding link
   */
  async getWeChatKfLink(sessionId: string, userId?: string): Promise<{
    success: boolean;
    url?: string;
    expiresIn?: number;
    message?: string;
  }> {
    const url = `${this.baseUrl}/v2/backgroundagent/wechatkfProxy/link`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ sessionId, userId: userId || this.userId }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { success: false, message: `获取链接失败: ${res.status} ${body}` };
    }
    return (await res.json()) as any;
  }

  /**
   * Check WeChat KF binding status
   */
  async getWeChatKfBindStatus(sessionId: string): Promise<{
    success: boolean;
    bound: boolean;
    externalUserId?: string;
    boundAt?: string;
    nickname?: string;
    avatar?: string;
    message?: string;
  }> {
    const url = `${this.baseUrl}/v2/backgroundagent/wechatkfProxy/bindStatus?sessionId=${encodeURIComponent(sessionId)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { success: false, bound: false, message: `查询状态失败: ${res.status}` };
    }
    return (await res.json()) as any;
  }

  /**
   * Poll binding status until bound
   */
  async pollBindStatus(
    sessionId: string,
    intervalMs = 10_000,
    timeoutMs = 5 * 60 * 1000,
  ): Promise<{ bound: boolean; nickname?: string; avatar?: string; externalUserId?: string }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const result = await this.getWeChatKfBindStatus(sessionId);
      if (result.success && result.bound) {
        return {
          bound: true,
          nickname: result.nickname,
          avatar: result.avatar,
          externalUserId: result.externalUserId,
        };
      }
    }
    return { bound: false };
  }

  /**
   * Register workspace to get Centrifuge connection tokens
   */
  async registerWorkspace(params: {
    userId: string;
    hostId: string;
    workspaceId: string;
    workspaceName: string;
  }): Promise<CentrifugeTokens> {
    const url = `${this.baseUrl}/v2/agentos/localagent/registerWorkspace`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        ...params,
        localAgentType: 'ide',
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`registerWorkspace failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as any;
    if (!data?.data) throw new Error('registerWorkspace: missing data field');
    return data.data;
  }

  /**
   * Register channel for WeChat KF
   */
  async registerChannel(params: {
    type: string;
    sessionId: string;
    channelId?: string;
    [key: string]: unknown;
  }): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}/v2/backgroundagent/localProxy/register`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`registerChannel failed: ${res.status} ${body}`);
    }
    return (await res.json()) as any;
  }

  /**
   * Send response to WeChat KF
   */
  async sendResponse(payload: {
    type: string;
    msgId: string;
    chatId: string;
    success: boolean;
    message: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const url = `${this.baseUrl}/v2/backgroundagent/wecom/local-proxy/receive`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`sendResponse failed: ${res.status} ${res.statusText}`);
  }

  /**
   * Load credentials from object
   */
  loadCredentials(creds: Partial<WorkBuddyCredentials>): void {
    this.accessToken = creds.accessToken || '';
    this.refreshToken = creds.refreshToken || '';
    this.userId = creds.userId || '';
  }

  /**
   * Export credentials
   */
  exportCredentials(): WorkBuddyCredentials {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      userId: this.userId,
      hostId: this.hostId,
      baseUrl: this.baseUrl,
    };
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return !!this.accessToken && !!this.userId;
  }
}
