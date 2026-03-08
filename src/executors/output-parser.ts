import {
  ClaudeStreamEvent,
  ContentBlockStartEvent,
  ContentBlockDeltaEvent,
  ToolProgress
} from '../interfaces/command-executor';

/**
 * Parsed text content with metadata
 */
export interface ParsedText {
  /** Text content */
  text: string;
  /** Whether this is a partial update */
  isPartial: boolean;
  /** Block index */
  index: number;
}

/**
 * Parsed tool use information
 */
export interface ParsedToolUse {
  /** Tool ID */
  toolId: string;
  /** Tool name */
  name: string;
  /** Tool input (may be partial) */
  input: any;
  /** Whether input is complete */
  isComplete: boolean;
  /** Block index */
  index: number;
}

/**
 * Parsed message metadata
 */
export interface ParsedMessageMeta {
  /** Message ID */
  messageId: string;
  /** Model used */
  model: string;
  /** Input tokens */
  inputTokens: number;
  /** Output tokens */
  outputTokens: number;
}

/**
 * Parser for Claude CLI stream-json output
 * Handles streaming events and extracts text, tool calls, and metadata
 */
export class OutputParser {
  private textBuffers: Map<number, string> = new Map();
  private toolInputs: Map<number, any> = new Map();
  private currentMessageMeta: ParsedMessageMeta | null = null;

  /**
   * Parse a stream event and extract structured information
   */
  parseEvent(event: ClaudeStreamEvent): {
    text?: ParsedText;
    toolUse?: ParsedToolUse;
    messageMeta?: ParsedMessageMeta;
    isComplete: boolean;
  } {
    switch (event.type) {
      case 'message_start':
        return this.parseMessageStart(event);

      case 'content_block_start':
        return this.parseContentBlockStart(event);

      case 'content_block_delta':
        return this.parseContentBlockDelta(event);

      case 'content_block_stop':
        return this.parseContentBlockStop(event);

      case 'message_delta':
        return this.parseMessageDelta(event);

      case 'message_stop':
        return this.parseMessageStop();

      case 'error':
      case 'system':
        // These are informational, no structured parsing needed
        return { isComplete: false };

      default:
        this.logger.warn(`Unknown event type: ${(event as any).type}`);
        return { isComplete: false };
    }
  }

