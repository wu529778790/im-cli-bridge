import { describe, expect, it } from 'vitest';
import { shouldSuppressDingTalkSocketWarn } from './client.js';

describe('DingTalk client warn filter', () => {
  it('suppresses transient DingTalk gateway tls resets', () => {
    const err = Object.assign(
      new Error('Client network socket disconnected before secure TLS connection was established'),
      {
        code: 'ECONNRESET',
        host: 'wss-open-connection.dingtalk.com',
        port: 443,
      },
    );

    expect(shouldSuppressDingTalkSocketWarn(['ERROR', err])).toBe(true);
  });

  it('does not suppress unrelated warnings', () => {
    const err = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
      host: 'api.dingtalk.com',
      port: 443,
    });

    expect(shouldSuppressDingTalkSocketWarn(['ERROR', err])).toBe(false);
    expect(shouldSuppressDingTalkSocketWarn(['WARN', err])).toBe(false);
    expect(shouldSuppressDingTalkSocketWarn(['ERROR', 'plain text'])).toBe(false);
  });
});
