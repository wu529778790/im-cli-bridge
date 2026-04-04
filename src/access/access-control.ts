import { createLogger } from '../logger.js';

const log = createLogger('AccessControl');

export class AccessControl {
  private allowedUserIds: Set<string>;

  constructor(allowedUserIds: string[]) {
    this.allowedUserIds = new Set(allowedUserIds);
    log.debug(`AccessControl initialized with ${allowedUserIds.length} allowed users:`, allowedUserIds);
  }

  isAllowed(userId: string): boolean {
    if (this.allowedUserIds.size === 0) {
      log.warn(`SECURITY: Allowing user ${userId} -- no whitelist configured. Set allowedUserIds in config or OPEN_IM_ALLOWED_USER_IDS env var to restrict access.`);
      return true;
    }
    const allowed = this.allowedUserIds.has(userId);
    log.debug(`Checking user ${userId}: ${allowed ? 'ALLOWED' : 'DENIED'}`);
    return allowed;
  }
}