  /**
   * Parse complete output buffer and extract all information
   */
  parseBuffer(output: string): {
    texts: ParsedText[];
    toolUses: ParsedToolUse[];
    messageMeta: ParsedMessageMeta | null;
    rawEvents: ClaudeStreamEvent[];
  } {
    const texts: ParsedText[] = [];
    const toolUses: ParsedToolUse[] = [];
    const rawEvents: ClaudeStreamEvent[] = [];

    try {
      // Split output by newlines and try to parse each line as JSON
      const lines = output.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as ClaudeStreamEvent;
          rawEvents.push(event);

          const result = this.parseEvent(event);

          if (result.text) {
            texts.push(result.text);
          }

          if (result.toolUse) {
            toolUses.push(result.toolUse);
          }

          if (result.messageMeta) {
            this.currentMessageMeta = result.messageMeta;
          }
        } catch (parseError) {
          // Not a JSON line, treat as plain text
          if (line.trim()) {
            texts.push({
              text: line + '\n',
              isPartial: false,
              index: -1
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('Error parsing output buffer', error);
    }

    return {
      texts,
      toolUses,
      messageMeta: this.currentMessageMeta,
      rawEvents
    };
  }

  /**
   * Parse message_start event
   */
  private parseMessageStart(event: any): { messageMeta?: ParsedMessageMeta; isComplete: boolean } {
    if (event.message) {
      this.currentMessageMeta = {
        messageId: event.message.id,
        model: event.message.model,
        inputTokens: event.message.usage?.input_tokens || 0,
        outputTokens: 0
      };
      return {
        messageMeta: this.currentMessageMeta,
        isComplete: false
      };
    }
    return { isComplete: false };
  }

  /**
   * Parse content_block_start event
   */
  private parseContentBlockStart(event: ContentBlockStartEvent): {
    toolUse?: ParsedToolUse;
    isComplete: boolean;
  } {
    const { index, content_block } = event;

    if (content_block.type === 'tool_use') {
      // Initialize tool input buffer
      this.toolInputs.set(index, {});

      return {
        toolUse: {
          toolId: content_block.id || '',
          name: content_block.name || '',
          input: content_block.input || {},
          isComplete: false,
          index
        },
        isComplete: false
      };
    }

    if (content_block.type === 'text') {
      // Initialize text buffer
      this.textBuffers.set(index, '');
    }

    return { isComplete: false };
  }

  /**
   * Parse content_block_delta event
   */
  private parseContentBlockDelta(event: ContentBlockDeltaEvent): {
    text?: ParsedText;
    toolUse?: ParsedToolUse;
    isComplete: boolean;
  } {
    const { index, delta } = event;

    if (delta.type === 'text_delta' && delta.text) {
      // Accumulate text
      const currentText = this.textBuffers.get(index) || '';
      const newText = currentText + delta.text;
      this.textBuffers.set(index, newText);

      return {
        text: {
          text: delta.text,
          isPartial: true,
          index
        },
        isComplete: false
      };
    }

    if (delta.type === 'input_json_delta' && delta.partial_json) {
      // Parse partial JSON for tool input
      try {
        const currentInput = this.toolInputs.get(index) || {};
        const partialInput = JSON.parse(delta.partial_json);
        const mergedInput = { ...currentInput, ...partialInput };
        this.toolInputs.set(index, mergedInput);

        return {
          toolUse: {
            toolId: '',
            name: '',
            input: mergedInput,
            isComplete: false,
            index
          },
          isComplete: false
        };
      } catch (error) {
        // Partial JSON is not valid yet, wait for more data
        return { isComplete: false };
      }
    }

    return { isComplete: false };
  }

  /**
   * Parse content_block_stop event
   */
  private parseContentBlockStop(event: any): {
    text?: ParsedText;
    toolUse?: ParsedToolUse;
    isComplete: boolean;
  } {
    const { index } = event;

    // Check if this was a text block
    if (this.textBuffers.has(index)) {
      const fullText = this.textBuffers.get(index) || '';
      this.textBuffers.delete(index);

      return {
        text: {
          text: fullText,
          isPartial: false,
          index
        },
        isComplete: false
      };
    }

    // Check if this was a tool use block
    if (this.toolInputs.has(index)) {
      const input = this.toolInputs.get(index);
      this.toolInputs.delete(index);

      return {
        toolUse: {
          toolId: '',
          name: '',
          input: input || {},
          isComplete: true,
          index
        },
        isComplete: false
      };
    }

    return { isComplete: false };
  }

  /**
   * Parse message_delta event
   */
  private parseMessageDelta(event: any): { isComplete: boolean } {
    if (event.usage && this.currentMessageMeta) {
      this.currentMessageMeta.outputTokens += event.usage.output_tokens || 0;
    }
    return { isComplete: false };
  }

  /**
   * Parse message_stop event
   */
  private parseMessageStop(): { isComplete: boolean } {
    // Clean up any remaining buffers
    this.textBuffers.clear();
    this.toolInputs.clear();

    return { isComplete: true };
  }

  /**
   * Reset parser state
   */
  reset(): void {
    this.textBuffers.clear();
    this.toolInputs.clear();
    this.currentMessageMeta = null;
  }

  /**
   * Simple logger for the parser
   */
  private logger = {
    debug: (message: string, ...args: any[]) => {
      if (process.env.DEBUG) {
        console.error(`[OutputParser] DEBUG:`, message, ...args);
      }
    },
    warn: (message: string, ...args: any[]) => {
      console.error(`[OutputParser] WARN:`, message, ...args);
    },
    error: (message: string, error?: any, ...args: any[]) => {
      console.error(`[OutputParser] ERROR:`, message, error, ...args);
    }
  };
}

/**
 * Utility function to extract all text from stream events
 */
export function extractAllText(events: ClaudeStreamEvent[]): string {
  let text = '';
  const parser = new OutputParser();

  for (const event of events) {
    const result = parser.parseEvent(event);
    if (result.text) {
      text += result.text.text;
    }
  }

  return text;
}

/**
 * Utility function to extract all tool uses from stream events
 */
export function extractAllToolUses(events: ClaudeStreamEvent[]): ParsedToolUse[] {
  const toolUses: ParsedToolUse[] = [];
  const parser = new OutputParser();

  for (const event of events) {
    const result = parser.parseEvent(event);
    if (result.toolUse) {
      toolUses.push(result.toolUse);
    }
  }

  return toolUses;
}
