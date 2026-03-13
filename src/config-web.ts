import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { WEB_CONFIG_PORT } from "./constants.js";
import { CONFIG_PATH, loadConfig, loadFileConfig, saveFileConfig, type FileConfig } from "./config.js";
import { getServiceStatus, startBackgroundService, stopBackgroundService } from "./service-control.js";

type WebFlowMode = "init" | "start" | "dev";
type WebFlowResult = "saved" | "cancel";

export interface StartedWebConfigServer {
  close: () => Promise<void>;
  url: string;
  waitForResult: Promise<WebFlowResult>;
}

interface WebConfigPayload {
  platforms: {
    telegram: { enabled: boolean; botToken: string; proxy: string; allowedUserIds: string };
    feishu: { enabled: boolean; appId: string; appSecret: string; allowedUserIds: string };
    qq: { enabled: boolean; appId: string; secret: string; allowedUserIds: string };
    wework: { enabled: boolean; corpId: string; secret: string; allowedUserIds: string };
    dingtalk: { enabled: boolean; clientId: string; clientSecret: string; cardTemplateId: string; allowedUserIds: string };
  };
  ai: {
    aiCommand: "claude" | "codex" | "cursor";
    claudeCliPath: string;
    claudeWorkDir: string;
    claudeSkipPermissions: boolean;
    claudeTimeoutMs: number;
    claudeModel: string;
    cursorCliPath: string;
    codexCliPath: string;
    codexProxy: string;
    defaultPermissionMode?: "ask" | "accept-edits" | "plan" | "yolo";
    hookPort: number;
    logDir?: string;
    logLevel: "default" | "DEBUG" | "INFO" | "WARN" | "ERROR";
    useSdkMode: boolean;
  };
}

function splitCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function clean(value: string): string | undefined {
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
        botToken: file.platforms?.telegram?.botToken ?? "",
        proxy: file.platforms?.telegram?.proxy ?? "",
        allowedUserIds: (file.platforms?.telegram?.allowedUserIds ?? []).join(", "),
      },
      feishu: {
        enabled: file.platforms?.feishu?.enabled ?? Boolean(file.platforms?.feishu?.appId && file.platforms?.feishu?.appSecret),
        appId: file.platforms?.feishu?.appId ?? "",
        appSecret: file.platforms?.feishu?.appSecret ?? "",
        allowedUserIds: (file.platforms?.feishu?.allowedUserIds ?? []).join(", "),
      },
      qq: {
        enabled: file.platforms?.qq?.enabled ?? Boolean(file.platforms?.qq?.appId && file.platforms?.qq?.secret),
        appId: file.platforms?.qq?.appId ?? "",
        secret: file.platforms?.qq?.secret ?? "",
        allowedUserIds: (file.platforms?.qq?.allowedUserIds ?? []).join(", "),
      },
      wework: {
        enabled: file.platforms?.wework?.enabled ?? Boolean(file.platforms?.wework?.corpId && file.platforms?.wework?.secret),
        corpId: file.platforms?.wework?.corpId ?? "",
        secret: file.platforms?.wework?.secret ?? "",
        allowedUserIds: (file.platforms?.wework?.allowedUserIds ?? []).join(", "),
      },
      dingtalk: {
        enabled: file.platforms?.dingtalk?.enabled ?? Boolean(file.platforms?.dingtalk?.clientId && file.platforms?.dingtalk?.clientSecret),
        clientId: file.platforms?.dingtalk?.clientId ?? "",
        clientSecret: file.platforms?.dingtalk?.clientSecret ?? "",
        cardTemplateId: file.platforms?.dingtalk?.cardTemplateId ?? "",
        allowedUserIds: (file.platforms?.dingtalk?.allowedUserIds ?? []).join(", "),
      },
    },
    ai: {
      aiCommand: (file.aiCommand as "claude" | "codex" | "cursor") ?? "claude",
      claudeCliPath: file.tools?.claude?.cliPath ?? "claude",
      claudeWorkDir: file.tools?.claude?.workDir ?? process.cwd(),
      claudeSkipPermissions: file.tools?.claude?.skipPermissions ?? true,
      claudeTimeoutMs: file.tools?.claude?.timeoutMs ?? 600000,
      claudeModel: file.tools?.claude?.model ?? "",
      cursorCliPath: file.tools?.cursor?.cliPath ?? "agent",
      codexCliPath: file.tools?.codex?.cliPath ?? "codex",
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
  if (!Number.isFinite(payload.ai.hookPort) || payload.ai.hookPort <= 0) errors.push("Hook port must be positive.");
  return errors;
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
        proxy: clean(payload.ai.codexProxy),
      },
    },
    platforms: {
      ...existing.platforms,
      telegram: {
        ...existing.platforms?.telegram,
        enabled: payload.platforms.telegram.enabled,
        botToken: clean(payload.platforms.telegram.botToken),
        proxy: clean(payload.platforms.telegram.proxy),
        allowedUserIds: splitCsv(payload.platforms.telegram.allowedUserIds),
      },
      feishu: {
        ...existing.platforms?.feishu,
        enabled: payload.platforms.feishu.enabled,
        appId: clean(payload.platforms.feishu.appId),
        appSecret: clean(payload.platforms.feishu.appSecret),
        allowedUserIds: splitCsv(payload.platforms.feishu.allowedUserIds),
      },
      qq: {
        ...existing.platforms?.qq,
        enabled: payload.platforms.qq.enabled,
        appId: clean(payload.platforms.qq.appId),
        secret: clean(payload.platforms.qq.secret),
        allowedUserIds: splitCsv(payload.platforms.qq.allowedUserIds),
      },
      wework: {
        ...existing.platforms?.wework,
        enabled: payload.platforms.wework.enabled,
        corpId: clean(payload.platforms.wework.corpId),
        secret: clean(payload.platforms.wework.secret),
        allowedUserIds: splitCsv(payload.platforms.wework.allowedUserIds),
      },
      dingtalk: {
        ...existing.platforms?.dingtalk,
        enabled: payload.platforms.dingtalk.enabled,
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

const PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>open-im local control</title>
    <style>
      :root{--bg:#f2ead8;--panel:rgba(255,251,242,.9);--ink:#13231a;--muted:#56675f;--line:rgba(19,35,26,.12);--green:#1a6a44;--orange:#cf6f31;--red:#9d4236}
      *{box-sizing:border-box}body{margin:0;font-family:Georgia,"Times New Roman",serif;color:var(--ink);background:linear-gradient(135deg,#ebe1ce,#f8f3e9)}
      .shell{padding:24px 16px 40px}.frame{max-width:1180px;margin:0 auto;background:var(--panel);border:1px solid var(--line);box-shadow:0 28px 70px rgba(19,35,26,.14)}
      .hero,.toolbar,.section,.footer{padding:20px 22px;border-bottom:1px solid var(--line)}.hero{background:linear-gradient(120deg,rgba(19,35,26,.96),rgba(26,106,68,.92));color:#f7f0df}
      .hero h1,.hero p{margin:0}.hero h1{font-size:clamp(2rem,4vw,3.4rem);line-height:.95}.hero p{margin-top:12px;max-width:720px}
      .pill{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.62);font-size:.9rem}
      .toolbar,.grid,.two-col,.footer,.actions{display:grid;gap:14px}.status-row{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between}.status-group{display:flex;flex-wrap:wrap;gap:10px}.grid{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
      .panel{padding:16px;border:1px solid var(--line);background:rgba(255,255,255,.46);transition:opacity .18s ease,transform .18s ease}.panel.off{opacity:.58}.panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}
      h2,h3{margin:0}label{display:grid;gap:6px;color:var(--muted);font-size:.92rem}input,select,textarea{width:100%;padding:11px 12px;border:1px solid rgba(19,35,26,.14);background:rgba(255,255,255,.84);font:inherit;color:var(--ink)}
      textarea{min-height:74px;resize:vertical}.two-col{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.toggle{display:inline-flex;align-items:center;gap:10px;color:var(--ink)}.toggle input{width:18px;height:18px}
      .actions{display:flex;flex-wrap:wrap;gap:10px}button{border:0;padding:12px 16px;font:inherit;cursor:pointer;color:#fff7eb;background:var(--ink)}button.secondary{background:var(--green)}button.warning{background:var(--orange)}button.danger{background:var(--red)}button.ghost{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.28)}button:disabled{opacity:.5;cursor:wait}
      .message{min-height:24px;color:var(--muted)}.message.success{color:var(--green)}.message.error{color:var(--red)}.mono{font-family:Consolas,monospace}.summary{color:var(--muted)}.note{border-left:4px solid var(--orange)}
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="frame">
        <section class="hero">
          <div class="status-row">
            <div class="pill" id="heroBadge">open-im local control</div>
            <button id="langButton" class="ghost" type="button">中文</button>
          </div>
          <h1 id="heroTitle">Configure fast. Start clean.</h1>
          <p id="heroBody">Local-only configuration for Telegram, Feishu, WeWork, and DingTalk. No accounts. No remote state. No database.</p>
        </section>
        <section class="toolbar">
          <div class="status-group">
            <div class="pill mono" id="configPath"></div>
            <div class="pill" id="serviceState"></div>
            <div class="pill" id="modeBadge"></div>
          </div>
          <div id="statusMeta"></div>
          <div class="summary" id="liveSummary"></div>
        </section>
        <section class="section">
          <div class="panel-head"><h2 id="platformsTitle">Platforms</h2><div id="platformsHint">Disabled platforms keep their saved values.</div></div>
          <div class="grid">
            <article class="panel" id="telegram-panel">
              <div class="panel-head"><h3>Telegram</h3><label class="toggle"><input id="telegram-enabled" type="checkbox" /> Enabled</label></div>
              <div class="summary" id="telegram-help" style="margin-bottom:12px;color:var(--muted);font-size:0.9em;">获取凭证：访问 <a href="https://t.me/BotFather" target="_blank" style="color:var(--green);text-decoration:underline;">@BotFather</a> 发送 /newbot 创建机器人，获取 Bot Token</div>
              <label>Bot token<input id="telegram-botToken" placeholder="123456:ABC..." /></label>
              <label>Proxy<input id="telegram-proxy" placeholder="http://127.0.0.1:7890" /></label>
              <label>Allowed user IDs<textarea id="telegram-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
            </article>
            <article class="panel" id="feishu-panel">
              <div class="panel-head"><h3>Feishu</h3><label class="toggle"><input id="feishu-enabled" type="checkbox" /> Enabled</label></div>
              <div class="summary" id="feishu-help" style="margin-bottom:12px;color:var(--muted);font-size:0.9em;">获取凭证：访问 <a href="https://open.feishu.cn/" target="_blank" style="color:var(--green);text-decoration:underline;">飞书开放平台</a> 创建应用，启用机器人，获取 App ID 和 App Secret</div>
              <label>App ID<input id="feishu-appId" /></label>
              <label>App Secret<input id="feishu-appSecret" /></label>
              <label>Allowed user IDs<textarea id="feishu-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
            </article>
            <article class="panel" id="qq-panel">
              <div class="panel-head"><h3>QQ</h3><label class="toggle"><input id="qq-enabled" type="checkbox" /> Enabled</label></div>
              <div class="summary" id="qq-help" style="margin-bottom:12px;color:var(--muted);font-size:0.9em;">获取凭证：访问 <a href="https://bot.q.qq.com" target="_blank" style="color:var(--green);text-decoration:underline;">QQ 开放平台</a> 创建机器人，获取 App ID 和 App Secret</div>
              <label>App ID<input id="qq-appId" /></label>
              <label>App Secret<input id="qq-secret" /></label>
              <label>Allowed user IDs<textarea id="qq-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
            </article>
            <article class="panel" id="wework-panel">
              <div class="panel-head"><h3>WeWork</h3><label class="toggle"><input id="wework-enabled" type="checkbox" /> Enabled</label></div>
              <div class="summary" id="wework-help" style="margin-bottom:12px;color:var(--muted);font-size:0.9em;">获取凭证：访问 <a href="https://work.weixin.qq.com/" target="_blank" style="color:var(--green);text-decoration:underline;">企业微信管理后台</a> 创建应用，获取 Bot ID (Corp ID) 和 Secret</div>
              <label>Corp ID / Bot ID<input id="wework-corpId" /></label>
              <label>Secret<input id="wework-secret" /></label>
              <label>Allowed user IDs<textarea id="wework-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
            </article>
            <article class="panel" id="dingtalk-panel">
              <div class="panel-head"><h3>DingTalk</h3><label class="toggle"><input id="dingtalk-enabled" type="checkbox" /> Enabled</label></div>
              <div class="summary" id="dingtalk-help" style="margin-bottom:12px;color:var(--muted);font-size:0.9em;">获取凭证：访问钉钉开放平台创建企业内部应用，启用机器人 Stream Mode，获取 Client ID 和 Client Secret</div>
              <label>Client ID / AppKey<input id="dingtalk-clientId" /></label>
              <label>Client Secret / AppSecret<input id="dingtalk-clientSecret" /></label>
              <label>Card template ID<input id="dingtalk-cardTemplateId" placeholder="Optional" /></label>
              <label>Allowed user IDs<textarea id="dingtalk-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
            </article>
          </div>
        </section>
        <section class="section">
          <div class="panel-head"><h2 id="aiTitle">AI Tooling</h2><div id="aiHint">WeChat is intentionally excluded from this first version.</div></div>
          <article class="panel note" id="claudeNote">Claude credentials are still read from environment variables or ~/.claude/settings.json. This page manages local bridge config, not Claude account auth.</article>
          <article class="panel">
            <div class="two-col">
              <label>Default AI tool<select id="ai-aiCommand"><option value="claude">claude</option><option value="codex">codex</option><option value="cursor">cursor</option></select></label>
              <label>Default work directory<input id="ai-claudeWorkDir" class="mono" /></label>
              <label>Claude CLI path<input id="ai-claudeCliPath" class="mono" /></label>
              <label>Cursor CLI path<input id="ai-cursorCliPath" class="mono" /></label>
              <label>Codex CLI path<input id="ai-codexCliPath" class="mono" /></label>
              <label>Codex proxy<input id="ai-codexProxy" class="mono" placeholder="Optional" /></label>
              <label>Claude timeout (ms)<input id="ai-claudeTimeoutMs" type="number" min="1" /></label>
              <label>Claude model<input id="ai-claudeModel" placeholder="Optional" /></label>
              <label>Hook port<input id="ai-hookPort" type="number" min="1" /></label>
              <label>Log level<select id="ai-logLevel"><option value="default">default</option><option value="DEBUG">DEBUG</option><option value="INFO">INFO</option><option value="WARN">WARN</option><option value="ERROR">ERROR</option></select></label>
            </div>
            <div class="actions" style="margin-top:14px">
              <label class="toggle"><input id="ai-claudeSkipPermissions" type="checkbox" /> Auto-approve tool permissions</label>
              <label class="toggle"><input id="ai-useSdkMode" type="checkbox" /> Use Claude SDK mode</label>
            </div>
          </article>
        </section>
        <section class="footer">
          <div class="actions">
            <button id="validateButton" class="warning">Validate</button>
            <button id="saveButton" class="secondary">Save config</button>
            <button id="startButton">Start bridge</button>
            <button id="stopButton" class="danger">Stop bridge</button>
          </div>
          <div class="message" id="message"></div>
        </section>
      </div>
    </div>
    <script>
      const ids = ["telegram-enabled","telegram-botToken","telegram-proxy","telegram-allowedUserIds","feishu-enabled","feishu-appId","feishu-appSecret","feishu-allowedUserIds","qq-enabled","qq-appId","qq-secret","qq-allowedUserIds","wework-enabled","wework-corpId","wework-secret","wework-allowedUserIds","dingtalk-enabled","dingtalk-clientId","dingtalk-clientSecret","dingtalk-cardTemplateId","dingtalk-allowedUserIds","ai-aiCommand","ai-claudeCliPath","ai-claudeWorkDir","ai-claudeSkipPermissions","ai-claudeTimeoutMs","ai-claudeModel","ai-cursorCliPath","ai-codexCliPath","ai-codexProxy","ai-hookPort","ai-logLevel","ai-useSdkMode"];
      const el = (id) => document.getElementById(id);
      const storageKey = "open-im-web-lang";
      const texts = {
        en: {
          pageTitle: "open-im local control",
          heroBadge: "open-im local control",
          heroTitle: "Local bridge control.",
          heroBody: "",
          langButton: "中文",
          mode: "Flow",
          platformsTitle: "Platforms",
          platformsHint: "Disabled platforms keep their saved values.",
          enabled: "Enabled",
          botToken: "Bot token",
          proxy: "Proxy",
          allowedUserIds: "Allowed user IDs",
          telegramHelp: 'Get credentials: Visit <a href="https://t.me/BotFather" target="_blank">@BotFather</a> and send /newbot to create a bot and get Bot Token',
          appId: "App ID",
          appSecret: "App Secret",
          feishuHelp: 'Get credentials: Visit <a href="https://open.feishu.cn/" target="_blank">Feishu Open Platform</a> to create an app, enable bot, and get App ID / App Secret',
          qqAppId: "App ID",
          qqAppSecret: "App Secret",
          qqHelp: 'Get credentials: Visit <a href="https://bot.q.qq.com" target="_blank">QQ Open Platform</a> to create a bot and get App ID / App Secret',
          corpId: "Corp ID / Bot ID",
          weworkHelp: 'Get credentials: Visit <a href="https://work.weixin.qq.com/" target="_blank">WeWork Admin Console</a> to create an app and get Bot ID (Corp ID) / Secret',
          clientId: "Client ID / AppKey",
          clientSecret: "Client Secret / AppSecret",
          dingtalkHelp: 'Get credentials: Create an enterprise internal app on DingTalk Open Platform, enable Stream Mode, and get Client ID / Client Secret',
          secret: "Secret",
          clientId: "Client ID / AppKey",
          clientSecret: "Client Secret / AppSecret",
          cardTemplateId: "Card template ID",
          optional: "Optional",
          commaSeparatedIds: "Comma-separated IDs",
          aiTitle: "AI Tooling",
          aiHint: "",
          claudeNote: "Claude credentials are still read from environment variables or ~/.claude/settings.json. This page manages local bridge config, not Claude account auth.",
          aiTool: "Default AI tool",
          workDir: "Default work directory",
          claudeCli: "Claude CLI path",
          cursorCli: "Cursor CLI path",
          codexCli: "Codex CLI path",
          codexProxy: "Codex proxy",
          claudeTimeout: "Claude timeout (ms)",
          claudeModel: "Claude model",
          hookPort: "Hook port",
          logLevel: "Log level",
          logLevelDefault: "default (app default)",
          autoApprove: "Auto-approve tool permissions",
          sdkMode: "Use Claude SDK mode",
          validate: "Validate",
          save: "Save config",
          start: "Start bridge",
          stop: "Stop bridge",
          bridgeRunning: "Bridge running (pid {pid})",
          bridgeStopped: "Bridge stopped",
          bridgeActive: "Bridge worker is active.",
          bridgeInactive: "Bridge worker is currently stopped.",
          summaryEnabled: "Enabled platforms: {platforms} | AI tool: {tool}",
          summaryEmpty: "No platform enabled yet | AI tool: {tool}",
          ready: "Control surface ready.",
          validationOk: "Configuration looks internally consistent.",
          saveOk: "Configuration saved.",
          startOk: "Bridge started.",
          stopOk: "Bridge stopped.",
        },
        zh: {
          pageTitle: "open-im 本地控制台",
          heroBadge: "open-im 本地控制台",
          heroTitle: "本地桥接控制台",
          heroBody: "",
          langButton: "EN",
          mode: "流程",
          platformsTitle: "平台配置",
          platformsHint: "关闭的平台会保留已保存的值。",
          enabled: "启用",
          botToken: "Bot Token",
          proxy: "代理",
          allowedUserIds: "允许的用户 ID",
          telegramHelp: '获取凭证：访问 <a href="https://t.me/BotFather" target="_blank">@BotFather</a> 发送 /newbot 创建机器人，获取 Bot Token',
          appId: "App ID",
          appSecret: "App Secret",
          feishuHelp: '获取凭证：访问 <a href="https://open.feishu.cn/" target="_blank">飞书开放平台</a> 创建应用，启用机器人，获取 App ID 和 App Secret',
          qqAppId: "App ID",
          qqAppSecret: "App Secret",
          qqHelp: '获取凭证：访问 <a href="https://bot.q.qq.com" target="_blank">QQ 开放平台</a> 创建机器人，获取 App ID 和 App Secret',
          corpId: "Corp ID / Bot ID",
          weworkHelp: '获取凭证：访问 <a href="https://work.weixin.qq.com/" target="_blank">企业微信管理后台</a> 创建应用，获取 Bot ID (Corp ID) 和 Secret',
          clientId: "Client ID / AppKey",
          clientSecret: "Client Secret / AppSecret",
          dingtalkHelp: '获取凭证：访问钉钉开放平台创建企业内部应用，启用机器人 Stream Mode，获取 Client ID 和 Client Secret',
          secret: "Secret",
          clientId: "Client ID / AppKey",
          clientSecret: "Client Secret / AppSecret",
          cardTemplateId: "卡片模板 ID",
          optional: "可选",
          commaSeparatedIds: "用逗号分隔多个 ID",
          aiTitle: "AI 工具配置",
          aiHint: "",
          claudeNote: "Claude 凭证仍然从环境变量或 ~/.claude/settings.json 读取。这个页面只管理本地桥接配置，不负责 Claude 账号登录。",
          aiTool: "默认 AI 工具",
          workDir: "默认工作目录",
          claudeCli: "Claude CLI 路径",
          cursorCli: "Cursor CLI 路径",
          codexCli: "Codex CLI 路径",
          codexProxy: "Codex 代理",
          claudeTimeout: "Claude 超时（毫秒）",
          claudeModel: "Claude 模型",
          hookPort: "Hook 端口",
          logLevel: "日志级别",
          logLevelDefault: "default（程序默认）",
          autoApprove: "自动允许工具权限",
          sdkMode: "使用 Claude SDK 模式",
          validate: "校验配置",
          save: "保存配置",
          start: "启动桥接",
          stop: "停止桥接",
          bridgeRunning: "桥接运行中（pid {pid}）",
          bridgeStopped: "桥接已停止",
          bridgeActive: "桥接 worker 正在运行。",
          bridgeInactive: "桥接 worker 当前已停止。",
          summaryEnabled: "已启用平台：{platforms} | AI 工具：{tool}",
          summaryEmpty: "暂未启用平台 | AI 工具：{tool}",
          ready: "控制台已就绪。",
          validationOk: "配置校验通过。",
          saveOk: "配置已保存。",
          startOk: "桥接已启动。",
          stopOk: "桥接已停止。",
        }
      };
      let currentMeta = null;
      let currentLang = (localStorage.getItem(storageKey) || "").startsWith("zh") ? "zh" : ((navigator.language || "").startsWith("zh") ? "zh" : "en");
      const t = (key, params={}) => {
        const source = texts[currentLang] || texts.en;
        return Object.keys(params).reduce((result, name) => result.replaceAll("{" + name + "}", String(params[name])), source[key] || key);
      };
      const setMessage = (text, type="") => { const node = el("message"); node.textContent = text; node.className = ("message " + type).trim(); };
      const setBusy = (busy) => ["validateButton","saveButton","startButton","stopButton","langButton"].forEach((id) => { el(id).disabled = busy; });
      function applyLanguage(meta) {
        if (meta) currentMeta = meta;
        document.documentElement.lang = currentLang === "zh" ? "zh-CN" : "en";
        document.title = t("pageTitle");
        el("heroBadge").textContent = t("heroBadge");
        el("heroTitle").textContent = t("heroTitle");
        el("heroBody").textContent = t("heroBody");
        el("heroBody").style.display = t("heroBody") ? "block" : "none";
        el("langButton").textContent = t("langButton");
        el("platformsTitle").textContent = t("platformsTitle");
        el("platformsHint").textContent = t("platformsHint");
        el("aiTitle").textContent = t("aiTitle");
        el("aiHint").textContent = t("aiHint");
        el("aiHint").style.display = t("aiHint") ? "block" : "none";
        el("claudeNote").childNodes[0].textContent = t("claudeNote");
        el("telegram-panel").querySelector(".toggle").lastChild.textContent = " " + t("enabled");
        el("feishu-panel").querySelector(".toggle").lastChild.textContent = " " + t("enabled");
        el("qq-panel").querySelector(".toggle").lastChild.textContent = " " + t("enabled");
        el("wework-panel").querySelector(".toggle").lastChild.textContent = " " + t("enabled");
        el("dingtalk-panel").querySelector(".toggle").lastChild.textContent = " " + t("enabled");
        const telegramLabels = el("telegram-panel").querySelectorAll(":scope > label");
        telegramLabels[0].childNodes[0].textContent = t("botToken");
        telegramLabels[1].childNodes[0].textContent = t("proxy");
        telegramLabels[2].childNodes[0].textContent = t("allowedUserIds");
        el("telegram-help").innerHTML = t("telegramHelp");
        const feishuLabels = el("feishu-panel").querySelectorAll(":scope > label");
        feishuLabels[0].childNodes[0].textContent = t("appId");
        feishuLabels[1].childNodes[0].textContent = t("appSecret");
        feishuLabels[2].childNodes[0].textContent = t("allowedUserIds");
        el("feishu-help").innerHTML = t("feishuHelp");
        const qqLabels = el("qq-panel").querySelectorAll(":scope > label");
        qqLabels[0].childNodes[0].textContent = t("qqAppId");
        qqLabels[1].childNodes[0].textContent = t("qqAppSecret");
        qqLabels[2].childNodes[0].textContent = t("allowedUserIds");
        el("qq-help").innerHTML = t("qqHelp");
        const weworkLabels = el("wework-panel").querySelectorAll(":scope > label");
        weworkLabels[0].childNodes[0].textContent = t("corpId");
        weworkLabels[1].childNodes[0].textContent = t("secret");
        weworkLabels[2].childNodes[0].textContent = t("allowedUserIds");
        el("wework-help").innerHTML = t("weworkHelp");
        const dingtalkLabels = el("dingtalk-panel").querySelectorAll(":scope > label");
        dingtalkLabels[0].childNodes[0].textContent = t("clientId");
        dingtalkLabels[1].childNodes[0].textContent = t("clientSecret");
        dingtalkLabels[2].childNodes[0].textContent = t("cardTemplateId");
        dingtalkLabels[3].childNodes[0].textContent = t("allowedUserIds");
        el("dingtalk-help").innerHTML = t("dingtalkHelp");
        weworkLabels[0].childNodes[0].textContent = t("corpId");
        weworkLabels[1].childNodes[0].textContent = t("secret");
        weworkLabels[2].childNodes[0].textContent = t("allowedUserIds");
        const dingtalkLabels = el("dingtalk-panel").querySelectorAll(":scope > label");
        dingtalkLabels[0].childNodes[0].textContent = t("clientId");
        dingtalkLabels[1].childNodes[0].textContent = t("clientSecret");
        dingtalkLabels[2].childNodes[0].textContent = t("cardTemplateId");
        dingtalkLabels[3].childNodes[0].textContent = t("allowedUserIds");
        el("telegram-allowedUserIds").placeholder = t("commaSeparatedIds");
        el("feishu-allowedUserIds").placeholder = t("commaSeparatedIds");
        el("qq-allowedUserIds").placeholder = t("commaSeparatedIds");
        el("wework-allowedUserIds").placeholder = t("commaSeparatedIds");
        el("dingtalk-allowedUserIds").placeholder = t("commaSeparatedIds");
        el("dingtalk-cardTemplateId").placeholder = t("optional");
        const aiLabels = document.querySelectorAll(".two-col > label");
        aiLabels[0].childNodes[0].textContent = t("aiTool");
        aiLabels[1].childNodes[0].textContent = t("workDir");
        aiLabels[2].childNodes[0].textContent = t("claudeCli");
        aiLabels[3].childNodes[0].textContent = t("cursorCli");
        aiLabels[4].childNodes[0].textContent = t("codexCli");
        aiLabels[5].childNodes[0].textContent = t("codexProxy");
        aiLabels[6].childNodes[0].textContent = t("claudeTimeout");
        aiLabels[7].childNodes[0].textContent = t("claudeModel");
        aiLabels[8].childNodes[0].textContent = t("hookPort");
        aiLabels[9].childNodes[0].textContent = t("logLevel");
        const logLevelOptions = el("ai-logLevel").options;
        logLevelOptions[0].text = t("logLevelDefault");
        logLevelOptions[1].text = "DEBUG";
        logLevelOptions[2].text = "INFO";
        logLevelOptions[3].text = "WARN";
        logLevelOptions[4].text = "ERROR";
        if (!el("ai-logLevel").value) {
          el("ai-logLevel").value = "default";
        }
        el("ai-codexProxy").placeholder = t("optional");
        el("ai-claudeModel").placeholder = t("optional");
        const aiToggles = document.querySelectorAll(".actions .toggle");
        aiToggles[0].lastChild.textContent = " " + t("autoApprove");
        aiToggles[1].lastChild.textContent = " " + t("sdkMode");
        el("validateButton").textContent = t("validate");
        el("saveButton").textContent = t("save");
        el("startButton").textContent = t("start");
        el("stopButton").textContent = t("stop");
        if (currentMeta) {
          el("modeBadge").textContent = t("mode") + ": " + currentMeta.mode;
        }
      }
      function updateVisualState() {
        const enabled = [];
        [["telegram","Telegram"],["feishu","Feishu"],["qq","QQ"],["wework","WeWork"],["dingtalk","DingTalk"]].forEach(([key,label]) => {
          const active = el(key + "-enabled").checked;
          el(key + "-panel").classList.toggle("off", !active);
          if (active) enabled.push(label);
        });
        const aiTool = el("ai-aiCommand").value;
        el("liveSummary").textContent = enabled.length
          ? t("summaryEnabled", { platforms: enabled.join(currentLang === "zh" ? "、" : ", "), tool: aiTool })
          : t("summaryEmpty", { tool: aiTool });
      }
      const payload = () => ({ platforms: { telegram: { enabled: el("telegram-enabled").checked, botToken: el("telegram-botToken").value, proxy: el("telegram-proxy").value, allowedUserIds: el("telegram-allowedUserIds").value }, feishu: { enabled: el("feishu-enabled").checked, appId: el("feishu-appId").value, appSecret: el("feishu-appSecret").value, allowedUserIds: el("feishu-allowedUserIds").value }, qq: { enabled: el("qq-enabled").checked, appId: el("qq-appId").value, secret: el("qq-secret").value, allowedUserIds: el("qq-allowedUserIds").value }, wework: { enabled: el("wework-enabled").checked, corpId: el("wework-corpId").value, secret: el("wework-secret").value, allowedUserIds: el("wework-allowedUserIds").value }, dingtalk: { enabled: el("dingtalk-enabled").checked, clientId: el("dingtalk-clientId").value, clientSecret: el("dingtalk-clientSecret").value, cardTemplateId: el("dingtalk-cardTemplateId").value, allowedUserIds: el("dingtalk-allowedUserIds").value } }, ai: { aiCommand: el("ai-aiCommand").value, claudeCliPath: el("ai-claudeCliPath").value, claudeWorkDir: el("ai-claudeWorkDir").value, claudeSkipPermissions: el("ai-claudeSkipPermissions").checked, claudeTimeoutMs: Number(el("ai-claudeTimeoutMs").value || "0"), claudeModel: el("ai-claudeModel").value, cursorCliPath: el("ai-cursorCliPath").value, codexCliPath: el("ai-codexCliPath").value, codexProxy: el("ai-codexProxy").value, hookPort: Number(el("ai-hookPort").value || "0"), logLevel: el("ai-logLevel").value, useSdkMode: el("ai-useSdkMode").checked } });
      async function request(path, options={}) { const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Request failed"); return body; }
      function fill(data, meta) { el("configPath").textContent = meta.configPath; applyLanguage(meta); el("telegram-enabled").checked = data.platforms.telegram.enabled; el("telegram-botToken").value = data.platforms.telegram.botToken; el("telegram-proxy").value = data.platforms.telegram.proxy; el("telegram-allowedUserIds").value = data.platforms.telegram.allowedUserIds; el("feishu-enabled").checked = data.platforms.feishu.enabled; el("feishu-appId").value = data.platforms.feishu.appId; el("feishu-appSecret").value = data.platforms.feishu.appSecret; el("feishu-allowedUserIds").value = data.platforms.feishu.allowedUserIds; el("qq-enabled").checked = data.platforms.qq.enabled; el("qq-appId").value = data.platforms.qq.appId; el("qq-secret").value = data.platforms.qq.secret; el("qq-allowedUserIds").value = data.platforms.qq.allowedUserIds; el("wework-enabled").checked = data.platforms.wework.enabled; el("wework-corpId").value = data.platforms.wework.corpId; el("wework-secret").value = data.platforms.wework.secret; el("wework-allowedUserIds").value = data.platforms.wework.allowedUserIds; el("dingtalk-enabled").checked = data.platforms.dingtalk.enabled; el("dingtalk-clientId").value = data.platforms.dingtalk.clientId; el("dingtalk-clientSecret").value = data.platforms.dingtalk.clientSecret; el("dingtalk-cardTemplateId").value = data.platforms.dingtalk.cardTemplateId; el("dingtalk-allowedUserIds").value = data.platforms.dingtalk.allowedUserIds; el("ai-aiCommand").value = data.ai.aiCommand; el("ai-claudeCliPath").value = data.ai.claudeCliPath; el("ai-claudeWorkDir").value = data.ai.claudeWorkDir; el("ai-claudeSkipPermissions").checked = data.ai.claudeSkipPermissions; el("ai-claudeTimeoutMs").value = String(data.ai.claudeTimeoutMs); el("ai-claudeModel").value = data.ai.claudeModel; el("ai-cursorCliPath").value = data.ai.cursorCliPath; el("ai-codexCliPath").value = data.ai.codexCliPath; el("ai-codexProxy").value = data.ai.codexProxy; el("ai-hookPort").value = String(data.ai.hookPort); el("ai-logLevel").value = data.ai.logLevel || "default"; el("ai-useSdkMode").checked = data.ai.useSdkMode; updateVisualState(); }
      async function refreshStatus() { const data = await request("/api/service/status"); el("serviceState").textContent = data.running ? t("bridgeRunning", { pid: data.pid }) : t("bridgeStopped"); el("statusMeta").textContent = data.running ? t("bridgeActive") : t("bridgeInactive"); }
      async function boot() { setBusy(true); try { applyLanguage(); const data = await request("/api/config"); fill(data.payload, data.meta); await refreshStatus(); setMessage(t("ready"), "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } setInterval(() => { refreshStatus().catch(() => {}); }, 5000); ids.forEach((id) => { const node = el(id); if (node) node.addEventListener("input", updateVisualState); if (node) node.addEventListener("change", updateVisualState); }); }
      async function validate() { setBusy(true); try { await request("/api/config/validate", { method: "POST", body: JSON.stringify(payload()) }); setMessage(t("validationOk"), "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } }
      async function save() { setBusy(true); try { await request("/api/config/save?final=1", { method: "POST", body: JSON.stringify(payload()) }); setMessage(t("saveOk"), "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } }
      async function startService() { setBusy(true); try { await request("/api/config/save", { method: "POST", body: JSON.stringify(payload()) }); await request("/api/service/start", { method: "POST" }); await refreshStatus(); setMessage(t("startOk"), "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } }
      async function stopService() { setBusy(true); try { await request("/api/service/stop", { method: "POST" }); await refreshStatus(); setMessage(t("stopOk"), "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } }
      el("langButton").onclick = () => { currentLang = currentLang === "zh" ? "en" : "zh"; localStorage.setItem(storageKey, currentLang); applyLanguage(); updateVisualState(); refreshStatus().catch(() => {}); };
      el("validateButton").onclick = validate; el("saveButton").onclick = save; el("startButton").onclick = startService; el("stopButton").onclick = stopService; boot();
    </script>
  </body>
</html>`;

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

  if (!options.persistent) {
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
