import WebSocket from "ws";
import type { Config } from "../config.js";
import { createLogger } from "../logger.js";
import type { QQMessageEvent } from "./types.js";

const log = createLogger("QQ");

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const API_BASE = "https://api.sgroup.qq.com";
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
const INTENTS = {
  PUBLIC_GUILD_MESSAGES: 1 << 30,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C: 1 << 25,
};

interface TokenState {
  token: string;
  expiresAt: number;
}

interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string;
}

interface QQClient {
  sendPrivateMessage(openid: string, content: string, replyToMessageId?: string): Promise<void>;
  sendGroupMessage(groupOpenid: string, content: string, replyToMessageId?: string): Promise<void>;
  sendChannelMessage(channelId: string, content: string, replyToMessageId?: string): Promise<void>;
}

let client: QQClient | null = null;
let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;
let seq: number | null = null;
let sessionId: string | null = null;
let reconnectAttempt = 0;
let currentConfig: Config | null = null;
let currentHandler: ((event: QQMessageEvent) => Promise<void>) | null = null;
let tokenState: TokenState | null = null;

function clearTimers(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function buildAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `QQBot ${token}`,
    "Content-Type": "application/json",
  };
}

async function fetchAccessToken(config: Config): Promise<string> {
  if (tokenState && Date.now() < tokenState.expiresAt - 5 * 60 * 1000) {
    return tokenState.token;
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appId: config.qqAppId,
      clientSecret: config.qqSecret,
    }),
  });
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    message?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(data.message || `Failed to get QQ access token: HTTP ${response.status}`);
  }

  tokenState = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
  };
  return data.access_token;
}

async function apiRequest<T>(
  config: Config,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await fetchAccessToken(config);
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: buildAuthHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 401) {
      tokenState = null;
    }
    throw new Error(`QQ API ${method} ${path} failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function buildMessageBody(content: string, replyToMessageId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    content,
    msg_type: 0,
  };
  if (replyToMessageId) {
    body.msg_id = replyToMessageId;
    body.msg_seq = Math.floor(Math.random() * 65535);
  }
  return body;
}

async function getGatewayUrl(config: Config): Promise<string> {
  const data = await apiRequest<{ url: string }>(config, "GET", "/gateway");
  return data.url;
}

function normalizeInboundEvent(payload: GatewayPayload): QQMessageEvent | null {
  const type = payload.t;
  const data = (payload.d ?? {}) as Record<string, any>;

  if (type === "C2C_MESSAGE_CREATE") {
    return {
      type: "private",
      id: String(data.id ?? ""),
      content: String(data.content ?? "").trim(),
      userOpenid: String(data.author?.user_openid ?? ""),
    };
  }

  if (type === "GROUP_AT_MESSAGE_CREATE") {
    return {
      type: "group",
      id: String(data.id ?? ""),
      content: String(data.content ?? "").trim(),
      userOpenid: String(data.author?.member_openid ?? ""),
      groupOpenid: String(data.group_openid ?? ""),
    };
  }

  if (type === "AT_MESSAGE_CREATE" || type === "DIRECT_MESSAGE_CREATE") {
    return {
      type: "channel",
      id: String(data.id ?? ""),
      content: String(data.content ?? "").trim(),
      userOpenid: String(data.author?.id ?? ""),
      channelId: String(data.channel_id ?? ""),
    };
  }

  return null;
}

function startHeartbeat(intervalMs: number): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ op: 1, d: seq }));
  }, intervalMs);
}

async function connectWebSocket(config: Config, handler: (event: QQMessageEvent) => Promise<void>): Promise<void> {
  const gatewayUrl = await getGatewayUrl(config);
  const token = await fetchAccessToken(config);

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(gatewayUrl);
    ws = socket;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    socket.on("open", () => {
      log.info("QQ gateway connected");
      reconnectAttempt = 0;
    });

    socket.on("message", async (raw) => {
      try {
        const payload = JSON.parse(raw.toString()) as GatewayPayload;
        if (typeof payload.s === "number") seq = payload.s;

        if (payload.op === 10) {
          const heartbeatInterval = Number((payload.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 30000);
          startHeartbeat(heartbeatInterval);
          socket.send(
            JSON.stringify({
              op: sessionId ? 6 : 2,
              d: sessionId
                ? {
                    token: `QQBot ${token}`,
                    session_id: sessionId,
                    seq,
                  }
                : {
                    token: `QQBot ${token}`,
                    intents:
                      INTENTS.GROUP_AND_C2C |
                      INTENTS.DIRECT_MESSAGE |
                      INTENTS.PUBLIC_GUILD_MESSAGES,
                    properties: {
                      os: process.platform,
                      browser: "open-im",
                      device: "open-im",
                    },
                  },
            }),
          );
          return;
        }

        if (payload.op === 0 && payload.t === "READY") {
          sessionId = String((payload.d as { session_id?: string })?.session_id ?? "");
          settle(resolve);
          return;
        }

        if (payload.op === 0 && payload.t === "RESUMED") {
          settle(resolve);
          return;
        }

        const event = normalizeInboundEvent(payload);
        if (event && event.content) {
          await handler(event);
        }
      } catch (error) {
        log.error("Failed to handle QQ gateway payload:", error);
      }
    });

    socket.on("error", (error) => {
      log.error("QQ gateway error:", error);
      settle(() => reject(error));
    });

    socket.on("close", (code, reason) => {
      clearTimers();
      ws = null;
      log.info(`QQ gateway closed: ${code} ${reason.toString()}`);
      if (stopped) return;
      if (code === 4004 || code === 4006 || code === 4007 || code === 4009) {
        tokenState = null;
        sessionId = null;
        seq = null;
      }
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        if (currentConfig && currentHandler) {
          connectWebSocket(currentConfig, currentHandler).catch((err) => {
            log.error("QQ reconnect failed:", err);
          });
        }
      }, delay);
    });

    setTimeout(() => {
      settle(() => reject(new Error("QQ gateway ready timeout")));
    }, 15000);
  });
}

export function getQQBot(): QQClient {
  if (!client || !currentConfig) {
    throw new Error("QQ bot is not initialized");
  }
  return client;
}

export async function initQQ(
  config: Config,
  eventHandler: (event: QQMessageEvent) => Promise<void>,
): Promise<void> {
  if (!config.qqAppId || !config.qqSecret) {
    throw new Error("QQ Bot App ID and Secret are required");
  }

  stopped = false;
  currentConfig = config;
  currentHandler = eventHandler;
  client = {
    sendPrivateMessage: async (openid, content, replyToMessageId) => {
      await apiRequest(config, "POST", `/v2/users/${openid}/messages`, buildMessageBody(content, replyToMessageId));
    },
    sendGroupMessage: async (groupOpenid, content, replyToMessageId) => {
      await apiRequest(config, "POST", `/v2/groups/${groupOpenid}/messages`, buildMessageBody(content, replyToMessageId));
    },
    sendChannelMessage: async (channelId, content, replyToMessageId) => {
      await apiRequest(config, "POST", `/channels/${channelId}/messages`, {
        content,
        ...(replyToMessageId ? { msg_id: replyToMessageId } : {}),
      });
    },
  };

  await connectWebSocket(config, eventHandler);
  log.info("QQ bot initialized");
}

export async function stopQQ(): Promise<void> {
  stopped = true;
  clearTimers();
  if (ws) {
    ws.close(1000);
    ws = null;
  }
  client = null;
  currentConfig = null;
  currentHandler = null;
  tokenState = null;
  sessionId = null;
  seq = null;
}
