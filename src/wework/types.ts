/**
 * WeWork (企业微信/WeCom) Type Definitions
 * 基于企业微信官方 AI_BOT WebSocket 协议
 * 参考: @wecom/wecom-openclaw-plugin
 */

// Connection state for WebSocket
export type WeWorkConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// 企业微信 WebSocket 命令枚举
// 参考: @wecom/aibot-node-sdk，官方推送消息的 cmd 为 aibot_msg_callback
export const enum WeWorkCommand {
  /** 认证订阅 */
  SUBSCRIBE = 'aibot_subscribe',
  /** 心跳 */
  PING = 'ping',
  /** 企业微信推送消息（官方协议） */
  AIBOT_CALLBACK = 'aibot_msg_callback',
  /** 回复消息（长连接模式必须用此命令，不能用 HTTP response_url） */
  AIBOT_RESPOND_MSG = 'aibot_respond_msg',
  /** 主动推送消息（无需回调，用于启动/关闭通知等） */
  AIBOT_SEND_MSG = 'aibot_send_msg',
  /** AI bot 响应消息（旧） */
  AIBOT_RESPONSE = 'aibot_response',
}

// WebSocket 请求消息基础格式
export interface WeWorkRequest {
  cmd: string;
  headers: {
    req_id: string;
  };
  body: unknown;
}

// WebSocket 响应消息格式
export interface WeWorkResponse {
  headers: {
    req_id: string;
  };
  errcode: number;
  errmsg: string;
}

// 企业微信认证请求
export interface WeWorkSubscribeRequest extends WeWorkRequest {
  cmd: WeWorkCommand.SUBSCRIBE;
  body: {
    secret: string;
    bot_id: string;
  };
}

// 企业微信推送消息格式（cmd 为 aibot_msg_callback）
export interface WeWorkCallbackMessage {
  cmd: WeWorkCommand.AIBOT_CALLBACK;
  headers: {
    req_id: string;
  };
  body: {
    msgid: string;
    aibotid: string;
    chatid: string;
    chattype: 'single' | 'group';
    from: {
      userid: string;
    };
    response_url: string;
    msgtype: 'text' | 'image' | 'voice' | 'video' | 'file' | 'stream' | 'mixed';
    text?: {
      content: string;
    };
    image?: {
      /** 图片 URL（通过 URL 方式接收图片时） */
      url?: string;
      /** 图片 base64 数据（直接传输时） */
      base64?: string;
      md5?: string;
      aeskey?: string;
    };
    /** 图文混排消息 */
    mixed?: {
      msg_item: Array<{
        msgtype: 'text' | 'image';
        text?: {
          content: string;
        };
        image?: {
          url?: string;
          base64?: string;
          md5?: string;
          aeskey?: string;
        };
      }>;
    };
    quote?: {
      msgtype: string;
      text?: {
        content: string;
      };
      image?: {
        url?: string;
        aeskey?: string;
      };
      file?: {
        url?: string;
        aeskey?: string;
      };
    };
    stream?: {
      id: string;
    };
  };
}

// 企业微信响应消息格式
export interface WeWorkResponseMessage extends WeWorkRequest {
  cmd: WeWorkCommand.AIBOT_RESPONSE;
  body: {
    msgtype: 'stream' | 'text' | 'markdown';
    stream?: {
      id: string;
      finish: boolean;
      content: string;
      msg_item?: Array<{
        msgtype: 'image' | 'file';
        image?: {
          base64: string;
          md5: string;
        };
      }>;
      feedback?: {
        id: string;
      };
    };
    text?: {
      content: string;
    };
    markdown?: {
      content: string;
    };
  };
}

// 消息状态（用于内部跟踪）
export interface MessageState {
  accumulatedText: string;
  /** 流式回复的 streamId，用于保持同一个流式回复使用相同的 streamId */
  streamId?: string;
}

// HTTP 响应请求格式（通过 response_url 发送）
export interface WeWorkHttpResponseBody {
  msgtype: 'text' | 'markdown' | 'stream';
  text?: {
    content: string;
  };
  markdown?: {
    content: string;
  };
  stream?: {
    id: string;
    finish: boolean;
    content: string;
    msg_item?: Array<{
      msgtype: 'image' | 'file';
      image?: {
        base64: string;
        md5: string;
      };
    }>;
  };
}

export interface WeWorkHttpResponse {
  msgtype: 'text' | 'markdown' | 'stream';
  [key: string]: unknown;
}
