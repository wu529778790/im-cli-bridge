/**
 * 微信扫码登录（QClaw 体系）类型定义
 */

export interface QClawEnvironment {
  jprxGateway: string;
  wxLoginRedirectUri: string;
  wechatWsUrl: string;
  wxAppId: string;
}

export interface LoginCredentials {
  channelToken: string;
  jwtToken: string;
  userId: string;
  guid: string;
  /** 4058 刷新 token 时需用此值作为 X-Token header */
  loginKey?: string;
  userInfo?: Record<string, unknown>;
}
