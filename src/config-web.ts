import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { DWClient } from "dingtalk-stream";
import type { Config } from "./config.js";
import { WEB_CONFIG_PORT } from "./constants.js";
import { CONFIG_PATH, getClaudeConfigHome, loadClaudeSettingsEnv, saveClaudeSettingsEnv, loadConfig, loadFileConfig, saveFileConfig, type FileConfig } from "./config.js";
import { PAGE_HTML } from "./config-web-page.js";
import { getServiceStatus, startBackgroundService, stopBackgroundService } from "./service-control.js";
import { initWeWork, stopWeWork } from "./wework/client.js";
import { createLogger } from "./logger.js";

const log = createLogger("ConfigWeb");
type WebFlowMode = "init" | "start" | "dev";
type WebFlowResult = "saved" | "cancel";
const TEST_TIMEOUT_MS = 10000;

function getClaudeSettingsPath(): string {
  const home = getClaudeConfigHome();
  const baseDir = join(home, ".claude");
  return join(baseDir, "settings.json");
}

// --- Web config auth: one-time login token + in-memory session ---

interface LoginTokenInfo {
  expiresAt: number;
}

interface SessionInfo {
  expiresAt: number;
  remoteAddr?: string;
  userAgent?: string;
}

const pendingLogins = new Map<string, LoginTokenInfo>();
const activeSessions = new Map<string, SessionInfo>();

function getWebConfigHost(): string {
  const envHost = process.env.OPEN_IM_WEB_HOST?.trim();
  if (envHost) return envHost;
  return "127.0.0.1";
}

function generateRandomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function cleanupExpiredAuth(now: number): void {
  for (const [token, info] of pendingLogins) {
    if (info.expiresAt <= now) pendingLogins.delete(token);
  }
  for (const [sessionId, info] of activeSessions) {
    if (info.expiresAt <= now) activeSessions.delete(sessionId);
  }
}

function createLoginToken(ttlMs: number): string {
  const now = Date.now();
  cleanupExpiredAuth(now);
  const token = generateRandomToken(32);
  pendingLogins.set(token, { expiresAt: now + ttlMs });
  return token;
}

function createSession(request: IncomingMessage, ttlMs: number): string {
  const now = Date.now();
  cleanupExpiredAuth(now);
  const sessionId = generateRandomToken(32);
  const remoteAddr = (request.socket as { remoteAddress?: string }).remoteAddress;
  const userAgent = typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : undefined;
  activeSessions.set(sessionId, {
    expiresAt: now + ttlMs,
    remoteAddr,
    userAgent,
  });
  return sessionId;
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) return {};
  const cookies: Record<string, string> = {};
  const parts = header.split(";");
  for (const part of parts) {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey.trim();
    if (!key) continue;
    const value = rest.join("=").trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function getSessionIdFromRequest(request: IncomingMessage): string | null {
  const cookies = parseCookies(request);
  const sessionId = cookies.openim_session;
  return sessionId && typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
}

function isSessionValid(request: IncomingMessage): boolean {
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) return false;
  const info = activeSessions.get(sessionId);
  if (!info) return false;
  const now = Date.now();
  if (info.expiresAt <= now) {
    activeSessions.delete(sessionId);
    return false;
  }
  // Optional: tie session to basic client fingerprint (remote address)
  const remoteAddr = (request.socket as { remoteAddress?: string }).remoteAddress;
  if (info.remoteAddr && remoteAddr && remoteAddr !== info.remoteAddr) {
    return false;
  }
  return true;
}

