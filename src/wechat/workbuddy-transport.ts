/**
 * WorkBuddy Transport - 通过 Centrifuge WebSocket 连接微信
 *
 * 使用 CodeBuddy/WorkBuddy OAuth 获取 Centrifuge 凭证，
 * 订阅频道接收消息，通过 HTTP POST 发送回复。
 */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../logger.js';
import type { AGPEnvelope, WeChatChannelState } from './types.js';
import type { WeChatTransport, MessageHandler, StateChangeHandler } from './transport.js';
import { WorkBuddyCentrifugeClient, type CentrifugeClientConfig, type CentrifugeCallbacks } from '../workbuddy/centrifuge-client.js';
import { WorkBuddyOAuth } from '../workbuddy/oauth.js';

const log = createLogger('WeChat:WorkBuddy');

export interface WorkBuddyTransportConfig {
  accessToken: string;
  refreshToken: string;
  userId: string;
  hostId?: string;
  baseUrl?: string;
  guid?: string;
  workspacePath?: string;
}

const RECONNECT_DELAYS_MS = [3000, 5000, 10000, 20000, 30000];

export class WorkBuddyTransport implements WeChatTransport {
  private config: WorkBuddyTransportConfig;
  private state: WeChatChannelState = 'disconnected';
  private centrifugeClient: WorkBuddyCentrifugeClient | null = null;
  private oauth: WorkBuddyOAuth | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private messageHandler: MessageHandler | null = null;
  private stateChangeHandler: StateChangeHandler | null = null;

  constructor(config: WorkBuddyTransportConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    this.updateState('connecting');

    try {
      // Initialize (or reuse) OAuth
      if (!this.oauth) {
        this.oauth = new WorkBuddyOAuth(this.config.baseUrl ?? 'https://copilot.tencent.com');
        this.oauth.accessToken = this.config.accessToken;
        this.oauth.refreshToken = this.config.refreshToken;
        this.oauth.userId = this.config.userId;
      }

      // Use a stable workspaceId so the server maintains a consistent channel
      // across restarts — otherwise WeChat KF loses the routing association.
      const hostId = this.config.hostId ?? hostname();
      const workspaceId = `${hostId}-open-im-wechat`;

      log.info('Registering workspace for Centrifuge tokens...');
      const tokens = await this.oauth.registerWorkspace({
        userId: this.config.userId,
        hostId,
        workspaceId,
        workspaceName: 'open-im-wechat',
      });

      log.info(`Workspace registered: channel=${tokens.channel}`);

      // workspaceSessionId must match the sessionId used when the WeChat KF was bound
      const workspacePath = this.config.workspacePath ?? join(homedir(), 'WorkBuddy', 'Claw');
      const workspaceSessionId = `${this.config.userId}_${hostId}_${workspacePath}`;
      const channel = tokens.channel;
      const oauth = this.oauth;

      // Tear down previous client before creating a new one
      if (this.centrifugeClient) {
        this.centrifugeClient.stop();
        this.centrifugeClient = null;
      }

      const clientConfig: CentrifugeClientConfig = {
        url: tokens.url,
        connectionToken: tokens.connectionToken,
        subscriptionToken: tokens.subscriptionToken,
        channel,
        guid: this.config.guid ?? randomUUID(),
        userId: this.config.userId,
        httpBaseUrl: this.config.baseUrl ?? 'https://copilot.tencent.com',
        httpAccessToken: this.config.accessToken,
        workspaceSessionId,
      };

      const callbacks: CentrifugeCallbacks = {
        onConnected: () => {
          log.info('WorkBuddy Centrifuge connected');
          this.reconnectAttempt = 0;
          this.updateState('connected');

          // Register the channel with the server so WeChat KF knows this session is online.
          oauth.registerChannel({
            type: 'wechatkf',
            sessionId: workspaceSessionId,
            channelId: channel,
            userId: this.config.userId,
          }).then((res) => {
            log.info(`Channel registered (WeChat KF online): ${JSON.stringify(res)}`);
          }).catch((err: unknown) => {
            log.warn(`registerChannel failed (WeChat KF may show offline): ${String(err)}`);
          });
        },
        onDisconnected: (reason) => {
          log.info(`WorkBuddy Centrifuge disconnected: ${reason}`);
          this.updateState('disconnected');
          this.scheduleReconnect();
        },
        onError: (error) => {
          log.error('WorkBuddy Centrifuge error:', error);
          this.updateState('error');
        },
        onMessage: async (chatId, msgId, content) => {
          const envelope: AGPEnvelope = {
            msg_id: msgId,
            guid: this.config.guid,
            user_id: this.config.userId,
            method: 'session.prompt',
            payload: {
              session_id: chatId,
              content,
              options: { stream: true },
            },
          };

          if (this.messageHandler) {
            await this.messageHandler(envelope);
          }
        },
      };

      this.centrifugeClient = new WorkBuddyCentrifugeClient(clientConfig, callbacks);
      this.centrifugeClient.start();

      log.info('WorkBuddy transport initialized');
      this.reconnectAttempt = 0;
    } catch (err) {
      log.error('Failed to start WorkBuddy transport:', err);
      this.updateState('error');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) return;

    const delayMs = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt++;
    log.info(`WorkBuddy transport reconnecting in ${delayMs}ms (attempt ${this.reconnectAttempt})...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delayMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.centrifugeClient) {
      this.centrifugeClient.stop();
      this.centrifugeClient = null;
    }
    this.updateState('disconnected');
    log.info('WorkBuddy transport stopped');
  }

  send(method: string, payload: unknown, replyTo?: string): void {
    if (!this.centrifugeClient) {
      log.warn('Cannot send message: Centrifuge client not initialized');
      return;
    }

    const msgId = replyTo ?? randomUUID();

    // For prompt responses, use HTTP path (WorkBuddy's requirement)
    if (method === 'session.promptResponse') {
      const p = payload as Record<string, unknown>;
      this.centrifugeClient.sendPromptResponse(
        {
          session_id: p.session_id as string,
          prompt_id: p.prompt_id as string ?? msgId,
          content: p.content as Array<{ type: string; text?: string }> | undefined,
          error: p.error as string | undefined,
          stop_reason: (p.stop_reason as 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'error') ?? 'end_turn',
        },
        this.config.guid,
        this.config.userId,
      );
      return;
    }

    // Use sendMessageChunk for session.update, sendToolCall for tool calls
    if (method === 'session.update') {
      const p = payload as Record<string, unknown>;
      const sessionId = p.session_id as string;
      const promptId = p.prompt_id as string ?? msgId;

      const content = p.content as Array<{ type: string; text?: string }> | undefined;
      if (content?.[0]?.text) {
        this.centrifugeClient.sendMessageChunk(
          sessionId,
          promptId,
          { type: 'text', text: content[0].text },
          this.config.guid,
          this.config.userId,
        );
      }
      return;
    }

    // Fallback: send via Centrifuge publish
    log.debug(`WorkBuddy send: method=${method}, msg_id=${msgId}`);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateChangeHandler = handler;
  }

  getState(): WeChatChannelState {
    return this.state;
  }

  private updateState(state: WeChatChannelState): void {
    this.state = state;
    this.stateChangeHandler?.(state);
    log.debug('Channel state:', state);
  }
}
