/**
 * WeWork (企业微信/WeCom) Type Definitions
 */

// Message status for updates
export type MessageStatus = 'thinking' | 'streaming' | 'done' | 'error';

// Connection state for WebSocket
export type WeWorkConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// WeWork API Token Response
export interface WeWorkTokenResponse {
  errcode: number;
  errmsg: string;
  access_token: string;
  expires_in: number;
}

// Stored token with expiration
export interface WeWorkToken {
  accessToken: string;
  expiresAt: number;
}

// WeWork incoming message event
export interface WeWorkMessageEvent {
  ToUserName: string;
  FromUserName: string;
  CreateTime: number;
  MsgType: string;
  MsgId?: string;
  AgentID?: number;
  Content?: string;
  // Additional fields for different message types
  Event?: string;
  EventKey?: string;
  MediaId?: string;
  ThumbMediaId?: string;
  // Text message
  Text?: { Content: string };
  // Image message
  Image?: { MediaId: string };
  // File message
  File?: { MediaId: string; Title: string; FileExt: string };
  // Voice message
  Voice?: { MediaId: string; Format: string };
  // Video message
  Video?: { MediaId: string; ThumbMediaId: string; Title: string };
}

// WeWork send message API request
export interface WeWorkSendMessageRequest {
  touser?: string;
  toparty?: string;
  totag?: number;
  msgtype: 'text' | 'image' | 'file' | 'voice' | 'video' | 'textcard' | 'news' | 'mpnews';
  agentid: number;
  text?: { content: string };
  image?: { media_id: string };
  file?: { media_id: string };
  voice?: { media_id: string };
  video?: { media_id: string; thumb_media_id: string; title: string; description?: string };
  textcard?: { title: string; description: string; url?: string; btntxt?: string };
  news?: { articles: Array<{ title: string; description: string; url: string; picurl?: string }> };
  mpnews?: { articles: Array<{ title: string; thumb_media_id: string; author?: string; content_source_url?: string; digest?: string; show_cover_pic?: number }> };
  safe?: 0 | 1;
}

// WeWork send message API response
export interface WeWorkSendMessageResponse {
  errcode: number;
  errmsg: string;
  invaliduser?: string;
  invalidparty?: string;
  invalidtag?: string;
  unlicenseduser?: string;
  msgid?: string;
}

// WeWork media upload API response
export interface WeWorkMediaUploadResponse {
  errcode: number;
  errmsg: string;
  type: string;
  media_id: string;
  created_at: string;
}

// WeWork callback event (for receiving messages)
export interface WeWorkCallbackEvent {
  ToUserName: string;
  FromUserName: string;
  CreateTime: number;
  MsgType: string;
  AgentID: number;
  Event?: string;
  EventKey?: string;
  Content?: string;
  MsgId?: string;
  // Additional fields for different message types
  MediaId?: string;
  ThumbMediaId?: string;
  // Text message
  Text?: { Content: string };
  // Image message
  Image?: { MediaId: string };
  // File message
  File?: { MediaId: string; Title: string; FileExt: string };
  // Voice message
  Voice?: { MediaId: string; Format: string };
  // Video message
  Video?: { MediaId: string; ThumbMediaId: string; Title: string };
}

// WebSocket message envelope
export interface WeWorkWebSocketMessage {
  type: 'message' | 'event' | 'ping' | 'pong';
  timestamp: number;
  data: WeWorkCallbackEvent | unknown;
}

// User info in WeWork
export interface WeWorkUserInfo {
  userid: string;
  name: string;
  department: number[];
  position?: string;
  mobile?: string;
  gender?: string;
  email?: string;
  avatar?: string;
}

// Department info in WeWork
export interface WeWorkDepartmentInfo {
  id: number;
  name: string;
  parentid: number;
  order?: number;
}

// WeWork API error codes
export enum WeWorkErrorCode {
  OK = 0,
  InvalidCredential = 40014,
  InvalidCorpId = 40001,
  InvalidAgentId = 40002,
  InvalidSecret = 40003,
  TokenExpired = 42001,
}
