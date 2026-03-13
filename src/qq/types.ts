export interface QQPrivateMessageEvent {
  type: "private";
  id: string;
  content: string;
  userOpenid: string;
}

export interface QQGroupMessageEvent {
  type: "group";
  id: string;
  content: string;
  userOpenid: string;
  groupOpenid: string;
}

export interface QQChannelMessageEvent {
  type: "channel";
  id: string;
  content: string;
  userOpenid: string;
  channelId: string;
}

export type QQMessageEvent =
  | QQPrivateMessageEvent
  | QQGroupMessageEvent
  | QQChannelMessageEvent;