function buildSessionCookie(sessionId: string, ttlMs: number): string {
  const maxAgeSec = Math.floor(ttlMs / 1000);
  const parts = [
    `openim_session=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  // 不设置 Secure，方便本地 http 使用；如果放在 https 反代后，可以在代理层加 Secure
  return parts.join("; ");
}

export interface StartedWebConfigServer {
  close: () => Promise<void>;
  url: string;
  waitForResult: Promise<WebFlowResult>;
  loginUrl?: string;
}

interface WebConfigPayload {
  platforms: {
    telegram: { enabled: boolean; aiCommand: "" | "claude" | "codex" | "codebuddy"; botToken: string; proxy: string; allowedUserIds: string };
    feishu: { enabled: boolean; aiCommand: "" | "claude" | "codex" | "codebuddy"; appId: string; appSecret: string; allowedUserIds: string };
    qq: { enabled: boolean; aiCommand: "" | "claude" | "codex" | "codebuddy"; appId: string; secret: string; allowedUserIds: string };
    wework: { enabled: boolean; aiCommand: "" | "claude" | "codex" | "codebuddy"; corpId: string; secret: string; allowedUserIds: string };
    dingtalk: { enabled: boolean; aiCommand: "" | "claude" | "codex" | "codebuddy"; clientId: string; clientSecret: string; cardTemplateId: string; allowedUserIds: string };
    workbuddy: { enabled: boolean; aiCommand: "" | "claude" | "codex" | "codebuddy"; accessToken: string; refreshToken: string; userId: string; baseUrl: string; allowedUserIds: string };
  };
  ai: {
    aiCommand: "claude" | "codex" | "codebuddy";
    claudeWorkDir: string;
    claudeConfigPath: string;
    claudeAuthToken: string;
    claudeBaseUrl: string;
    claudeModel: string;
    claudeProxy: string;
    codexCliPath: string;
    codebuddyCliPath: string;
    codexProxy: string;
    logDir?: string;
    logLevel: "default" | "DEBUG" | "INFO" | "WARN" | "ERROR";
  };
}

export function getHealthPlatformSnapshot(
  file: FileConfig,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, { configured: boolean; enabled: boolean; healthy: boolean; message?: string }> {
  const fileTelegram = file.platforms?.telegram;
  const fileFeishu = file.platforms?.feishu;
  const fileQQ = file.platforms?.qq;
  const fileWework = file.platforms?.wework;
  const fileDingtalk = file.platforms?.dingtalk;
  const fileWorkbuddy = file.platforms?.workbuddy;
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN ?? fileTelegram?.botToken ?? file.telegramBotToken;
  const feishuAppId = env.FEISHU_APP_ID ?? fileFeishu?.appId ?? file.feishuAppId;
  const feishuAppSecret = env.FEISHU_APP_SECRET ?? fileFeishu?.appSecret ?? file.feishuAppSecret;
  const qqAppId = env.QQ_BOT_APPID ?? env.QQ_APP_ID ?? fileQQ?.appId;
  const qqSecret = env.QQ_BOT_SECRET ?? env.QQ_SECRET ?? fileQQ?.secret;
  const weworkCorpId = env.WEWORK_CORP_ID ?? fileWework?.corpId;
  const weworkSecret = env.WEWORK_SECRET ?? fileWework?.secret;
  const dingtalkClientId = env.DINGTALK_CLIENT_ID ?? fileDingtalk?.clientId;
  const dingtalkClientSecret = env.DINGTALK_CLIENT_SECRET ?? fileDingtalk?.clientSecret;
  const workbuddyAccessToken = fileWorkbuddy?.accessToken;
  const workbuddyRefreshToken = fileWorkbuddy?.refreshToken;
  const workbuddyUserId = fileWorkbuddy?.userId;

  return {
    telegram: {
      configured: !!telegramBotToken,
      enabled: !!telegramBotToken && fileTelegram?.enabled !== false,
      healthy: !!telegramBotToken,
      message: telegramBotToken ? "Token configured" : "Token not configured",
    },
    feishu: {
      configured: !!(feishuAppId && feishuAppSecret),
      enabled: !!(feishuAppId && feishuAppSecret) && fileFeishu?.enabled !== false,
      healthy: !!(feishuAppId && feishuAppSecret),
      message: feishuAppId && feishuAppSecret ? "App ID and Secret configured" : "Missing credentials",
    },
    qq: {
      configured: !!(qqAppId && qqSecret),
      enabled: !!(qqAppId && qqSecret) && fileQQ?.enabled !== false,
      healthy: !!(qqAppId && qqSecret),
      message: qqAppId && qqSecret ? "App ID and Secret configured" : "Missing credentials",
    },
    wework: {
      configured: !!(weworkCorpId && weworkSecret),
      enabled: !!(weworkCorpId && weworkSecret) && fileWework?.enabled !== false,
      healthy: !!(weworkCorpId && weworkSecret),
      message: weworkCorpId && weworkSecret ? "Corp ID and Secret configured" : "Missing credentials",
    },
    dingtalk: {
      configured: !!(dingtalkClientId && dingtalkClientSecret),
      enabled: !!(dingtalkClientId && dingtalkClientSecret) && fileDingtalk?.enabled !== false,
      healthy: !!(dingtalkClientId && dingtalkClientSecret),
      message: dingtalkClientId && dingtalkClientSecret ? "Client ID and Secret configured" : "Missing credentials",
    },
    workbuddy: {
      configured: !!(workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId),
      enabled: !!(workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId) && fileWorkbuddy?.enabled !== false,
      healthy: !!(workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId),
      message: workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId ? "OAuth credentials configured" : "Missing credentials",
    },
  };
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function clean(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isMasked(value: string | undefined): boolean {
  return typeof value === "string" && value.includes("****");
}

/** 如果前端传回的是掩码值（包含 ****），保留 existing 中的真实密钥，避免覆盖 */
function resolveSecret(incoming: string | undefined, existing: string | undefined): string | undefined {
  if (isMasked(incoming)) return existing;
  return clean(incoming);
}

const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

function readJson<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        reject(new Error("Request body too large (max 1 MB)"));
        request.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve((raw ? JSON.parse(raw) : {}) as T);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function maskSecret(value: string | undefined): string {
  if (!value || value.length <= 4) return value ? "****" : "";
  return value.slice(0, 2) + "****" + value.slice(-2);
}

function buildInitialPayload(file: FileConfig): WebConfigPayload {
  // Load Claude settings from ~/.claude/settings.json
  const claudeEnv = loadClaudeSettingsEnv();

  return {
    platforms: {
      telegram: {
        enabled: file.platforms?.telegram?.enabled ?? Boolean(file.platforms?.telegram?.botToken),
        aiCommand: (file.platforms?.telegram?.aiCommand as "" | "claude" | "codex" | "codebuddy" | undefined) ?? "",
        botToken: maskSecret(file.platforms?.telegram?.botToken),
        proxy: file.platforms?.telegram?.proxy ?? "",
        allowedUserIds: (file.platforms?.telegram?.allowedUserIds ?? []).join(", "),
      },
      feishu: {
        enabled: file.platforms?.feishu?.enabled ?? Boolean(file.platforms?.feishu?.appId && file.platforms?.feishu?.appSecret),
        aiCommand: (file.platforms?.feishu?.aiCommand as "" | "claude" | "codex" | "codebuddy" | undefined) ?? "",
        appId: file.platforms?.feishu?.appId ?? "",
        appSecret: maskSecret(file.platforms?.feishu?.appSecret),
        allowedUserIds: (file.platforms?.feishu?.allowedUserIds ?? []).join(", "),
      },
      qq: {
        enabled: file.platforms?.qq?.enabled ?? Boolean(file.platforms?.qq?.appId && file.platforms?.qq?.secret),
        aiCommand: (file.platforms?.qq?.aiCommand as "" | "claude" | "codex" | "codebuddy" | undefined) ?? "",
        appId: file.platforms?.qq?.appId ?? "",
        secret: maskSecret(file.platforms?.qq?.secret),
        allowedUserIds: (file.platforms?.qq?.allowedUserIds ?? []).join(", "),
      },
      wework: {
        enabled: file.platforms?.wework?.enabled ?? Boolean(file.platforms?.wework?.corpId && file.platforms?.wework?.secret),
        aiCommand: (file.platforms?.wework?.aiCommand as "" | "claude" | "codex" | "codebuddy" | undefined) ?? "",
        corpId: file.platforms?.wework?.corpId ?? "",
        secret: maskSecret(file.platforms?.wework?.secret),
        allowedUserIds: (file.platforms?.wework?.allowedUserIds ?? []).join(", "),
      },
      dingtalk: {
        enabled: file.platforms?.dingtalk?.enabled ?? Boolean(file.platforms?.dingtalk?.clientId && file.platforms?.dingtalk?.clientSecret),
        aiCommand: (file.platforms?.dingtalk?.aiCommand as "" | "claude" | "codex" | "codebuddy" | undefined) ?? "",
        clientId: file.platforms?.dingtalk?.clientId ?? "",
        clientSecret: maskSecret(file.platforms?.dingtalk?.clientSecret),
        cardTemplateId: file.platforms?.dingtalk?.cardTemplateId ?? "",
        allowedUserIds: (file.platforms?.dingtalk?.allowedUserIds ?? []).join(", "),
      },
      workbuddy: {
        enabled: file.platforms?.workbuddy?.enabled ?? Boolean(file.platforms?.workbuddy?.accessToken && file.platforms?.workbuddy?.refreshToken && file.platforms?.workbuddy?.userId),
        aiCommand: (file.platforms?.workbuddy?.aiCommand as "" | "claude" | "codex" | "codebuddy" | undefined) ?? "",
        accessToken: maskSecret(file.platforms?.workbuddy?.accessToken),
        refreshToken: maskSecret(file.platforms?.workbuddy?.refreshToken),
        userId: file.platforms?.workbuddy?.userId ?? "",
        baseUrl: file.platforms?.workbuddy?.baseUrl ?? "",
        allowedUserIds: (file.platforms?.workbuddy?.allowedUserIds ?? []).join(", "),
      },
    },
    ai: {
      aiCommand: (file.aiCommand as "claude" | "codex" | "codebuddy") ?? "claude",
      claudeWorkDir: file.tools?.claude?.workDir ?? process.cwd(),
      claudeConfigPath: process.platform === 'win32'
        ? getClaudeConfigHome() + "\\.claude\\settings.json"
        : getClaudeConfigHome() + "/.claude/settings.json",
      claudeAuthToken: maskSecret(claudeEnv.ANTHROPIC_AUTH_TOKEN),
      claudeBaseUrl: claudeEnv.ANTHROPIC_BASE_URL ?? "",
      claudeModel: claudeEnv.ANTHROPIC_MODEL ?? "",
      claudeProxy: file.tools?.claude?.proxy ?? "",
      codexCliPath: file.tools?.codex?.cliPath ?? "codex",
      codebuddyCliPath: file.tools?.codebuddy?.cliPath ?? "codebuddy",
      codexProxy: file.tools?.codex?.proxy ?? "",
      logDir: file.logDir ?? "",
      logLevel: (file.logLevel as "DEBUG" | "INFO" | "WARN" | "ERROR") ?? "default",
    },
  };
}

function validatePayload(payload: WebConfigPayload): string[] {
  const errors: string[] = [];
  const enabledCount = Object.values(payload.platforms).filter((item) => item.enabled).length;
  if (enabledCount === 0) errors.push("At least one platform must be enabled.");
  if (payload.platforms.telegram.enabled && !clean(payload.platforms.telegram.botToken)) errors.push("Telegram bot token is required.");
  if (payload.platforms.feishu.enabled && !clean(payload.platforms.feishu.appId)) errors.push("Feishu app ID is required.");
  if (payload.platforms.feishu.enabled && !clean(payload.platforms.feishu.appSecret)) errors.push("Feishu app secret is required.");
  if (payload.platforms.qq.enabled && !clean(payload.platforms.qq.appId)) errors.push("QQ app ID is required.");
  if (payload.platforms.qq.enabled && !clean(payload.platforms.qq.secret)) errors.push("QQ app secret is required.");
  if (payload.platforms.wework.enabled && !clean(payload.platforms.wework.corpId)) errors.push("WeWork corp ID is required.");
  if (payload.platforms.wework.enabled && !clean(payload.platforms.wework.secret)) errors.push("WeWork secret is required.");
  if (payload.platforms.dingtalk.enabled && !clean(payload.platforms.dingtalk.clientId)) errors.push("DingTalk client ID is required.");
  if (payload.platforms.dingtalk.enabled && !clean(payload.platforms.dingtalk.clientSecret)) errors.push("DingTalk client secret is required.");
  if (payload.platforms.workbuddy.enabled && !clean(payload.platforms.workbuddy.accessToken)) errors.push("WorkBuddy access token is required.");
  if (payload.platforms.workbuddy.enabled && !clean(payload.platforms.workbuddy.refreshToken)) errors.push("WorkBuddy refresh token is required.");
  if (payload.platforms.workbuddy.enabled && !clean(payload.platforms.workbuddy.userId)) errors.push("WorkBuddy user ID is required.");
  if (!clean(payload.ai.claudeWorkDir)) errors.push("Default work directory is required.");
  return errors;
}

function validateConfigForPlatform(platform: string, config: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const c = config;

  switch (platform) {
    case "telegram":
      if (!c.botToken || typeof c.botToken !== "string" || !clean(c.botToken)) {
        errors.push("Telegram bot token is required and must be a non-empty string.");
      }
      if (c.proxy && typeof c.proxy !== "string") {
        errors.push("Proxy must be a string if provided.");
      }
      break;

    case "feishu":
      if (!c.appId || typeof c.appId !== "string" || !clean(c.appId)) {
        errors.push("Feishu app ID is required and must be a non-empty string.");
      }
      if (!c.appSecret || typeof c.appSecret !== "string" || !clean(c.appSecret)) {
        errors.push("Feishu app secret is required and must be a non-empty string.");
      }
      break;

    case "qq":
      if (!c.appId || typeof c.appId !== "string" || !clean(c.appId)) {
        errors.push("QQ app ID is required and must be a non-empty string.");
      }
      if (!c.secret || typeof c.secret !== "string" || !clean(c.secret)) {
        errors.push("QQ app secret is required and must be a non-empty string.");
      }
      break;

    case "wework":
      if (!c.corpId || typeof c.corpId !== "string" || !clean(c.corpId)) {
        errors.push("WeWork corp ID is required and must be a non-empty string.");
      }
      if (!c.secret || typeof c.secret !== "string" || !clean(c.secret)) {
        errors.push("WeWork secret is required and must be a non-empty string.");
      }
      break;

    case "dingtalk":
      if (!c.clientId || typeof c.clientId !== "string" || !clean(c.clientId)) {
        errors.push("DingTalk client ID is required and must be a non-empty string.");
      }
      if (!c.clientSecret || typeof c.clientSecret !== "string" || !clean(c.clientSecret)) {
        errors.push("DingTalk client secret is required and must be a non-empty string.");
      }
      break;

    case "workbuddy":
      if (!c.accessToken || typeof c.accessToken !== "string" || !clean(c.accessToken)) {
        errors.push("WorkBuddy access token is required and must be a non-empty string.");
      }
      if (!c.refreshToken || typeof c.refreshToken !== "string" || !clean(c.refreshToken)) {
        errors.push("WorkBuddy refresh token is required and must be a non-empty string.");
      }
      if (!c.userId || typeof c.userId !== "string" || !clean(c.userId)) {
        errors.push("WorkBuddy user ID is required and must be a non-empty string.");
      }
      break;

    default:
      errors.push(`Unknown platform: ${platform}`);
  }

  return errors;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Unexpected non-JSON response: ${text.slice(0, 200)}`);
  }
}

