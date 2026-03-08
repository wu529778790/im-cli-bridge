export interface StreamInit {
  type: 'system';
  subtype: 'init';
  session_id: string;
  model: string;
}

export interface StreamContentBlockDelta {
  type: 'stream_event';
  event: {
    type: 'content_block_delta';
    index: number;
    delta: { type: string; text?: string; thinking?: string; partial_json?: string };
  };
}

export interface StreamContentBlockStop {
  type: 'stream_event';
  event: { type: 'content_block_stop'; index: number };
}

export interface StreamContentBlockStart {
  type: 'stream_event';
  event: {
    type: 'content_block_start';
    index: number;
    content_block: { type: string; name?: string };
  };
}

export interface StreamResult {
  type: 'result';
  subtype: 'success' | 'error';
  result: string;
  total_cost_usd: number;
  duration_ms: number;
  num_turns: number;
}

export type StreamEvent =
  | StreamInit
  | StreamContentBlockDelta
  | StreamContentBlockStart
  | StreamContentBlockStop
  | StreamResult
  | { type: string; [key: string]: unknown };

export function isStreamInit(e: StreamEvent): e is StreamInit {
  return e.type === 'system' && 'subtype' in e && (e as StreamInit).subtype === 'init';
}

export function isContentBlockDelta(e: StreamEvent): e is StreamContentBlockDelta {
  return (
    e.type === 'stream_event' &&
    typeof (e as StreamContentBlockDelta).event === 'object' &&
    (e as StreamContentBlockDelta).event.type === 'content_block_delta'
  );
}

export function isContentBlockStart(e: StreamEvent): e is StreamContentBlockStart {
  return (
    e.type === 'stream_event' &&
    typeof (e as StreamContentBlockStart).event === 'object' &&
    (e as StreamContentBlockStart).event.type === 'content_block_start'
  );
}

export function isContentBlockStop(e: StreamEvent): e is StreamContentBlockStop {
  return (
    e.type === 'stream_event' &&
    typeof (e as StreamContentBlockStop).event === 'object' &&
    (e as StreamContentBlockStop).event.type === 'content_block_stop'
  );
}

export function isStreamResult(e: StreamEvent): e is StreamResult {
  return e.type === 'result' && 'subtype' in e;
}
