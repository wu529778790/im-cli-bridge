/**
 * chatId -> userId 映射，用于权限请求时根据 chatId 查找用户
 * 在用户发送消息时更新
 */
const chatToUser = new Map<string, string>();

export function setChatUser(chatId: string, userId: string): void {
  chatToUser.set(chatId, userId);
}

export function getUserIdByChatId(chatId: string): string | undefined {
  return chatToUser.get(chatId);
}
