/**
 * chatId -> userId / platform 映射，用于权限请求时根据 chatId 查找用户与平台
 * 在用户发送消息时更新
 */
const chatToUser = new Map<string, string>();
const chatToPlatform = new Map<string, string>();

// Periodic cleanup to prevent unbounded growth (keep last 1000 entries)
const CHAT_MAP_MAX_SIZE = 1000;
setInterval(() => {
  if (chatToUser.size > CHAT_MAP_MAX_SIZE) {
    const keysToDelete = [...chatToUser.keys()].slice(0, chatToUser.size - CHAT_MAP_MAX_SIZE);
    for (const key of keysToDelete) {
      chatToUser.delete(key);
      chatToPlatform.delete(key);
    }
  }
}, 60 * 60 * 1000); // Check every hour

export function setChatUser(chatId: string, userId: string, platform?: string): void {
  chatToUser.set(chatId, userId);
  if (platform) chatToPlatform.set(chatId, platform);
}

export function getUserIdByChatId(chatId: string): string | undefined {
  return chatToUser.get(chatId);
}

export function getPlatformByChatId(chatId: string): string | undefined {
  return chatToPlatform.get(chatId);
}
