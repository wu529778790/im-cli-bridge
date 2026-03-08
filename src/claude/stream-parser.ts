import type { StreamEvent } from './types.js';

export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
      return parsed as StreamEvent;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function extractTextDelta(event: StreamEvent): { text: string } | null {
  const e = event as { type?: string; event?: { type?: string; delta?: { type?: string; text?: string } } };
  if (
    e.type === 'stream_event' &&
    e.event?.type === 'content_block_delta' &&
    e.event.delta?.type === 'text_delta' &&
    e.event.delta.text
  ) {
    return { text: e.event.delta.text };
  }
  return null;
}

export function extractThinkingDelta(event: StreamEvent): { text: string } | null {
  const e = event as { type?: string; event?: { type?: string; delta?: { type?: string; thinking?: string } } };
  if (
    e.type === 'stream_event' &&
    e.event?.type === 'content_block_delta' &&
    e.event.delta?.type === 'thinking_delta' &&
    e.event.delta.thinking
  ) {
    return { text: e.event.delta.thinking };
  }
  return null;
}

export function extractResult(event: StreamEvent): {
  success: boolean;
  result: string;
  accumulated: string;
  cost: number;
  durationMs: number;
  numTurns: number;
  toolStats: Record<string, number>;
} | null {
  if (event.type === 'result' && 'subtype' in event) {
    const e = event as { subtype: string; result: string; total_cost_usd?: number; duration_ms?: number; num_turns?: number };
    return {
      success: e.subtype === 'success',
      result: e.result,
      accumulated: '',
      cost: e.total_cost_usd ?? 0,
      durationMs: e.duration_ms ?? 0,
      numTurns: e.num_turns ?? 0,
      toolStats: {},
    };
  }
  return null;
}
