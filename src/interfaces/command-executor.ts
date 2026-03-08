/**
 * Command execution result
 */
export interface ExecutionResult {
  /** Exit code (0 for success) */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Whether the command was timed out */
  timedOut: boolean;
  /** Execution duration in milliseconds */
  duration: number;
}

/**
 * Stream event types from Claude CLI
 */
export type StreamEventType =
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_start'
  | 'message_delta'
  | 'message_stop'
  | 'error'
  | 'system';

/**
 * Base interface for stream events
 */
export interface StreamEvent {
  type: StreamEventType;
  timestamp?: number;
}

/**
 * Content block start event
 */
export interface ContentBlockStartEvent extends StreamEvent {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: object;
  };
}

/**
 * Content block delta event
 */
export interface ContentBlockDeltaEvent extends StreamEvent {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
}

/**
 * Content block stop event
 */
export interface ContentBlockStopEvent extends StreamEvent {
  type: 'content_block_stop';
  index: number;
}

/**
 * Message start event
 */
export interface MessageStartEvent extends StreamEvent {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: Array<{ type: string; [key: string]: any }>;
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

/**
 * Message delta event
 */
export interface MessageDeltaEvent extends StreamEvent {
  type: 'message_delta';
  delta: {
    stop_reason: string | null;
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

/**
 * Message stop event
 */
export interface MessageStopEvent extends StreamEvent {
  type: 'message_stop';
}

/**
 * System event
 */
export interface SystemEvent extends StreamEvent {
  type: 'system';
  message: string;
  level: 'info' | 'warning' | 'error';
}

/**
 * Error event
 */
export interface ErrorEvent extends StreamEvent {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

/**
 * Union type for all stream events
 */
export type ClaudeStreamEvent =
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | SystemEvent
  | ErrorEvent;

/**
 * Progress callback for tool execution
 */
export interface ToolProgress {
  /** Tool name */
  name: string;
  /** Tool ID */
  toolId: string;
  /** Status */
  status: 'starting' | 'in_progress' | 'completed' | 'failed';
  /** Progress percentage (0-100) */
  progress?: number;
  /** Additional status message */
  message?: string;
}

/**
 * Options for command execution
 */
export interface ExecutionOptions {
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Whether to throw on error */
  throwOnError?: boolean;
}

/**
 * Options for streaming execution
 */
export interface StreamExecutionOptions extends ExecutionOptions {
  /** Callback for stream events */
  onEvent?: (event: ClaudeStreamEvent) => void;
  /** Callback for text content */
  onText?: (text: string) => void;
  /** Callback for tool progress */
  onToolProgress?: (progress: ToolProgress) => void;
  /** Callback for errors */
  onError?: (error: Error) => void;
}

/**
 * Command executor interface
 */
export interface ICommandExecutor {
  /**
   * Execute a command and return the result
   */
  execute(command: string, args: string[], options?: ExecutionOptions): Promise<ExecutionResult>;

  /**
   * Execute a command with streaming output
   */
  executeStream(
    command: string,
    args: string[],
    options?: StreamExecutionOptions
  ): Promise<ExecutionResult>;

  /**
   * Validate if the executor is available
   */
  validate(): Promise<boolean>;
}
