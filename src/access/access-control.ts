export class AccessControl {
  private allowedUserIds: Set<string>;

  constructor(allowedUserIds: string[]) {
    this.allowedUserIds = new Set(allowedUserIds);
  }

  isAllowed(userId: string): boolean {
    if (this.allowedUserIds.size === 0) return true;
    return this.allowedUserIds.has(userId);
  }
}
