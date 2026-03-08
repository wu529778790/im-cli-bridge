/**
 * IMMessage 到 Message 的适配器
 * 将 IM 客户端的消息格式转换为 Router 使用的统一格式
 */

import { Message, Platform } from '../interfaces/types';
import { IMMessage } from '../interfaces/im-client.interface';

/**
 * 从 IMMessage.content 提取纯文本内容
 */
function extractTextContent(content: string | Record<string, any>): string {
  if (typeof content === 'string') {
    return content;
  }
  if (content && typeof content === 'object') {
    // 飞书文本消息格式: { text: "xxx" }
    if (typeof content.text === 'string') {
      return content.text;
    }
    // 卡片等复杂类型，尝试提取可读文本
    if (content.content && typeof content.content === 'string') {
      return content.content;
    }
    // 降级为 JSON 字符串
    return JSON.stringify(content);
  }
  return '';
}

/**
 * 获取消息的回复目标 ID（用于 sendText 的 userId 参数）
 * - Telegram: 使用 receiverId (chat.id)
 * - Feishu: 群聊用 groupId，私聊用 userId (sender)
 */
function getReplyTarget(imMessage: IMMessage, platform: Platform): string {
  if (platform === 'telegram') {
    // Telegram: receiverId 即 chat.id，是回复目标
    return imMessage.receiverId || imMessage.userId;
  }
  if (platform === 'feishu') {
    // Feishu: 群聊用 groupId，私聊用 userId
    return imMessage.groupId || imMessage.userId;
  }
  return imMessage.receiverId || imMessage.groupId || imMessage.userId;
}

/**
 * 将 IMMessage 转换为 Router 使用的 Message 格式
 */
export function immessageToMessage(imMessage: IMMessage, platform: Platform): Message {
  return {
    id: imMessage.id,
    userId: getReplyTarget(imMessage, platform),
    content: extractTextContent(imMessage.content),
    platform,
    timestamp: imMessage.timestamp,
    metadata: {
      ...imMessage.metadata,
      originalType: imMessage.type,
      senderId: imMessage.userId
    }
  };
}
