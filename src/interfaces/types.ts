/**
 * 基础类型定义
 */

// IM平台类型
export type Platform = 'feishu' | 'telegram' | 'wechat' | 'dingtalk';

// 消息类型
export interface Message {
  id: string;
  userId: string;
  content: string;
  platform: Platform;
  timestamp: number;
  metadata?: Record<string, any>;
}

// IM客户端接口
export interface IMClient {
  platform: Platform;
  sendMessage(userId: string, content: string): Promise<void>;
  onMessage?(callback: (message: Message) => void): void;
}

// 命令类型
export type CommandType =
  | 'help'
  | 'new'
  | 'clear'
  | 'status'
  | 'cd'
  | 'model'
  | 'resume';

// 解析后的命令
export interface ParsedCommand {
  type: CommandType;
  args?: string[];
  raw: string;
}

// 会话配置
export interface SessionOptions {
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  workingDirectory?: string;
  maxTokens?: number;
}

// 会话数据
export interface Session {
  id: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  options: SessionOptions;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  }>;
  metadata?: Record<string, any>;
}

// 事件类型
export type EventType =
  | 'message:received'
  | 'message:sent'
  | 'message:updated'
  | 'message:read'
  | 'message:recalled'
  | 'session:created'
  | 'session:updated'
  | 'command:executed'
  | 'webhook:event'
  | 'client:started'
  | 'client:stopped'
  | 'bot:added'
  | 'bot:removed'
  | 'callback_query'
  | 'error'
  | 'rate_limit:exceeded'
  | 'ai_cli:timeout'
  | 'auth:failed'
  | 'network:error';

// 事件回调
export type EventCallback = (data: any) => void | Promise<void>;