function createProbeConfig(values: Partial<Config>): Config {
  return {
    enabledPlatforms: [],
    allowedUserIds: [],
    telegramAllowedUserIds: [],
    feishuAllowedUserIds: [],
    qqAllowedUserIds: [],
    weworkAllowedUserIds: [],
    dingtalkAllowedUserIds: [],
    workbuddyAllowedUserIds: [],
    aiCommand: "claude",
    codexCliPath: "codex",
    claudeWorkDir: process.cwd(),
    logDir: "",
    logLevel: "INFO",
    codebuddyCliPath: "codebuddy",
    platforms: {},
    ...values,
  };
}

async function probeTelegram(config: Record<string, unknown>): Promise<string> {
  const botToken = clean(String(config.botToken ?? ""));
  if (!botToken) throw new Error("Telegram bot token is required.");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  });
  const body = await readJsonResponse(response);
  if (!response.ok || body.ok !== true) {
    throw new Error(String(body.description ?? body.error_code ?? `HTTP ${response.status}`));
  }

  const result = (body.result ?? {}) as Record<string, unknown>;
  const username = typeof result.username === "string" ? `@${result.username}` : "bot";
  return `Telegram reachable as ${username}.`;
}

async function probeFeishu(config: Record<string, unknown>): Promise<string> {
  const appId = clean(String(config.appId ?? ""));
  const appSecret = clean(String(config.appSecret ?? ""));
  if (!appId || !appSecret) throw new Error("Feishu app ID and app secret are required.");

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  });
  const body = await readJsonResponse(response);
  if (!response.ok || body.code !== 0) {
    throw new Error(String(body.msg ?? body.message ?? `HTTP ${response.status}`));
  }

  return "Feishu credentials are valid.";
}

