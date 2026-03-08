export interface ThreadContext {
  rootMessageId: string;
  threadId: string;
}

export interface CostRecord {
  totalCost: number;
  totalDurationMs: number;
  requestCount: number;
}
