/**
 * QClaw 环境配置（生产/测试）
 */

import type { QClawEnvironment } from './types.js';

const ENVIRONMENT_CONFIGS: Record<string, Omit<QClawEnvironment, 'wxAppId'>> = {
  production: {
    jprxGateway: 'https://jprx.m.qq.com/',
    wxLoginRedirectUri: 'https://security.guanjia.qq.com/login',
    wechatWsUrl: 'wss://mmgrcalltoken.3g.qq.com/agentwss',
  },
  test: {
    jprxGateway: 'https://jprx.sparta.html5.qq.com/',
    wxLoginRedirectUri: 'https://security-test.guanjia.qq.com/login',
    wechatWsUrl: 'wss://jprx.sparta.html5.qq.com/agentwss',
  },
};

export function getEnvironment(name: string, appId: string): QClawEnvironment {
  const config = ENVIRONMENT_CONFIGS[name];
  if (!config) throw new Error(`未知环境: ${name}，可选: ${Object.keys(ENVIRONMENT_CONFIGS).join(', ')}`);
  return { ...config, wxAppId: appId };
}
