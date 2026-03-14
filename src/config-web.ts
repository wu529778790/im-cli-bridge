import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { DWClient } from "dingtalk-stream";
import type { Config } from "./config.js";
import { WEB_CONFIG_PORT } from "./constants.js";
import { CONFIG_PATH, loadConfig, loadFileConfig, saveFileConfig, type FileConfig } from "./config.js";
import { PAGE_HTML } from "./config-web-page.js";
import { getServiceStatus, startBackgroundService, stopBackgroundService } from "./service-control.js";
import { initWeWork, stopWeWork } from "./wework/client.js";

type WebFlowMode = "init" | "start" | "dev";
type WebFlowResult = "saved" | "cancel";
const TEST_TIMEOUT_MS = 10000;

export interface StartedWebConfigServer {
  close: () => Promise<void>;
  url: string;
  waitForResult: Promise<WebFlowResult>;
}

interface WebConfigPayload {
  platforms: {
    telegram: { enabled: boolean; aiCommand: "" | "claude" | "codex" | "cursor" | "codebuddy"; botToken: string; proxy: string; allowedUserIds: string };
    feishu: { enabled: boolean; aiCommand: "" | "claude" | "codex" | "cursor" | "codebuddy"; appId: string; appSecret: string; allowedUserIds: string };
    qq: { enabled: boolean; aiCommand: "" | "claude" | "codex" | "cursor" | "codebuddy"; appId: string; secret: string; allowedUserIds: string };
    wework: { enabled: boolean; aiCommand: "" | "claude" | "codex" | "cursor" | "codebuddy"; corpId: string; secret: string; allowedUserIds: string };
    dingtalk: { enabled: boolean; aiCommand: "" | "claude" | "codex" | "cursor" | "codebuddy"; clientId: string; clientSecret: string; cardTemplateId: string; allowedUserIds: string };
  };
  ai: {
    aiCommand: "claude" | "codex" | "cursor" | "codebuddy";
    claudeCliPath: string;
    claudeWorkDir: string;
    claudeSkipPermissions: boolean;
    claudeTimeoutMs: number;
    codexTimeoutMs: number;
    codebuddyTimeoutMs: number;
    claudeModel: string;
    cursorCliPath: string;
    codexCliPath: string;
    codebuddyCliPath: string;
    codexProxy: string;
    defaultPermissionMode?: "ask" | "accept-edits" | "plan" | "yolo";
    hookPort: number;
    logDir?: string;
    logLevel: "default" | "DEBUG" | "INFO" | "WARN" | "ERROR";
    useSdkMode: boolean;
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
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN ?? fileTelegram?.botToken ?? file.telegramBotToken;
  const feishuAppId = env.FEISHU_APP_ID ?? fileFeishu?.appId ?? file.feishuAppId;
  const feishuAppSecret = env.FEISHU_APP_SECRET ?? fileFeishu?.appSecret ?? file.feishuAppSecret;
  const qqAppId = env.QQ_BOT_APPID ?? env.QQ_APP_ID ?? fileQQ?.appId;
  const qqSecret = env.QQ_BOT_SECRET ?? env.QQ_SECRET ?? fileQQ?.secret;
  const weworkCorpId = env.WEWORK_CORP_ID ?? fileWework?.corpId;
  const weworkSecret = env.WEWORK_SECRET ?? fileWework?.secret;
  const dingtalkClientId = env.DINGTALK_CLIENT_ID ?? fileDingtalk?.clientId;
  const dingtalkClientSecret = env.DINGTALK_CLIENT_SECRET ?? fileDingtalk?.clientSecret;

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

function readJson<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
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

function buildInitialPayload(file: FileConfig): WebConfigPayload {
  return {
    platforms: {
      telegram: {
        enabled: file.platforms?.telegram?.enabled ?? Boolean(file.platforms?.telegram?.botToken),
        aiCommand: (file.platforms?.telegram?.aiCommand as "" | "claude" | "codex" | "cursor" | "codebuddy" | undefined) ?? "",
        botToken: file.platforms?.telegram?.botToken ?? "",
        proxy: file.platforms?.telegram?.proxy ?? "",
        allowedUserIds: (file.platforms?.telegram?.allowedUserIds ?? []).join(", "),
      },
      feishu: {
        enabled: file.platforms?.feishu?.enabled ?? Boolean(file.platforms?.feishu?.appId && file.platforms?.feishu?.appSecret),
        aiCommand: (file.platforms?.feishu?.aiCommand as "" | "claude" | "codex" | "cursor" | "codebuddy" | undefined) ?? "",
        appId: file.platforms?.feishu?.appId ?? "",
        appSecret: file.platforms?.feishu?.appSecret ?? "",
        allowedUserIds: (file.platforms?.feishu?.allowedUserIds ?? []).join(", "),
      },
      qq: {
        enabled: file.platforms?.qq?.enabled ?? Boolean(file.platforms?.qq?.appId && file.platforms?.qq?.secret),
        aiCommand: (file.platforms?.qq?.aiCommand as "" | "claude" | "codex" | "cursor" | "codebuddy" | undefined) ?? "",
        appId: file.platforms?.qq?.appId ?? "",
        secret: file.platforms?.qq?.secret ?? "",
        allowedUserIds: (file.platforms?.qq?.allowedUserIds ?? []).join(", "),
      },
      wework: {
        enabled: file.platforms?.wework?.enabled ?? Boolean(file.platforms?.wework?.corpId && file.platforms?.wework?.secret),
        aiCommand: (file.platforms?.wework?.aiCommand as "" | "claude" | "codex" | "cursor" | "codebuddy" | undefined) ?? "",
        corpId: file.platforms?.wework?.corpId ?? "",
        secret: file.platforms?.wework?.secret ?? "",
        allowedUserIds: (file.platforms?.wework?.allowedUserIds ?? []).join(", "),
      },
      dingtalk: {
        enabled: file.platforms?.dingtalk?.enabled ?? Boolean(file.platforms?.dingtalk?.clientId && file.platforms?.dingtalk?.clientSecret),
        aiCommand: (file.platforms?.dingtalk?.aiCommand as "" | "claude" | "codex" | "cursor" | "codebuddy" | undefined) ?? "",
        clientId: file.platforms?.dingtalk?.clientId ?? "",
        clientSecret: file.platforms?.dingtalk?.clientSecret ?? "",
        cardTemplateId: file.platforms?.dingtalk?.cardTemplateId ?? "",
        allowedUserIds: (file.platforms?.dingtalk?.allowedUserIds ?? []).join(", "),
      },
    },
    ai: {
      aiCommand: (file.aiCommand as "claude" | "codex" | "cursor" | "codebuddy") ?? "claude",
      claudeCliPath: file.tools?.claude?.cliPath ?? "claude",
      claudeWorkDir: file.tools?.claude?.workDir ?? process.cwd(),
      claudeSkipPermissions: file.tools?.claude?.skipPermissions ?? true,
      claudeTimeoutMs: file.tools?.claude?.timeoutMs ?? 600000,
      codexTimeoutMs: file.tools?.codex?.timeoutMs ?? 600000,
      codebuddyTimeoutMs: file.tools?.codebuddy?.timeoutMs ?? 600000,
      claudeModel: file.tools?.claude?.model ?? "",
      cursorCliPath: file.tools?.cursor?.cliPath ?? "agent",
      codexCliPath: file.tools?.codex?.cliPath ?? "codex",
      codebuddyCliPath: file.tools?.codebuddy?.cliPath ?? "codebuddy",
      codexProxy: file.tools?.codex?.proxy ?? "",
    defaultPermissionMode: file.defaultPermissionMode ?? "ask",
      hookPort: file.hookPort ?? 35801,
      logDir: file.logDir ?? "",
      logLevel: (file.logLevel as "DEBUG" | "INFO" | "WARN" | "ERROR") ?? "default",
      useSdkMode: file.useSdkMode ?? true,
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
  if (!clean(payload.ai.claudeWorkDir)) errors.push("Default work directory is required.");
  if (!Number.isFinite(payload.ai.claudeTimeoutMs) || payload.ai.claudeTimeoutMs <= 0) errors.push("Claude timeout must be positive.");
  if (!Number.isFinite(payload.ai.codexTimeoutMs) || payload.ai.codexTimeoutMs <= 0) errors.push("Codex timeout must be positive.");
  if (!Number.isFinite(payload.ai.codebuddyTimeoutMs) || payload.ai.codebuddyTimeoutMs <= 0) errors.push("CodeBuddy timeout must be positive.");
  if (!Number.isFinite(payload.ai.hookPort) || payload.ai.hookPort <= 0) errors.push("Hook port must be positive.");
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
    wechatAllowedUserIds: [],
    weworkAllowedUserIds: [],
    dingtalkAllowedUserIds: [],
    aiCommand: "claude",
    claudeCliPath: "claude",
    cursorCliPath: "agent",
    codexCliPath: "codex",
    claudeWorkDir: process.cwd(),
    claudeSkipPermissions: true,
    defaultPermissionMode: "ask",
    claudeTimeoutMs: 600000,
    codexTimeoutMs: 600000,
    codebuddyTimeoutMs: 600000,
    hookPort: 35801,
    logDir: "",
    logLevel: "INFO",
    useSdkMode: true,
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
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

function toFileConfig(payload: WebConfigPayload, existing: FileConfig): FileConfig {
  return {
    ...existing,
    aiCommand: payload.ai.aiCommand,
    defaultPermissionMode: payload.ai.defaultPermissionMode ?? existing.defaultPermissionMode ?? "ask",
    hookPort: payload.ai.hookPort,
    logDir: payload.ai.logDir === undefined ? existing.logDir : clean(payload.ai.logDir),
    logLevel: payload.ai.logLevel === "default" ? undefined : payload.ai.logLevel,
    useSdkMode: payload.ai.useSdkMode,
    tools: {
      claude: {
        ...existing.tools?.claude,
        cliPath: clean(payload.ai.claudeCliPath) ?? "claude",
        workDir: clean(payload.ai.claudeWorkDir) ?? process.cwd(),
        skipPermissions: payload.ai.claudeSkipPermissions,
        timeoutMs: payload.ai.claudeTimeoutMs,
        model: clean(payload.ai.claudeModel),
      },
      cursor: {
        ...existing.tools?.cursor,
        cliPath: clean(payload.ai.cursorCliPath) ?? "agent",
        skipPermissions: existing.tools?.cursor?.skipPermissions ?? payload.ai.claudeSkipPermissions,
      },
      codex: {
        ...existing.tools?.codex,
        cliPath: clean(payload.ai.codexCliPath) ?? "codex",
        workDir: clean(payload.ai.claudeWorkDir) ?? process.cwd(),
        skipPermissions: existing.tools?.codex?.skipPermissions ?? payload.ai.claudeSkipPermissions,
        timeoutMs: payload.ai.codexTimeoutMs,
        proxy: clean(payload.ai.codexProxy),
      },
      codebuddy: {
        ...existing.tools?.codebuddy,
        cliPath: clean(payload.ai.codebuddyCliPath) ?? "codebuddy",
        skipPermissions: existing.tools?.codebuddy?.skipPermissions ?? payload.ai.claudeSkipPermissions,
        timeoutMs: payload.ai.codebuddyTimeoutMs,
      },
    },
    platforms: {
      ...existing.platforms,
      telegram: {
        ...existing.platforms?.telegram,
        enabled: payload.platforms.telegram.enabled,
        aiCommand: clean(payload.platforms.telegram.aiCommand) as "claude" | "codex" | "cursor" | "codebuddy" | undefined,
        botToken: clean(payload.platforms.telegram.botToken),
        proxy: clean(payload.platforms.telegram.proxy),
        allowedUserIds: splitCsv(payload.platforms.telegram.allowedUserIds),
      },
      feishu: {
        ...existing.platforms?.feishu,
        enabled: payload.platforms.feishu.enabled,
        aiCommand: clean(payload.platforms.feishu.aiCommand) as "claude" | "codex" | "cursor" | "codebuddy" | undefined,
        appId: clean(payload.platforms.feishu.appId),
        appSecret: clean(payload.platforms.feishu.appSecret),
        allowedUserIds: splitCsv(payload.platforms.feishu.allowedUserIds),
      },
      qq: {
        ...existing.platforms?.qq,
        enabled: payload.platforms.qq.enabled,
        aiCommand: clean(payload.platforms.qq.aiCommand) as "claude" | "codex" | "cursor" | "codebuddy" | undefined,
        appId: clean(payload.platforms.qq.appId),
        secret: clean(payload.platforms.qq.secret),
        allowedUserIds: splitCsv(payload.platforms.qq.allowedUserIds),
      },
      wework: {
        ...existing.platforms?.wework,
        enabled: payload.platforms.wework.enabled,
        aiCommand: clean(payload.platforms.wework.aiCommand) as "claude" | "codex" | "cursor" | "codebuddy" | undefined,
        corpId: clean(payload.platforms.wework.corpId),
        secret: clean(payload.platforms.wework.secret),
        allowedUserIds: splitCsv(payload.platforms.wework.allowedUserIds),
      },
      dingtalk: {
        ...existing.platforms?.dingtalk,
        enabled: payload.platforms.dingtalk.enabled,
        aiCommand: clean(payload.platforms.dingtalk.aiCommand) as "claude" | "codex" | "cursor" | "codebuddy" | undefined,
        clientId: clean(payload.platforms.dingtalk.clientId),
        clientSecret: clean(payload.platforms.dingtalk.clientSecret),
        cardTemplateId: clean(payload.platforms.dingtalk.cardTemplateId),
        allowedUserIds: splitCsv(payload.platforms.dingtalk.allowedUserIds),
      },
    },
  };
}

function openBrowser(url: string): void {
  if (process.env.OPEN_IM_NO_BROWSER === "1") {
    return;
  }
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
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

  const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const finishFlow = (result: WebFlowResult) => {
        if (timer) clearTimeout(timer);
        server.close();
        settle(result);
      };

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

      if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        const file = loadFileConfig();
        const fileTelegram = file.platforms?.telegram;
        const fileFeishu = file.platforms?.feishu;
        const fileQQ = file.platforms?.qq;
        const fileWework = file.platforms?.wework;
        const fileDingtalk = file.platforms?.dingtalk;
        const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? fileTelegram?.botToken ?? file.telegramBotToken;
        const feishuAppId = process.env.FEISHU_APP_ID ?? fileFeishu?.appId ?? file.feishuAppId;
        const feishuAppSecret = process.env.FEISHU_APP_SECRET ?? fileFeishu?.appSecret ?? file.feishuAppSecret;
        const qqAppId = process.env.QQ_BOT_APPID ?? process.env.QQ_APP_ID ?? fileQQ?.appId;
        const qqSecret = process.env.QQ_BOT_SECRET ?? process.env.QQ_SECRET ?? fileQQ?.secret;
        const weworkCorpId = process.env.WEWORK_CORP_ID ?? fileWework?.corpId;
        const weworkSecret = process.env.WEWORK_SECRET ?? fileWework?.secret;
        const dingtalkClientId = process.env.DINGTALK_CLIENT_ID ?? fileDingtalk?.clientId;
        const dingtalkClientSecret = process.env.DINGTALK_CLIENT_SECRET ?? fileDingtalk?.clientSecret;
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

        json(response, 200, { platforms, serviceStatus: getServiceStatus() });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/service/start") {
        try {
          loadConfig();
          const started = startBackgroundService(options.cwd);
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
    server.listen(port, "127.0.0.1", () => resolve());
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

  return {
    close: async () => {
      if (timer) clearTimeout(timer);
      server.close();
      settle("cancel");
    },
    url: `http://127.0.0.1:${port}`,
    waitForResult,
  };
}

export async function runWebConfigFlow(options: { mode: WebFlowMode; cwd: string }): Promise<WebFlowResult> {
  const started = await startWebConfigServer(options);
  openBrowser(started.url);
  console.log(`Opened local configuration page: ${started.url}`);
  console.log(process.env.OPEN_IM_NO_BROWSER === "1" ? "Browser launch disabled. Open the URL manually." : "Save the configuration in your browser to continue.");
  return started.waitForResult;
}
