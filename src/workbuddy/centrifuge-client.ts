/**
 * WorkBuddy Centrifuge Client - WebSocket connection for WeChat KF messages
 */

import { Centrifuge, Subscription } from 'centrifuge';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../logger.js';
import type {
  WorkBuddyState,
  CentrifugeTokens,
  WeChatKfMessage,
  AGPEnvelope,
  PromptPayload,
  UpdatePayload,
  PromptResponsePayload,
} from './types.js';

const log = createLogger('WorkBuddyCentrifuge');

/** Centrifuge client configuration */
export interface CentrifugeClientConfig {
  url: string;
  connectionToken: string;
  subscriptionToken: string;
  channel: string;
  guid: string;
  userId: string;
  httpBaseUrl?: string;
  httpAccessToken?: string;
  workspaceSessionId?: string;
  /**
   * Called before sending a WeChat KF reply to update the channel's channelId
   * to the current WeChat user's externalUserId.  The WorkBuddy server uses the
   * registered channelId as the WeChat send_msg `touser`, so this must match the
   * customer we are replying to.
   */
  registerChannelFn?: (externalUserId: string) => Promise<void>;
}

/** Client callbacks */
export interface CentrifugeCallbacks {
  onConnected?: () => void;
  onDisconnected?: (reason?: string) => void;
  onError?: (error: Error) => void;
  onMessage?: (chatId: string, msgId: string, content: string) => void;
}

export class WorkBuddyCentrifugeClient {
  private config: CentrifugeClientConfig;
  private callbacks: CentrifugeCallbacks;
  private client: Centrifuge | null = null;
  private sub: Subscription | null = null;
  private extraSubs: Subscription[] = [];
  private state: WorkBuddyState = 'disconnected';
  private processedMsgIds = new Set<string>();
  private static readonly MAX_MSG_ID_CACHE = 1000;

  constructor(config: CentrifugeClientConfig, callbacks: CentrifugeCallbacks = {}) {
    this.config = config;
    this.callbacks = callbacks;
  }

  get logPrefix(): string {
    return `[workbuddy:${this.config.userId}]`;
  }

  getState(): WorkBuddyState {
    return this.state;
  }

  start(): void {
    if (this.state === 'connected' || this.state === 'connecting') {
      log.info(`${this.logPrefix} Already connected or connecting`);
      return;
    }

    this.state = 'connecting';
    log.info(`${this.logPrefix} Connecting to: ${this.config.url}, channel=${this.config.channel}`);

    this.client = new Centrifuge(this.config.url, {
      token: this.config.connectionToken,
      websocket: WebSocket,
    });

    this.client.on('connected', (ctx: any) => {
      log.info(`${this.logPrefix} Connected (transport=${ctx.transport})`);
      this.state = 'connected';
      this.callbacks.onConnected?.();
    });

    this.client.on('disconnected', (ctx: any) => {
      log.info(`${this.logPrefix} Disconnected: code=${ctx.code}, reason=${ctx.reason}`);
      if (this.state !== 'disconnected') {
        this.state = 'disconnected';
        this.callbacks.onDisconnected?.(ctx.reason || `code=${ctx.code}`);
      }
    });

    this.client.on('connecting', (ctx: any) => {
      log.info(`${this.logPrefix} Reconnecting: code=${ctx.code}, reason=${ctx.reason}`);
      if (this.state === 'connected') {
        this.state = 'reconnecting';
      }
    });

    this.client.on('error', (ctx: any) => {
      log.error(`${this.logPrefix} Error: ${ctx.error.message}`);
      this.callbacks.onError?.(new Error(ctx.error.message));
    });

    // Create channel subscription
    this.sub = this.client.newSubscription(this.config.channel, {
      token: this.config.subscriptionToken,
    });

    this.sub.on('publication', (ctx) => {
      this.handlePublication(ctx.data);
    });

    this.sub.on('error', (ctx: any) => {
      log.error(`${this.logPrefix} Subscription error: ${ctx.error.message}`);
    });

    this.sub.subscribe();
    this.client.connect();
  }

  stop(): void {
    log.info(`${this.logPrefix} Stopping...`);
    this.state = 'disconnected';
    this.processedMsgIds.clear();

    for (const sub of this.extraSubs) {
      sub.unsubscribe();
    }
    this.extraSubs = [];

    if (this.sub) {
      this.sub.unsubscribe();
      this.sub = null;
    }
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    log.info(`${this.logPrefix} Stopped`);
  }

