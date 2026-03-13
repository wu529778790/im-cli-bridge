import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
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
    wework: { enabled: boolean; corpId: string; secret: string; wsUrl: string; allowedUserIds: string };
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
    defaultPermissionMode: "ask" | "accept-edits" | "plan" | "yolo";
    hookPort: number;
    logDir: string;
    logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
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
      wework: {
        enabled: file.platforms?.wework?.enabled ?? Boolean(file.platforms?.wework?.corpId && file.platforms?.wework?.secret),
        corpId: file.platforms?.wework?.corpId ?? "",
        secret: file.platforms?.wework?.secret ?? "",
        wsUrl: file.platforms?.wework?.wsUrl ?? "",
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
      logLevel: (file.logLevel as "DEBUG" | "INFO" | "WARN" | "ERROR") ?? "INFO",
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
    defaultPermissionMode: payload.ai.defaultPermissionMode,
    hookPort: payload.ai.hookPort,
    logDir: clean(payload.ai.logDir),
    logLevel: payload.ai.logLevel,
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
      wework: {
        ...existing.platforms?.wework,
        enabled: payload.platforms.wework.enabled,
        corpId: clean(payload.platforms.wework.corpId),
        secret: clean(payload.platforms.wework.secret),
        wsUrl: clean(payload.platforms.wework.wsUrl),
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
      .toolbar,.grid,.two-col,.footer,.actions{display:grid;gap:14px}.status-row{display:flex;flex-wrap:wrap;gap:10px}.grid{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
      .panel{padding:16px;border:1px solid var(--line);background:rgba(255,255,255,.46);transition:opacity .18s ease,transform .18s ease}.panel.off{opacity:.58}.panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}
      h2,h3{margin:0}label{display:grid;gap:6px;color:var(--muted);font-size:.92rem}input,select,textarea{width:100%;padding:11px 12px;border:1px solid rgba(19,35,26,.14);background:rgba(255,255,255,.84);font:inherit;color:var(--ink)}
      textarea{min-height:74px;resize:vertical}.two-col{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.toggle{display:inline-flex;align-items:center;gap:10px;color:var(--ink)}.toggle input{width:18px;height:18px}
      .actions{display:flex;flex-wrap:wrap;gap:10px}button{border:0;padding:12px 16px;font:inherit;cursor:pointer;color:#fff7eb;background:var(--ink)}button.secondary{background:var(--green)}button.warning{background:var(--orange)}button.danger{background:var(--red)}button:disabled{opacity:.5;cursor:wait}
      .message{min-height:24px;color:var(--muted)}.message.success{color:var(--green)}.message.error{color:var(--red)}.mono{font-family:Consolas,monospace}.summary{color:var(--muted)}.note{border-left:4px solid var(--orange)}
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="frame">
        <section class="hero">
          <div class="pill">open-im local control</div>
          <h1>Configure fast. Start clean.</h1>
          <p>Local-only configuration for Telegram, Feishu, WeWork, and DingTalk. No accounts. No remote state. No database.</p>
        </section>
        <section class="toolbar">
          <div class="status-row">
            <div class="pill mono" id="configPath"></div>
            <div class="pill" id="serviceState"></div>
            <div class="pill" id="modeBadge"></div>
          </div>
          <div id="statusMeta"></div>
          <div class="summary" id="liveSummary"></div>
        </section>
        <section class="section">
          <div class="panel-head"><h2>Platforms</h2><div>Disabled platforms keep their saved values.</div></div>
          <div class="grid">
            <article class="panel" id="telegram-panel">
              <div class="panel-head"><h3>Telegram</h3><label class="toggle"><input id="telegram-enabled" type="checkbox" /> Enabled</label></div>
              <label>Bot token<input id="telegram-botToken" placeholder="123456:ABC..." /></label>
              <label>Proxy<input id="telegram-proxy" placeholder="http://127.0.0.1:7890" /></label>
              <label>Allowed user IDs<textarea id="telegram-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
            </article>
            <article class="panel" id="feishu-panel">
              <div class="panel-head"><h3>Feishu</h3><label class="toggle"><input id="feishu-enabled" type="checkbox" /> Enabled</label></div>
              <label>App ID<input id="feishu-appId" /></label>
              <label>App Secret<input id="feishu-appSecret" /></label>
              <label>Allowed user IDs<textarea id="feishu-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
            </article>
            <article class="panel" id="wework-panel">
              <div class="panel-head"><h3>WeWork</h3><label class="toggle"><input id="wework-enabled" type="checkbox" /> Enabled</label></div>
              <label>Corp ID / Bot ID<input id="wework-corpId" /></label>
              <label>Secret<input id="wework-secret" /></label>
              <label>WebSocket URL<input id="wework-wsUrl" placeholder="Optional" /></label>
              <label>Allowed user IDs<textarea id="wework-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
            </article>
            <article class="panel" id="dingtalk-panel">
              <div class="panel-head"><h3>DingTalk</h3><label class="toggle"><input id="dingtalk-enabled" type="checkbox" /> Enabled</label></div>
              <label>Client ID / AppKey<input id="dingtalk-clientId" /></label>
              <label>Client Secret / AppSecret<input id="dingtalk-clientSecret" /></label>
              <label>Card template ID<input id="dingtalk-cardTemplateId" placeholder="Optional" /></label>
              <label>Allowed user IDs<textarea id="dingtalk-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
            </article>
          </div>
        </section>
        <section class="section">
          <div class="panel-head"><h2>AI Tooling</h2><div>WeChat is intentionally excluded from this first version.</div></div>
          <article class="panel note">Claude credentials are still read from environment variables or <span class="mono">~/.claude/settings.json</span>. This page manages local bridge config, not Claude account auth.</article>
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
              <label>Permission mode<select id="ai-defaultPermissionMode"><option value="ask">ask</option><option value="accept-edits">accept-edits</option><option value="plan">plan</option><option value="yolo">yolo</option></select></label>
              <label>Hook port<input id="ai-hookPort" type="number" min="1" /></label>
              <label>Log directory<input id="ai-logDir" class="mono" /></label>
              <label>Log level<select id="ai-logLevel"><option value="DEBUG">DEBUG</option><option value="INFO">INFO</option><option value="WARN">WARN</option><option value="ERROR">ERROR</option></select></label>
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
            <button id="startButton">Start service</button>
            <button id="stopButton" class="danger">Stop service</button>
          </div>
          <div class="message" id="message"></div>
        </section>
      </div>
    </div>
    <script>
      const ids = ["telegram-enabled","telegram-botToken","telegram-proxy","telegram-allowedUserIds","feishu-enabled","feishu-appId","feishu-appSecret","feishu-allowedUserIds","wework-enabled","wework-corpId","wework-secret","wework-wsUrl","wework-allowedUserIds","dingtalk-enabled","dingtalk-clientId","dingtalk-clientSecret","dingtalk-cardTemplateId","dingtalk-allowedUserIds","ai-aiCommand","ai-claudeCliPath","ai-claudeWorkDir","ai-claudeSkipPermissions","ai-claudeTimeoutMs","ai-claudeModel","ai-cursorCliPath","ai-codexCliPath","ai-codexProxy","ai-defaultPermissionMode","ai-hookPort","ai-logDir","ai-logLevel","ai-useSdkMode"];
      const el = (id) => document.getElementById(id);
      const setMessage = (text, type="") => { const node = el("message"); node.textContent = text; node.className = ("message " + type).trim(); };
      const setBusy = (busy) => ["validateButton","saveButton","startButton","stopButton"].forEach((id) => { el(id).disabled = busy; });
      function updateVisualState() {
        const enabled = [];
        [["telegram","Telegram"],["feishu","Feishu"],["wework","WeWork"],["dingtalk","DingTalk"]].forEach(([key,label]) => {
          const active = el(key + "-enabled").checked;
          el(key + "-panel").classList.toggle("off", !active);
          if (active) enabled.push(label);
        });
        const aiTool = el("ai-aiCommand").value;
        el("liveSummary").textContent = enabled.length
          ? ("Enabled platforms: " + enabled.join(", ") + " | AI tool: " + aiTool)
          : ("No platform enabled yet | AI tool: " + aiTool);
      }
      const payload = () => ({ platforms: { telegram: { enabled: el("telegram-enabled").checked, botToken: el("telegram-botToken").value, proxy: el("telegram-proxy").value, allowedUserIds: el("telegram-allowedUserIds").value }, feishu: { enabled: el("feishu-enabled").checked, appId: el("feishu-appId").value, appSecret: el("feishu-appSecret").value, allowedUserIds: el("feishu-allowedUserIds").value }, wework: { enabled: el("wework-enabled").checked, corpId: el("wework-corpId").value, secret: el("wework-secret").value, wsUrl: el("wework-wsUrl").value, allowedUserIds: el("wework-allowedUserIds").value }, dingtalk: { enabled: el("dingtalk-enabled").checked, clientId: el("dingtalk-clientId").value, clientSecret: el("dingtalk-clientSecret").value, cardTemplateId: el("dingtalk-cardTemplateId").value, allowedUserIds: el("dingtalk-allowedUserIds").value } }, ai: { aiCommand: el("ai-aiCommand").value, claudeCliPath: el("ai-claudeCliPath").value, claudeWorkDir: el("ai-claudeWorkDir").value, claudeSkipPermissions: el("ai-claudeSkipPermissions").checked, claudeTimeoutMs: Number(el("ai-claudeTimeoutMs").value || "0"), claudeModel: el("ai-claudeModel").value, cursorCliPath: el("ai-cursorCliPath").value, codexCliPath: el("ai-codexCliPath").value, codexProxy: el("ai-codexProxy").value, defaultPermissionMode: el("ai-defaultPermissionMode").value, hookPort: Number(el("ai-hookPort").value || "0"), logDir: el("ai-logDir").value, logLevel: el("ai-logLevel").value, useSdkMode: el("ai-useSdkMode").checked } });
      async function request(path, options={}) { const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Request failed"); return body; }
      function fill(data, meta) { el("configPath").textContent = meta.configPath; el("modeBadge").textContent = "Flow: " + meta.mode; el("telegram-enabled").checked = data.platforms.telegram.enabled; el("telegram-botToken").value = data.platforms.telegram.botToken; el("telegram-proxy").value = data.platforms.telegram.proxy; el("telegram-allowedUserIds").value = data.platforms.telegram.allowedUserIds; el("feishu-enabled").checked = data.platforms.feishu.enabled; el("feishu-appId").value = data.platforms.feishu.appId; el("feishu-appSecret").value = data.platforms.feishu.appSecret; el("feishu-allowedUserIds").value = data.platforms.feishu.allowedUserIds; el("wework-enabled").checked = data.platforms.wework.enabled; el("wework-corpId").value = data.platforms.wework.corpId; el("wework-secret").value = data.platforms.wework.secret; el("wework-wsUrl").value = data.platforms.wework.wsUrl; el("wework-allowedUserIds").value = data.platforms.wework.allowedUserIds; el("dingtalk-enabled").checked = data.platforms.dingtalk.enabled; el("dingtalk-clientId").value = data.platforms.dingtalk.clientId; el("dingtalk-clientSecret").value = data.platforms.dingtalk.clientSecret; el("dingtalk-cardTemplateId").value = data.platforms.dingtalk.cardTemplateId; el("dingtalk-allowedUserIds").value = data.platforms.dingtalk.allowedUserIds; el("ai-aiCommand").value = data.ai.aiCommand; el("ai-claudeCliPath").value = data.ai.claudeCliPath; el("ai-claudeWorkDir").value = data.ai.claudeWorkDir; el("ai-claudeSkipPermissions").checked = data.ai.claudeSkipPermissions; el("ai-claudeTimeoutMs").value = String(data.ai.claudeTimeoutMs); el("ai-claudeModel").value = data.ai.claudeModel; el("ai-cursorCliPath").value = data.ai.cursorCliPath; el("ai-codexCliPath").value = data.ai.codexCliPath; el("ai-codexProxy").value = data.ai.codexProxy; el("ai-defaultPermissionMode").value = data.ai.defaultPermissionMode; el("ai-hookPort").value = String(data.ai.hookPort); el("ai-logDir").value = data.ai.logDir; el("ai-logLevel").value = data.ai.logLevel; el("ai-useSdkMode").checked = data.ai.useSdkMode; updateVisualState(); }
      async function refreshStatus() { const data = await request("/api/service/status"); el("serviceState").textContent = data.running ? ("Service running (pid " + data.pid + ")") : "Service stopped"; el("statusMeta").textContent = data.running ? "Background bridge process is active." : "No background bridge process is active."; }
      async function boot() { setBusy(true); try { const data = await request("/api/config"); fill(data.payload, data.meta); await refreshStatus(); setMessage("Control surface ready.", "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } setInterval(() => { refreshStatus().catch(() => {}); }, 5000); ids.forEach((id) => { const node = el(id); if (node) node.addEventListener("input", updateVisualState); if (node) node.addEventListener("change", updateVisualState); }); }
      async function validate() { setBusy(true); try { const data = await request("/api/config/validate", { method: "POST", body: JSON.stringify(payload()) }); setMessage(data.message, "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } }
      async function save() { setBusy(true); try { const data = await request("/api/config/save?final=1", { method: "POST", body: JSON.stringify(payload()) }); setMessage(data.message, "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } }
      async function startService() { setBusy(true); try { await request("/api/config/save", { method: "POST", body: JSON.stringify(payload()) }); const data = await request("/api/service/start", { method: "POST" }); await refreshStatus(); setMessage(data.message, "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } }
      async function stopService() { setBusy(true); try { const data = await request("/api/service/stop", { method: "POST" }); await refreshStatus(); setMessage(data.message, "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } }
      el("validateButton").onclick = validate; el("saveButton").onclick = save; el("startButton").onclick = startService; el("stopButton").onclick = stopService; boot();
    </script>
  </body>
</html>`;

export async function startWebConfigServer(options: { mode: WebFlowMode; cwd: string }): Promise<StartedWebConfigServer> {
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
          if (requestUrl.searchParams.get("final") === "1") {
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
          json(response, 200, { message: `Background service started with pid ${started.pid}.`, pid: started.pid });
          setTimeout(() => finishFlow("saved"), 120);
        } catch (error) {
          json(response, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/service/stop") {
        try {
          const result = await stopBackgroundService();
          json(response, 200, { message: result.pid ? `Background service stopped (pid ${result.pid}).` : "No background service was running." });
        } catch (error) {
          json(response, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      json(response, 404, { error: "Not found." });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
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

  timer = setTimeout(() => {
    server.close();
    settle("cancel");
  }, 15 * 60 * 1000);

  server.on("close", () => {
    if (timer) clearTimeout(timer);
  });

  return {
    close: async () => {
      if (timer) clearTimeout(timer);
      server.close();
      settle("cancel");
    },
    url: `http://127.0.0.1:${address.port}`,
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
