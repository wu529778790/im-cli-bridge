/**
 * WeChat Transport Interface — WorkBuddy Centrifuge 实现
 */

import type { AGPEnvelope } from './types.js';
import type { WeChatChannelState } from './types.js';

/** 消息回调处理函数 */
export type MessageHandler = (envelope: AGPEnvelope) => Promise<void>;

/** 状态变更回调 */
export type StateChangeHandler = (state: WeChatChannelState) => void;

/**
 * WeChat 传输接口
 *
 * client.ts 通过此接口与传输层交互，无需关心底层协议。
 */
export interface WeChatTransport {
  /** 连接到服务端 */
  start(): Promise<void>;

  /** 断开连接并释放资源 */
  stop(): void;

  /**
   * 发送 AGP 消息
   * @param method AGP 方法名（如 session.promptResponse, session.update）
   * @param payload 消息负载
   * @param replyTo 回复的 msg_id（可选）
   */
  send(method: string, payload: unknown, replyTo?: string): void;

  /**
   * 注册消息回调
   * @param handler 收到 AGP envelope 时的回调
   */
  onMessage(handler: MessageHandler): void;

  /**
   * 注册状态变更回调
   * @param handler 连接状态变更时的回调
   */
  onStateChange(handler: StateChangeHandler): void;

  /** 获取当前连接状态 */
  getState(): WeChatChannelState;
}