async function probeQQ(config: Record<string, unknown>): Promise<string> {
  const appId = clean(String(config.appId ?? ""));
  const secret = clean(String(config.secret ?? ""));
  if (!appId || !secret) throw new Error("QQ app ID and app secret are required.");

  const response = await fetch("https://bots.qq.com/app/getAppAccessToken", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appId, clientSecret: secret }),
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  });
  const body = await readJsonResponse(response);
  if (!response.ok || typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new Error(String(body.message ?? `HTTP ${response.status}`));
  }

  return "QQ credentials are valid.";
}

async function probeWeWork(config: Record<string, unknown>): Promise<string> {
  const corpId = clean(String(config.corpId ?? ""));
  const secret = clean(String(config.secret ?? ""));
  if (!corpId || !secret) throw new Error("WeWork corp ID and secret are required.");

  try {
    await initWeWork(
      createProbeConfig({ weworkCorpId: corpId, weworkSecret: secret }),
      async () => {},
    );
    return "WeWork WebSocket authentication succeeded.";
  } finally {
    stopWeWork();
  }
}

async function probeDingTalk(config: Record<string, unknown>): Promise<string> {
  const clientId = clean(String(config.clientId ?? ""));
  const clientSecret = clean(String(config.clientSecret ?? ""));
  if (!clientId || !clientSecret) throw new Error("DingTalk client ID and client secret are required.");

  const client = new DWClient({
    clientId,
    clientSecret,
    keepAlive: false,
    debug: false,
  });

  const token = await Promise.race([
    client.getAccessToken(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("DingTalk access token request timed out.")), TEST_TIMEOUT_MS),
    ),
  ]);

  if (typeof token !== "string" || token.length === 0) {
    throw new Error("DingTalk did not return an access token.");
  }

  return "DingTalk credentials are valid.";
}

