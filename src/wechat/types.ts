/**
 * AGP (Agent Gateway Protocol) Type Definitions
 * Based on the OpenClaw AGP WebSocket protocol specification
 */

export interface AGPEnvelope<T = unknown> {
  msg_id: string;
  guid?: string;
  user_id?: string;
  method: AGPMethod;
  payload: T;
}

export type AGPMethod =
  | "session.prompt"
  | "session.cancel"
  | "session.update"
  | "session.promptResponse"
  | "ping";

export interface SessionPromptPayload {
  session_id: string;
  content: string;
  options?: { stream?: boolean; timeout?: number };
}

export interface SessionCancelPayload {
  session_id: string;
  reason?: string;
}

export interface SessionUpdatePayload {
  session_id: string;
  updates: { status?: string; metadata?: Record<string, unknown> };
}

export interface SessionPromptResponsePayload {
  session_id: string;
  content: string;
  status: "success" | "error" | "partial";
  metadata?: Record<string, unknown>;
}

export interface PingPayload { timestamp: number }

export interface WeChatOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri?: string;
}

export interface WeChatToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  user_id?: string;
  nickname?: string;
}

export interface WeChatWebSocketConfig {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
}

export type WeChatMessageType = "text" | "image" | "voice" | "video" | "file" | "location" | "link";

export interface WeChatIncomingMessage {
  msg_id: string;
  msg_type: WeChatMessageType;
  from_user_id: string;
  from_user_name: string;
  to_user_id: string;
  content: string;
  create_time: number;
  image_url?: string;
  file_url?: string;
  filename?: string;
  file_name?: string;
  mime_type?: string;
  mimeType?: string;
  file_size?: number;
  size?: number;
  duration?: number;
  location?: { latitude: number; longitude: number; label: string };
}

export interface WeChatOutgoingMessage {
  to_user_id: string;
  msg_type: WeChatMessageType;
  content: string;
}

export type WeChatChannelState = "disconnected" | "connecting" | "connected" | "error";

export interface WeChatClientConfig {
  oauth: WeChatOAuthConfig;
  websocket: WeChatWebSocketConfig;
  tokenStoragePath?: string;
}

export type MessageStatus = "thinking" | "streaming" | "done" | "error";
