import { createLogger } from '../logger.js';

const log = createLogger('AccessControl');

export class AccessControl {
  private allowedUserIds: Set<string>;

  constructor(allowedUserIds: string[]) {
    this.allowedUserIds = new Set(allowedUserIds);
    log.info(`AccessControl initialized with ${allowedUserIds.length} allowed users:`, allowedUserIds);
  }

  isAllowed(userId: string): boolean {
    if (this.allowedUserIds.size === 0) {
      log.warn(`Allowing user ${userId} — no whitelist configured. Set allowedUserIds to restrict access.`);
      return true;
    }
    const allowed = this.allowedUserIds.has(userId);
    log.info(`Checking user ${userId}: ${allowed ? 'ALLOWED' : 'DENIED'}`);
    return allowed;
  }
}