async function probeWorkBuddy(config: Record<string, unknown>): Promise<string> {
  const accessToken = clean(String(config.accessToken ?? ""));
  const refreshToken = clean(String(config.refreshToken ?? ""));
  const userId = clean(String(config.userId ?? ""));
  if (!accessToken || !refreshToken || !userId) throw new Error("WorkBuddy access token, refresh token, and user ID are required.");

  const baseUrl = clean(String(config.baseUrl ?? "")) || "https://copilot.tencent.com";

  // Validate credentials by attempting to register workspace (same endpoint as runtime)
  const response = await fetch(`${baseUrl}/v2/agentos/localagent/registerWorkspace`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      userId,
      hostId: "open-im-test",
      workspaceId: "open-im-test-workspace",
      workspaceName: "OpenIM Test Workspace",
      localAgentType: "ide",
    }),
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WorkBuddy authentication failed: ${body.slice(0, 200) || `HTTP ${response.status}`}`);
  }

  return "WorkBuddy credentials are valid.";
}

export async function testPlatformConfig(platform: string, config: Record<string, unknown>): Promise<string> {
  const errors = validateConfigForPlatform(platform, config);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  switch (platform) {
    case "telegram":
      return probeTelegram(config);
    case "feishu":
      return probeFeishu(config);
    case "qq":
      return probeQQ(config);
    case "wework":
      return probeWeWork(config);
    case "dingtalk":
      return probeDingTalk(config);
    case "workbuddy":
      return probeWorkBuddy(config);
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

function toFileConfig(payload: WebConfigPayload, existing: FileConfig): FileConfig {
  // Save Claude environment variables to ~/.claude/settings.json
  const claudeEnv: Record<string, string> = {};
  const existingClaudeEnv = loadClaudeSettingsEnv();
  const resolvedAuthToken = resolveSecret(payload.ai.claudeAuthToken, existingClaudeEnv.ANTHROPIC_AUTH_TOKEN);
  if (resolvedAuthToken) claudeEnv.ANTHROPIC_AUTH_TOKEN = resolvedAuthToken;
  if (payload.ai.claudeBaseUrl) claudeEnv.ANTHROPIC_BASE_URL = payload.ai.claudeBaseUrl;
  if (payload.ai.claudeModel) claudeEnv.ANTHROPIC_MODEL = payload.ai.claudeModel;
  if (Object.keys(claudeEnv).length > 0) {
    saveClaudeSettingsEnv(claudeEnv);
  }
  // claudeConfigPath is informational only, not saved

  return {
    ...existing,
    aiCommand: payload.ai.aiCommand,
    logDir: payload.ai.logDir === undefined ? existing.logDir : clean(payload.ai.logDir),
    logLevel: payload.ai.logLevel === "default" ? undefined : payload.ai.logLevel,
    tools: {
      claude: {
        ...existing.tools?.claude,
        workDir: clean(payload.ai.claudeWorkDir) ?? process.cwd(),
        proxy: clean(payload.ai.claudeProxy),
        // model is now saved to ~/.claude/settings.json as env var
      },
      codex: {
        ...existing.tools?.codex,
        cliPath: clean(payload.ai.codexCliPath) ?? "codex",
        workDir: clean(payload.ai.claudeWorkDir) ?? process.cwd(),
        proxy: clean(payload.ai.codexProxy),
      },
      codebuddy: {
        ...existing.tools?.codebuddy,
        cliPath: clean(payload.ai.codebuddyCliPath) ?? "codebuddy",
      },
    },
    platforms: {
      ...existing.platforms,
      telegram: {
        ...existing.platforms?.telegram,
        enabled: payload.platforms.telegram.enabled,
        aiCommand: clean(payload.platforms.telegram.aiCommand) as "claude" | "codex" | "codebuddy" | undefined,
        botToken: resolveSecret(payload.platforms.telegram.botToken, existing.platforms?.telegram?.botToken),
        proxy: clean(payload.platforms.telegram.proxy),
        allowedUserIds: splitCsv(payload.platforms.telegram.allowedUserIds),
      },
      feishu: {
        ...existing.platforms?.feishu,
        enabled: payload.platforms.feishu.enabled,
        aiCommand: clean(payload.platforms.feishu.aiCommand) as "claude" | "codex" | "codebuddy" | undefined,
        appId: clean(payload.platforms.feishu.appId),
        appSecret: resolveSecret(payload.platforms.feishu.appSecret, existing.platforms?.feishu?.appSecret),
        allowedUserIds: splitCsv(payload.platforms.feishu.allowedUserIds),
      },
      qq: {
        ...existing.platforms?.qq,
        enabled: payload.platforms.qq.enabled,
        aiCommand: clean(payload.platforms.qq.aiCommand) as "claude" | "codex" | "codebuddy" | undefined,
        appId: clean(payload.platforms.qq.appId),
        secret: resolveSecret(payload.platforms.qq.secret, existing.platforms?.qq?.secret),
        allowedUserIds: splitCsv(payload.platforms.qq.allowedUserIds),
      },
      wework: {
        ...existing.platforms?.wework,
        enabled: payload.platforms.wework.enabled,
        aiCommand: clean(payload.platforms.wework.aiCommand) as "claude" | "codex" | "codebuddy" | undefined,
        corpId: clean(payload.platforms.wework.corpId),
        secret: resolveSecret(payload.platforms.wework.secret, existing.platforms?.wework?.secret),
        allowedUserIds: splitCsv(payload.platforms.wework.allowedUserIds),
      },
      dingtalk: {
        ...existing.platforms?.dingtalk,
        enabled: payload.platforms.dingtalk.enabled,
        aiCommand: clean(payload.platforms.dingtalk.aiCommand) as "claude" | "codex" | "codebuddy" | undefined,
        clientId: clean(payload.platforms.dingtalk.clientId),
        clientSecret: resolveSecret(payload.platforms.dingtalk.clientSecret, existing.platforms?.dingtalk?.clientSecret),
        cardTemplateId: clean(payload.platforms.dingtalk.cardTemplateId),
        allowedUserIds: splitCsv(payload.platforms.dingtalk.allowedUserIds),
      },
      workbuddy: {
        ...existing.platforms?.workbuddy,
        enabled: payload.platforms.workbuddy.enabled,
        aiCommand: clean(payload.platforms.workbuddy.aiCommand) as "claude" | "codex" | "codebuddy" | undefined,
        accessToken: resolveSecret(payload.platforms.workbuddy.accessToken, existing.platforms?.workbuddy?.accessToken),
        refreshToken: resolveSecret(payload.platforms.workbuddy.refreshToken, existing.platforms?.workbuddy?.refreshToken),
        userId: clean(payload.platforms.workbuddy.userId),
        baseUrl: clean(payload.platforms.workbuddy.baseUrl),
        allowedUserIds: splitCsv(payload.platforms.workbuddy.allowedUserIds),
      },
    },
  };
}

function openBrowser(url: string): void {
  // 显式关闭自动打开浏览器（服务器环境推荐设置）
  if (process.env.OPEN_IM_NO_BROWSER === "1") {
    return;
  }

  // 在无 TTY 且无图形环境（常见于服务器）时直接跳过，避免无意义的 xdg-open 调用
  if (!process.stdout.isTTY && !process.env.DISPLAY) {
    log.info(`Skipping browser launch for URL ${url} (no TTY/DISPLAY detected).`);
    return;
  }

  const safeSpawn = (command: string, args: string[]): void => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: process.platform === "win32" });
      // 防止 ENOENT 之类的错误变成未捕获异常
      child.on("error", (error: NodeJS.ErrnoException) => {
        log.warn(`Failed to launch browser command "${command}": ${error.code ?? error.message}`);
      });
      child.unref();
    } catch (error) {
      log.warn(`Failed to spawn browser command "${command}": ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (process.platform === "win32") {
    safeSpawn("cmd", ["/c", "start", "", url]);
    return;
  }
  if (process.platform === "darwin") {
    safeSpawn("open", [url]);
    return;
  }
  // linux / 其他 UNIX 平台：优先尝试 xdg-open，失败时仅记录日志，不抛出
  safeSpawn("xdg-open", [url]);
}

