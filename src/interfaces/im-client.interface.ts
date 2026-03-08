/**
 * IM客户端接口定义
 * 定义了IM客户端的核心功能和配置
 */

/**
 * IM客户端配置接口
 */
export interface IMClientConfig {
  /** 应用ID */
  appId: string;
  /** 应用密钥 */
  appSecret?: string;
  /** 应用密钥版本 */
  appSecretVersion?: string;
  /** 是否启用加密 */
  encryptKey?: string;
  /** 验证令牌 */
  verifyToken?: string;
  /** 事件回调URL */
  eventUrl?: string;
  /** 是否启用调试模式 */
  debug?: boolean;
  /** 请求超时时间(毫秒) */
  timeout?: number;
  /** 自定义API端点 */
  apiEndpoint?: string;
  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * 消息类型枚举
 */
export enum MessageType {
  TEXT = 'text',
  CARD = 'card',
  IMAGE = 'image',
  FILE = 'file',
  AUDIO = 'audio',
  VIDEO = 'video',
  LOCATION = 'location',
  STICKER = 'sticker'
}

/**
 * 聊天类型枚举
 */
export enum ChatType {
  PRIVATE = 'private',
  GROUP = 'group',
  DISCUSSION = 'discussion'
}

/**
 * 卡片元素接口
 */
export interface CardElement {
  /** 元素类型 */
  type: string;
  /** 元素内容 */
  content: Record<string, any>;
  /** 标签 */
  tag?: string;
}

/**
 * 卡片内容接口
 */
export interface CardContent {
  /** 卡片元素数组 */
  elements: CardElement[];
  /** 卡片标题 */
  title?: string;
  /** 卡片版本 */
  version?: string;
  /** 卡片配置 */
  config?: {
    wideScreenMode?: boolean;
  };
}

/**
 * 消息元数据接口
 */
export interface MessageMetadata {
  /** 消息是否已编辑 */
  edited?: boolean;
  /** 消息是否被撤回 */
  recalled?: boolean;
  /** 回复的消息ID */
  replyToMessageId?: string;
  /** 转发的消息ID */
  forwardFromMessageId?: string;
  /** 自定义数据 */
  custom?: Record<string, any>;
}

/**
 * IM消息接口
 */
export interface IMMessage {
  /** 消息唯一标识 */
  id: string;
  /** 消息类型 */
  type: MessageType;
  /** 消息内容(文本或卡片) */
  content: string | CardContent;
  /** 发送者用户ID */
  userId: string;
  /** 接收者用户ID(私聊) */
  receiverId?: string;
  /** 群组ID(群聊) */
  groupId?: string;
  /** 聊天类型 */
  chatType: ChatType;
  /** 消息时间戳 */
  timestamp: number;
  /** 消息元数据 */
  metadata?: MessageMetadata;
  /** 消息状态 */
  status?: 'sending' | 'sent' | 'failed' | 'delivered' | 'read';
}

/**
 * 媒体文件信息接口
 */
export interface MediaInfo {
  /** 文件key */
  fileKey: string;
  /** 文件名 */
  fileName: string;
  /** 文件大小(字节) */
  fileSize: number;
  /** 文件类型 */
  fileType: string;
  /** 下载URL */
  url?: string;
  /** 过期时间戳 */
  expireTime?: number;
}

/**
 * 消息更新选项接口
 */
export interface UpdateMessageOptions {
  /** 消息ID */
  messageId: string;
  /** 新内容 */
  content: string | CardContent;
  /** 是否更新卡片 */
  updateCard?: boolean;
}

/**
 * 事件监听器类型
 */
export type EventListener = (data: any) => void | Promise<void>;

/**
 * IM客户端接口
 */
export interface IMClient {
  /**
   * 初始化客户端
   * @param config 客户端配置
   */
  initialize(config: IMClientConfig): Promise<void>;

  /**
   * 启动客户端
   */
  start(): Promise<void>;

  /**
   * 停止客户端
   */
  stop(): Promise<void>;

  /**
   * 发送文本消息
   * @param userId 接收者用户ID
   * @param text 文本内容
   * @param chatType 聊天类型
   */
  sendText(userId: string, text: string, chatType?: ChatType): Promise<IMMessage>;

  /**
   * 发送卡片消息
   * @param userId 接收者用户ID
   * @param card 卡片内容
   * @param chatType 聊天类型
   */
  sendCard(userId: string, card: CardContent, chatType?: ChatType): Promise<IMMessage>;

  /**
   * 更新消息
   * @param options 更新选项
   */
  updateMessage(options: UpdateMessageOptions): Promise<IMMessage>;

  /**
   * 下载媒体文件
   * @param fileKey 文件key
   */
  downloadMedia(fileKey: string): Promise<MediaInfo>;

  /**
   * 注册事件监听器
   * @param event 事件名称
   * @param listener 监听器函数
   */
  on(event: string, listener: EventListener): void;

  /**
   * 移除事件监听器
   * @param event 事件名称
   * @param listener 监听器函数
   */
  off(event: string, listener: EventListener): void;

  /**
   * 检查客户端是否已初始化
   */
  isInitialized(): boolean;

  /**
   * 检查客户端是否正在运行
   */
  isRunning(): boolean;
}
