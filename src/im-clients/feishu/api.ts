/**
 * 飞书 API 封装
 * 提供访问飞书开放平台 API 的方法
 */

import axios, { AxiosInstance } from 'axios';
import { Logger } from '../../utils/logger';

/**
 * 飞书 API 配置
 */
export interface FeishuApiConfig {
  appId: string;
  appSecret: string;
  apiEndpoint?: string;
  timeout?: number;
}

/**
 * 租户访问令牌响应
 */
interface TenantAccessTokenResponse {
  code: number;
  msg: string;
  tenant_access_token: string;
  expire: number;
}

/**
 * 发送消息响应
 */
interface SendMessageResponse {
  code: number;
  msg: string;
  data: {
    message_id: string;
    msg_id: string;
    create_time: string;
  };
}

/**
 * 更新消息响应
 */
interface UpdateMessageResponse {
  code: number;
  msg: string;
}

/**
 * 获取文件下载URL响应
 */
interface FileDownloadUrlResponse {
  code: number;
  msg: string;
  data: {
    file_token: string;
    url: string;
    expire: number;
  };
}

/**
 * 飞书 API 类
 */
export class FeishuApi {
  private client: AxiosInstance;
  private appId: string;
  private appSecret: string;
  private tenantAccessToken: string | null = null;
  private tokenExpireTime: number = 0;
  private logger: Logger;

  constructor(config: FeishuApiConfig) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.logger = new Logger('FeishuApi');