export function getWebConfigPort(): number {
  const fromEnv = process.env.OPEN_IM_WEB_PORT ? parseInt(process.env.OPEN_IM_WEB_PORT, 10) : NaN;
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : WEB_CONFIG_PORT;
}

export function getWebConfigUrl(): string {
  return `http://127.0.0.1:${getWebConfigPort()}`;
}

export function openWebConfigUrl(): void {
  openBrowser(getWebConfigUrl());
}


export async function startWebConfigServer(options: { mode: WebFlowMode; cwd: string; persistent?: boolean }): Promise<StartedWebConfigServer> {
  let timer: NodeJS.Timeout | null = null;
  let settled = false;
  let settle!: (value: WebFlowResult) => void;
  const waitForResult = new Promise<WebFlowResult>((resolve) => {
    settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });

  const host = getWebConfigHost();
  const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const finishFlow = (result: WebFlowResult) => {
        if (timer) clearTimeout(timer);
        server.close();
        settle(result);
      };

      // Auth gating:
      // - 当仅绑定 127.0.0.1 时，保持完全本地免登录（向后兼容）
      // - 当绑定到 0.0.0.0 或其他地址时，启用一次性登录 + Session Cookie 机制
      const isLocalOnly = host === "127.0.0.1";
      const hasLoginTokenFeature = !isLocalOnly;

      if (hasLoginTokenFeature) {
        const loginToken = requestUrl.searchParams.get("login_token");
        if (loginToken) {
          const info = pendingLogins.get(loginToken);
          const now = Date.now();
          if (info && info.expiresAt > now) {
            // 有效的一次性登录 token：创建会话，设置 Cookie，并重定向到去掉 login_token 的 URL
            pendingLogins.delete(loginToken);
            const sessionTtlMs = 24 * 60 * 60 * 1000; // 24 小时
            const sessionId = createSession(request, sessionTtlMs);
            const cookie = buildSessionCookie(sessionId, sessionTtlMs);

            requestUrl.searchParams.delete("login_token");
            const redirectPath = requestUrl.pathname + (requestUrl.search ? requestUrl.search : "");

            response.writeHead(302, {
              Location: redirectPath || "/",
              "Set-Cookie": cookie,
            });
            response.end();
            return;
          }

          // 无效或过期的一次性 token
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Invalid or expired login link. Please generate a new one from the server.");
          return;
        }

        // 其他请求：必须已有有效 session
        if (!isSessionValid(request)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized. Please open the latest login URL from the server output.");
          return;
        }
      }

      if (request.method === "GET" && requestUrl.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(PAGE_HTML);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/config") {
        json(response, 200, {
          payload: buildInitialPayload(loadFileConfig()),
          meta: { configPath: CONFIG_PATH, mode: options.mode },
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/config/file") {
        try {
          let contents = "{}";
          if (existsSync(CONFIG_PATH)) {
            contents = readFileSync(CONFIG_PATH, "utf-8");
          }
          json(response, 200, { path: CONFIG_PATH, contents });
        } catch (error) {
          json(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/config/file") {
        try {
          const body = await readJson<{ contents?: string }>(request);
          const raw = body.contents ?? "";
          if (!raw.trim()) {
            json(response, 400, { error: "contents is required" });
            return;
          }
          try {
            JSON.parse(raw);
          } catch {
            json(response, 400, { error: "Invalid JSON" });
            return;
          }
          const dir = dirname(CONFIG_PATH);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(CONFIG_PATH, raw, "utf-8");
          loadConfig();
          json(response, 200, { message: "Config file saved.", path: CONFIG_PATH });
        } catch (error) {
          json(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/config/validate") {
        try {
          const body = await readJson<WebConfigPayload>(request);
          const errors = validatePayload(body);
          if (errors.length > 0) {
            json(response, 400, { error: errors.join(" ") });
            return;
          }
          json(response, 200, { message: "Configuration looks internally consistent." });
        } catch (error) {
          json(response, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/config/save") {
        try {
          const body = await readJson<WebConfigPayload>(request);
          const errors = validatePayload(body);
          if (errors.length > 0) {
            json(response, 400, { error: errors.join(" ") });
            return;
          }
          saveFileConfig(toFileConfig(body, loadFileConfig()));
          loadConfig();
          json(response, 200, { message: "Configuration saved." });
          if (!options.persistent && requestUrl.searchParams.get("final") === "1") {
            setTimeout(() => finishFlow("saved"), 120);
          }
        } catch (error) {
          json(response, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/service/status") {
        json(response, 200, getServiceStatus());
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/claude/settings") {
        try {
          const settingsPath = getClaudeSettingsPath();
          let contents = "{}";
          if (existsSync(settingsPath)) {
            contents = readFileSync(settingsPath, "utf-8");
          } else {
            // Try to synthesize from env if file doesn't exist yet
            const env = loadClaudeSettingsEnv();
            if (Object.keys(env).length > 0) {
              contents = JSON.stringify({ env }, null, 2);
            }
          }
          json(response, 200, { path: settingsPath, contents });
        } catch (error) {
          json(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/claude/settings") {
        try {
          const body = await readJson<{ contents?: string }>(request);
          const raw = body.contents ?? "";
          if (!raw.trim()) {
            json(response, 400, { error: "contents is required" });
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch (err) {
            json(response, 400, { error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` });
            return;
          }
          const pretty = JSON.stringify(parsed, null, 2);
          const settingsPath = getClaudeSettingsPath();
          const dir = dirname(settingsPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(settingsPath, pretty, "utf-8");
          json(response, 200, { message: "Claude settings.json saved.", path: settingsPath });
        } catch (error) {
          json(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        const file = loadFileConfig();
        const fileTelegram = file.platforms?.telegram;
        const fileFeishu = file.platforms?.feishu;
        const fileQQ = file.platforms?.qq;
        const fileWework = file.platforms?.wework;
        const fileDingtalk = file.platforms?.dingtalk;
        const fileWorkbuddy = file.platforms?.workbuddy;
        const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? fileTelegram?.botToken ?? file.telegramBotToken;
        const feishuAppId = process.env.FEISHU_APP_ID ?? fileFeishu?.appId ?? file.feishuAppId;
        const feishuAppSecret = process.env.FEISHU_APP_SECRET ?? fileFeishu?.appSecret ?? file.feishuAppSecret;
        const qqAppId = process.env.QQ_BOT_APPID ?? process.env.QQ_APP_ID ?? fileQQ?.appId;
        const qqSecret = process.env.QQ_BOT_SECRET ?? process.env.QQ_SECRET ?? fileQQ?.secret;
        const weworkCorpId = process.env.WEWORK_CORP_ID ?? fileWework?.corpId;
        const weworkSecret = process.env.WEWORK_SECRET ?? fileWework?.secret;
        const dingtalkClientId = process.env.DINGTALK_CLIENT_ID ?? fileDingtalk?.clientId;
        const dingtalkClientSecret = process.env.DINGTALK_CLIENT_SECRET ?? fileDingtalk?.clientSecret;
        const workbuddyAccessToken = fileWorkbuddy?.accessToken;
        const workbuddyRefreshToken = fileWorkbuddy?.refreshToken;
        const workbuddyUserId = fileWorkbuddy?.userId;
        const platforms: Record<string, { configured: boolean; enabled: boolean; healthy: boolean; message?: string }> = {};

        // 检查 Telegram
        platforms.telegram = {
          configured: !!telegramBotToken,
          enabled: !!telegramBotToken && fileTelegram?.enabled !== false,
          healthy: !!telegramBotToken,
          message: telegramBotToken ? "Token configured" : "Token not configured"
        };

        // 检查 Feishu
        platforms.feishu = {
          configured: !!(feishuAppId && feishuAppSecret),
          enabled: !!(feishuAppId && feishuAppSecret) && fileFeishu?.enabled !== false,
          healthy: !!(feishuAppId && feishuAppSecret),
          message: (feishuAppId && feishuAppSecret) ? "App ID and Secret configured" : "Missing credentials"
        };

        // 检查 QQ
        platforms.qq = {
          configured: !!(qqAppId && qqSecret),
          enabled: !!(qqAppId && qqSecret) && fileQQ?.enabled !== false,
          healthy: !!(qqAppId && qqSecret),
          message: (qqAppId && qqSecret) ? "App ID and Secret configured" : "Missing credentials"
        };

        // 检查 WeWork
        platforms.wework = {
          configured: !!(weworkCorpId && weworkSecret),
          enabled: !!(weworkCorpId && weworkSecret) && fileWework?.enabled !== false,
          healthy: !!(weworkCorpId && weworkSecret),
          message: (weworkCorpId && weworkSecret) ? "Corp ID and Secret configured" : "Missing credentials"
        };

        // 检查 DingTalk
        platforms.dingtalk = {
          configured: !!(dingtalkClientId && dingtalkClientSecret),
          enabled: !!(dingtalkClientId && dingtalkClientSecret) && fileDingtalk?.enabled !== false,
          healthy: !!(dingtalkClientId && dingtalkClientSecret),
          message: (dingtalkClientId && dingtalkClientSecret) ? "Client ID and Secret configured" : "Missing credentials"
        };

        // 检查 WorkBuddy
        platforms.workbuddy = {
          configured: !!(workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId),
          enabled: !!(workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId) && fileWorkbuddy?.enabled !== false,
          healthy: !!(workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId),
          message: (workbuddyAccessToken && workbuddyRefreshToken && workbuddyUserId) ? "OAuth credentials configured" : "Missing credentials"
        };

        json(response, 200, { platforms, serviceStatus: getServiceStatus() });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/service/start") {
        try {
          const config = loadConfig();
          const workDir = config.claudeWorkDir ?? options.cwd;
          const started = startBackgroundService(workDir);
          json(response, 200, { message: `Bridge started with pid ${started.pid}.`, pid: started.pid });
          if (!options.persistent) {
            setTimeout(() => finishFlow("saved"), 120);
          }
        } catch (error) {
          json(response, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/service/stop") {
        try {
          const result = await stopBackgroundService();
          json(response, 200, { message: result.pid ? `Bridge stopped (pid ${result.pid}).` : "Bridge was already stopped." });
        } catch (error) {
          json(response, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/config/test") {
        try {
          const body = await readJson<{ platform: string; config: Record<string, unknown> }>(request);
          const { platform, config } = body;
          const message = await testPlatformConfig(platform, config);
          json(response, 200, { message, success: true });
        } catch (error) {
          json(response, 400, { error: toErrorMessage(error), success: false });
        }
        return;
      }

      json(response, 404, { error: "Not found." });
  });

  const port = getWebConfigPort();
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Web config port ${port} is already in use. Close the existing listener or change OPEN_IM_WEB_PORT.`));
        return;
      }
      reject(error);
    });
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    settle("cancel");
    return {
      close: async () => {},
      url: "",
      waitForResult,
    };
  }

  if (!options.persistent && options.mode !== "dev") {
    timer = setTimeout(() => {
      server.close();
      settle("cancel");
    }, 15 * 60 * 1000);
  }

  server.on("close", () => {
    if (timer) clearTimeout(timer);
  });

  let loginUrlForReturn: string | undefined;

  // 当绑定到非 127.0.0.1（例如 0.0.0.0）时，为远程访问生成一次性登录链接
  if (host !== "127.0.0.1") {
    const loginTtlMs = 15 * 60 * 1000; // 15 分钟内有效
    const loginToken = createLoginToken(loginTtlMs);
    const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    const baseUrl = `http://${displayHost}:${port}`;
    const loginUrl = `${baseUrl}/?login_token=${encodeURIComponent(loginToken)}`;
    loginUrlForReturn = loginUrl;

    log.info("━━━━━━━━ Web Config Login ━━━━━━━━");
    log.info(`Host binding : ${host}`);
    log.info(`Login URL    : ${loginUrl}`);
    if (host === "0.0.0.0") {
      log.info("Note: replace 127.0.0.1 with your server IP or hostname when opening from another device.");
    }
    log.info(`This login link is valid for approximately ${Math.floor(loginTtlMs / 60000)} minutes and can be used only once.`);
    log.info("After login, subsequent requests will use a short-lived session cookie.");
  }

  return {
    close: async () => {
      if (timer) clearTimeout(timer);
      server.close();
      settle("cancel");
    },
    url: `http://127.0.0.1:${port}`,
    loginUrl: loginUrlForReturn,
    waitForResult,
  };
}

export async function runWebConfigFlow(options: { mode: WebFlowMode; cwd: string }): Promise<WebFlowResult> {
  const started = await startWebConfigServer(options);
  const targetUrl = started.loginUrl ?? started.url;
  openBrowser(targetUrl);
  log.info(`Opened local configuration page: ${targetUrl}`);
  log.info(process.env.OPEN_IM_NO_BROWSER === "1" ? "Browser launch disabled. Open the URL manually." : "Save the configuration in your browser to continue.");
  return started.waitForResult;
}
