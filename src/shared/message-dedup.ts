import { DEDUP_TTL_MS } from '../constants.js';

const MAX_DEDUP_SIZE = 1000;

export class MessageDedup {
  private processedMessages = new Map<string, number>();

  isDuplicate(messageId: string): boolean {
    const now = Date.now();
    if (this.processedMessages.has(messageId)) return true;
    this.processedMessages.set(messageId, now);
    for (const [id, ts] of this.processedMessages) {
      if (now - ts > DEDUP_TTL_MS) this.processedMessages.delete(id);
      else break;
    }
    while (this.processedMessages.size > MAX_DEDUP_SIZE) {
      const k = this.processedMessages.keys().next().value;
      if (k !== undefined) this.processedMessages.delete(k);
      else break;
    }
    return false;
  }
}