  setCallbacks(callbacks: Partial<CentrifugeCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Subscribe to additional channel
   */
  subscribeChannel(channel: string, subscriptionToken: string): void {
    if (!this.client) {
      log.warn(`${this.logPrefix} Cannot subscribe: client not initialized`);
      return;
    }

    log.info(`${this.logPrefix} Subscribing to additional channel: ${channel}`);
    const sub = this.client.newSubscription(channel, { token: subscriptionToken });

    sub.on('publication', (ctx) => {
      this.handlePublication(ctx.data);
    });

    sub.on('error', (ctx: any) => {
      log.error(`${this.logPrefix} Extra subscription error (${channel}): ${ctx.error.message}`);
    });

    sub.on('subscribed', () => {
      log.info(`${this.logPrefix} Extra channel subscribed: ${channel}`);
    });

    this.extraSubs.push(sub);
    sub.subscribe();
  }

  /**
   * Send message chunk through Centrifuge
   */
  sendMessageChunk(
    sessionId: string,
    promptId: string,
    content: { type: string; text?: string },
    guid?: string,
    userId?: string,
  ): void {
    const payload: UpdatePayload = {
      session_id: sessionId,
      prompt_id: promptId,
      update_type: 'message_chunk',
      content: [content],
    };
    this.sendEnvelope('session.update', payload, guid, userId);
  }

  /**
   * Send tool call through Centrifuge
   */
  sendToolCall(
    sessionId: string,
    promptId: string,
    toolCall: { id: string; name: string; input?: Record<string, unknown> },
    guid?: string,
    userId?: string,
  ): void {
    const payload: UpdatePayload = {
      session_id: sessionId,
      prompt_id: promptId,
      update_type: 'tool_call',
      tool_call: toolCall,
    };
    this.sendEnvelope('session.update', payload, guid, userId);
  }

  /**
   * Send prompt response (for WeChat KF, use HTTP instead)
   */
  async sendPromptResponse(payload: PromptResponsePayload, _guid?: string, _userId?: string): Promise<void> {
    // WeChat KF messages: send via HTTP COPILOT_RESPONSE
    if (this.config.httpBaseUrl && this.config.httpAccessToken) {
      const message = payload.content?.map((c) => c.text).join('') || payload.error || '';
      const sessionId = payload.session_id; // e.g. "wmXXX::origin::wechatkfProxy"

      // The WorkBuddy server uses the registered channelId as the WeChat KF send_msg
      // `touser`.  Re-register the channel with the current WeChat user's externalUserId
      // so that the server sends the reply to the correct customer.
      if (this.config.registerChannelFn && sessionId.includes('::')) {
        const externalUserId = sessionId.split('::')[0];
        try {
          await this.config.registerChannelFn(externalUserId);
        } catch (err) {
          log.warn(`${this.logPrefix} registerChannelFn failed (reply may go to wrong user):`, err);
        }
      }

      const httpPayload = {
        type: 'COPILOT_RESPONSE',
        msgId: payload.prompt_id,
        chatId: sessionId,
        success: payload.stop_reason === 'end_turn',
        message,
        metadata: {
          sessionId: this.config.workspaceSessionId || sessionId,
          requestId: payload.prompt_id,
          state: payload.stop_reason === 'end_turn' ? 'completed' : payload.stop_reason,
        },
      };

      const url = `${this.config.httpBaseUrl}/v2/backgroundagent/wecom/local-proxy/receive`;
      log.debug(`${this.logPrefix} HTTP COPILOT_RESPONSE → ${url} chatId=${sessionId} msgLen=${message.length}`);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.httpAccessToken}`,
          },
          body: JSON.stringify(httpPayload),
          signal: AbortSignal.timeout(30_000),
        });
        const body = await res.text().catch(() => '');
        if (!res.ok) {
          log.error(`${this.logPrefix} HTTP COPILOT_RESPONSE failed: ${res.status} ${body.substring(0, 300)}`);
        } else {
          log.info(`${this.logPrefix} HTTP COPILOT_RESPONSE ok: ${res.status} ${body.substring(0, 200)}`);
        }
      } catch (err) {
        log.error(`${this.logPrefix} HTTP COPILOT_RESPONSE error:`, err);
      }
      return;
    }

    this.sendEnvelope('session.promptResponse', payload, _guid, _userId);
  }

  /**
   * Handle incoming publication from Centrifuge
   */
  private handlePublication(data: unknown): void {
    try {
      const raw = data as Record<string, unknown>;

      // AGP format message (from QClaw gateway)
      if (raw?.method && raw?.msg_id) {
        const envelope = raw as unknown as AGPEnvelope<unknown>;
        if (this.processedMsgIds.has(envelope.msg_id)) {
          log.debug(`${this.logPrefix} Duplicate message, skipping: ${envelope.msg_id}`);
          return;
        }
        this.processedMsgIds.add(envelope.msg_id);
        this.cleanMsgIdCache();
        log.debug(`${this.logPrefix} Received AGP message: method=${envelope.method}, msg_id=${envelope.msg_id}`);

        if (envelope.method === 'session.prompt') {
          const payload = envelope.payload as PromptPayload;
          const content = payload.content?.find((c) => c.type === 'text')?.text || '';
          this.callbacks.onMessage?.(payload.session_id, envelope.msg_id, content);
        }
        return;
      }

      // WeChat KF format message (from WorkBuddy Centrifuge)
      if (raw?.chatId && raw?.msgId) {
        const msgId = String(raw.msgId);
        if (this.processedMsgIds.has(msgId)) {
          log.debug(`${this.logPrefix} Duplicate message, skipping: ${msgId}`);
          return;
        }
        this.processedMsgIds.add(msgId);
        this.cleanMsgIdCache();

        const content = String(raw.content ?? '');
        const chatId = String(raw.chatId);
        log.info(`${this.logPrefix} Received WeChat KF message: msgId=${msgId}, chatId=${chatId}, content=${content.substring(0, 50)}`);
        this.callbacks.onMessage?.(chatId, msgId, content);
        return;
      }

      const preview = JSON.stringify(data).substring(0, 500);
      log.warn(`${this.logPrefix} Unknown message format: ${preview}`);
    } catch (error: any) {
      log.error(`${this.logPrefix} Message handling failed:`, error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(`Message handling failed: ${String(error)}`));
    }
  }

  /**
   * Send AGP envelope through Centrifuge
   */
  private sendEnvelope<T>(method: string, payload: T, guid?: string, userId?: string): void {
    if (!this.client || this.state !== 'connected') {
      log.warn(`${this.logPrefix} Cannot send message, state: ${this.state}`);
      return;
    }

    const envelope: AGPEnvelope<T> = {
      msg_id: randomUUID(),
      guid: guid ?? this.config.guid,
      user_id: userId ?? this.config.userId,
      method: method as AGPEnvelope['method'],
      payload,
    };

    try {
      // Guard against the race where WebSocket transitions to CONNECTING between
      // the state check above and the actual publish call.
      this.client.publish(this.config.channel, envelope).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('WebSocket is not open') || msg.includes('readyState')) {
          log.warn(`${this.logPrefix} WebSocket not ready for send (will reconnect): ${msg}`);
        } else {
          log.error(`${this.logPrefix} Message send failed:`, err);
          this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      });

      log.debug(`${this.logPrefix} Sent message: method=${method}, msg_id=${envelope.msg_id}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('WebSocket is not open') || msg.includes('readyState')) {
        log.warn(`${this.logPrefix} WebSocket not ready for send (will reconnect): ${msg}`);
      } else {
        log.error(`${this.logPrefix} Message send failed:`, error);
        this.callbacks.onError?.(error instanceof Error ? error : new Error(`Message send failed: ${msg}`));
      }
    }
  }

  /**
   * Clean up old message IDs from cache
   */
  private cleanMsgIdCache(): void {
    if (this.processedMsgIds.size > WorkBuddyCentrifugeClient.MAX_MSG_ID_CACHE) {
      const entries = [...this.processedMsgIds];
      this.processedMsgIds.clear();
      entries
        .slice(-WorkBuddyCentrifugeClient.MAX_MSG_ID_CACHE / 2)
        .forEach((id) => {
          this.processedMsgIds.add(id);
        });
    }
  }
}
