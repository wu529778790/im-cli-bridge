export interface QQAttachment {
  url?: string;
  filename?: string;
  contentType?: string;
  size?: number;
  width?: number;
  height?: number;
  raw: Record<string, unknown>;
}

interface QQMessageEventBase {
  id: string;
  content: string;
  userOpenid: string;
  attachments?: QQAttachment[];
  raw?: Record<string, unknown>;
}

export interface QQPrivateMessageEvent extends QQMessageEventBase {
  type: "private";
}

export interface QQGroupMessageEvent extends QQMessageEventBase {
  type: "group";
  groupOpenid: string;
}

export interface QQChannelMessageEvent extends QQMessageEventBase {
  type: "channel";
  channelId: string;
}

export type QQMessageEvent =
  | QQPrivateMessageEvent
  | QQGroupMessageEvent
  | QQChannelMessageEvent;

