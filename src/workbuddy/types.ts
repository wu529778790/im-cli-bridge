/**
 * WorkBuddy Types - CodeBuddy OAuth + Centrifuge WebSocket for WeChat
 */

/** Connection state */
export type WorkBuddyState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

/** WorkBuddy OAuth credentials */
export interface WorkBuddyCredentials {
  /** OAuth access token */
  accessToken: string;
  /** OAuth refresh token */
  refreshToken: string;
  /** User ID */
  userId: string;
  /** Host/machine ID */
  hostId: string;
  /** API base URL */
  baseUrl: string;
}

/** Centrifuge connection tokens */
export interface CentrifugeTokens {
  /** WebSocket URL */
  url: string;
  /** Connection token */
  connectionToken: string;
  /** Subscription token */
  subscriptionToken: string;
  /** Channel name */
  channel: string;
}

/** WeChat KF message from Centrifuge */
export interface WeChatKfMessage {
  chatId: string;
  msgId: string;
  content: string;
  msgType?: string;
  user?: {
    nickname?: string;
    avatar?: string;
  };
  timestamp?: number;
}

/** AGP envelope format (for compatibility with existing handlers) */
export interface AGPEnvelope<T = unknown> {
  msg_id: string;
  guid?: string;
  user_id?: string;
  method: 'ping' | 'session.prompt' | 'session.update' | 'session.cancel' | 'session.promptResponse';
  payload: T;
}

/** Prompt message payload */
export interface PromptPayload {
  session_id: string;
  prompt_id: string;
  agent_app: string;
  content: Array<{ type: string; text?: string; thinking?: string }>;
}

/** Update message payload */
export interface UpdatePayload {
  session_id: string;
  prompt_id: string;
  update_type: 'message_chunk' | 'tool_call' | 'tool_call_update';
  content?: Array<{ type: string; text?: string }>;
  tool_call?: {
    id: string;
    name: string;
    input?: Record<string, unknown>;
  };
}

/** Prompt response payload */
export interface PromptResponsePayload {
  session_id: string;
  prompt_id: string;
  content?: Array<{ type: string; text?: string }>;
  error?: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'error' | 'streaming';
}