    this.client = axios.create({
      baseURL: config.apiEndpoint || 'https://open.feishu.cn/open-apis',
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 请求拦截器 - 添加访问令牌
    this.client.interceptors.request.use(async (config) => {
      if (this.needsToken()) {
        await this.refreshTenantAccessToken();
      }
      if (this.tenantAccessToken) {
        config.headers['Authorization'] = `Bearer ${this.tenantAccessToken}`;
      }
      return config;
    });

    // 响应拦截器 - 错误处理
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        this.logger.error('API request failed:', error.response?.data || error.message);
        throw error;
      }
    );
  }

  /**
   * 检查是否需要刷新令牌
   */
  private needsToken(): boolean {
    return !this.tenantAccessToken || Date.now() >= this.tokenExpireTime;
  }

  /**
   * 获取租户访问令牌
   */
  async getTenantAccessToken(): Promise<string> {
    if (this.needsToken()) {
      await this.refreshTenantAccessToken();
    }
    return this.tenantAccessToken!;
  }

  /**
   * 刷新租户访问令牌
   */
  private async refreshTenantAccessToken(): Promise<void> {
    try {
      this.logger.debug('Refreshing tenant access token');

      const response = await this.client.post<TenantAccessTokenResponse>(
        '/auth/v3/tenant_access_token/internal',
        {
          app_id: this.appId,
          app_secret: this.appSecret,
        }
      );

      if (response.data.code !== 0) {
        throw new Error(`Failed to get tenant access token: ${response.data.msg}`);
      }

      this.tenantAccessToken = response.data.tenant_access_token;
      // 提前5分钟过期
      this.tokenExpireTime = Date.now() + (response.data.expire - 300) * 1000;

      this.logger.debug('Tenant access token refreshed successfully');
    } catch (error) {
      this.logger.error('Failed to refresh tenant access token:', error);
      throw error;
    }
  }

  /**
   * 发送文本消息
   * @param receiveId 接收者ID (open_id)
   * @param content 文本内容
   * @returns 消息ID
   */
  async sendText(receiveId: string, content: string): Promise<string> {
    this.logger.debug(`Sending text message to ${receiveId}`);

    const response = await this.client.post<SendMessageResponse>('/im/v1/messages', {
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text: content }),
    });

    if (response.data.code !== 0) {
      throw new Error(`Failed to send text message: ${response.data.msg}`);
    }

    this.logger.debug(`Text message sent successfully: ${response.data.data.message_id}`);
    return response.data.data.message_id;
  }

  /**
   * 发送卡片消息
   * @param receiveId 接收者ID (open_id)
   * @param content 卡片内容 (JSON字符串)
   * @returns 消息ID
   */
  async sendCard(receiveId: string, content: string): Promise<string> {
    this.logger.debug(`Sending card message to ${receiveId}`);

    const response = await this.client.post<SendMessageResponse>('/im/v1/messages', {
      receive_id: receiveId,
      msg_type: 'interactive',
      content: content,
    });

    if (response.data.code !== 0) {
      throw new Error(`Failed to send card message: ${response.data.msg}`);
    }

    this.logger.debug(`Card message sent successfully: ${response.data.data.message_id}`);
    return response.data.data.message_id;
  }

  /**
   * 回复消息
   * @param messageId 要回复的消息ID
   * @param content 回复内容
   * @param msgType 消息类型 (text 或 interactive)
   * @returns 回复消息ID
   */
  async replyMessage(messageId: string, content: string, msgType: 'text' | 'interactive' = 'interactive'): Promise<string> {
    this.logger.debug(`Replying to message ${messageId}`);

    const response = await this.client.post<SendMessageResponse>(
      `/im/v1/messages/${messageId}/reply`,
      {
        msg_type: msgType,
        content: content,
      }
    );

    if (response.data.code !== 0) {
      throw new Error(`Failed to reply message: ${response.data.msg}`);
    }

    this.logger.debug(`Reply sent successfully: ${response.data.data.message_id}`);
    return response.data.data.message_id;
  }

  /**
   * 更新消息
   * @param messageId 要更新的消息ID
   * @param content 新内容
   */
  async updateMessage(messageId: string, content: string): Promise<void> {
    this.logger.debug(`Updating message ${messageId}`);

    const response = await this.client.patch<UpdateMessageResponse>(
      `/im/v1/messages/${messageId}`,
      {
        content: content,
      }
    );

    if (response.data.code !== 0) {
      this.logger.warn(`Failed to update message: ${response.data.msg}`);
    } else {
      this.logger.debug(`Message updated successfully: ${messageId}`);
    }
  }

  /**
   * 获取媒体文件下载URL
   * @param messageId 消息ID
   * @param fileKey 文件key
   * @param type 文件类型 (image, video, file 等)
   * @returns 下载URL和过期时间
   */
  async getMediaDownloadUrl(messageId: string, fileKey: string, type: string = 'file'): Promise<{
    url: string;
    expireTime: number;
  }> {
    this.logger.debug(`Getting download URL for file ${fileKey}`);

    const response = await this.client.get<FileDownloadUrlResponse>(
      `/im/v1/messages/${messageId}/resources/${fileKey}`,
      {
        params: { type },
      }
    );

    if (response.data.code !== 0) {
      throw new Error(`Failed to get download URL: ${response.data.msg}`);
    }

    return {
      url: response.data.data.url,
      expireTime: response.data.data.expire * 1000,
    };
  }

  /**
   * 下载媒体文件
   * @param messageId 消息ID
   * @param fileKey 文件key
   * @param type 文件类型
   * @returns 文件Buffer和Content-Type
   */
  async downloadMedia(messageId: string, fileKey: string, type: string = 'file'): Promise<{
    buffer: Buffer;
    contentType: string;
  }> {
    this.logger.debug(`Downloading media file ${fileKey}`);

    const { url } = await this.getMediaDownloadUrl(messageId, fileKey, type);

    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';

    this.logger.debug(`Media file downloaded: ${fileKey}, size: ${response.data.byteLength}`);

    return {
      buffer: Buffer.from(response.data),
      contentType,
    };
  }

  /**
   * 获取用户信息
   * @param userId 用户ID (open_id)
   */
  async getUserInfo(userId: string): Promise<any> {
    this.logger.debug(`Getting user info for ${userId}`);

    const response = await this.client.get('/contact/v3/users/:user_id', {
      params: {
        user_id: userId,
        user_id_type: 'open_id',
      },
    });

    if (response.data.code !== 0) {
      throw new Error(`Failed to get user info: ${response.data.msg}`);
    }

    return response.data.data;
  }
}
