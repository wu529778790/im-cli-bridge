/**
 * chatId -> userId / platform 映射，用于权限请求时根据 chatId 查找用户与平台
 * 在用户发送消息时更新
 */
const chatToUser = new Map<string, string>();
const chatToPlatform = new Map<string, string>();

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
