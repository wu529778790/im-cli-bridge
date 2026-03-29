/**
 * 首次运行时的交互式配置引导（支持增量：保留已有平台配置）
 * 使用 prompts 库，兼容 tsx watch、IDE 终端等环境
 * Telegram Token 使用 readline 避免 Windows 终端 prompts 重绘问题
 */

import prompts from "prompts";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { APP_HOME } from "./constants.js";
import type { Config, Platform } from "./config.js";
import { loadConfig, getPlatformsWithCredentials } from "./config.js";

interface ExistingConfig {
  platforms?: {
    telegram?: { enabled?: boolean; botToken?: string; allowedUserIds?: string[]; proxy?: string };
    feishu?: { enabled?: boolean; appId?: string; appSecret?: string; allowedUserIds?: string[] };
    qq?: { enabled?: boolean; appId?: string; secret?: string; allowedUserIds?: string[] };
    workbuddy?: {
      enabled?: boolean;
      userId?: string;
      allowedUserIds?: string[];
      accessToken?: string;
      refreshToken?: string;
      baseUrl?: string;
    };
    wework?: { enabled?: boolean; corpId?: string; secret?: string; allowedUserIds?: string[] };
    dingtalk?: { enabled?: boolean; clientId?: string; clientSecret?: string; allowedUserIds?: string[]; cardTemplateId?: string };
  };
  env?: Record<string, string>;
  aiCommand?: string;
  tools?: {
    claude?: { cliPath?: string; workDir?: string; timeoutMs?: number; model?: string };
    codex?: { cliPath?: string; workDir?: string; proxy?: string };
    codebuddy?: { cliPath?: string; timeoutMs?: number };
  };
}

function loadExistingConfig(): ExistingConfig | null {
  const configPath = join(APP_HOME, "config.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as ExistingConfig;
  } catch {
    return null;
  }
}

function getConfiguredPlatforms(existing: ExistingConfig | null): string[] {
  if (!existing?.platforms) return [];
  const names: { k: string; label: string }[] = [
    { k: "telegram", label: "Telegram" },
    { k: "qq", label: "QQ" },
    { k: "feishu", label: "飞书" },
    { k: "wework", label: "企业微信" },
    { k: "dingtalk", label: "钉钉" },
    { k: "workbuddy", label: "WorkBuddy (微信)" },
  ];
  return names
    .filter(({ k }) => {
      const p = (existing.platforms as Record<string, unknown>)?.[k] as Record<string, unknown> | undefined;
      if (!p) return false;
      if (k === "telegram") return !!p.botToken;
      if (k === "feishu") return !!(p.appId && p.appSecret);
      if (k === "qq") return !!(p.appId && p.secret);
      if (k === "workbuddy") return !!(p.accessToken && p.refreshToken);
      if (k === "wework") return !!(p.corpId && p.secret);
      if (k === "dingtalk") return !!(p.clientId && p.clientSecret);
      return false;
    })
    .map(({ label }) => label);
}

function question(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function printManualInstructions(configPath: string): void {
  console.log("\n━━━ open-im 首次配置 ━━━\n");
  console.log("当前环境不支持交互输入，请手动创建配置文件：");
  console.log("");
  console.log("  1. 创建目录:", dirname(configPath));
  console.log("  2. 创建文件:", configPath);
  console.log("  3. 填入以下内容（替换为你的 Token/App ID 和用户 ID）：");
  console.log("");
  console.log(`{
  "aiCommand": "claude",
  "tools": {
    "claude": {
      "cliPath": "claude",
      "workDir": "${process.cwd().replace(/\\/g, "/")}",
      "timeoutMs": 600000
    },
    "codex": { "cliPath": "codex", "workDir": "${process.cwd().replace(/\\/g, "/")}", "proxy": "http://127.0.0.1:7890" },
    "codebuddy": { "cliPath": "codebuddy", "timeoutMs": 600000 }
  },
  "platforms": {
    "telegram": {
      "enabled": true,
      "botToken": "你的 Telegram Bot Token（可选）",
      "allowedUserIds": ["允许访问的 Telegram 用户 ID（可选）"]
    },
    "feishu": {
      "enabled": false,
      "appId": "你的飞书 App ID（可选）",
      "appSecret": "你的飞书 App Secret（可选）",
      "allowedUserIds": ["允许访问的飞书用户 ID（可选）"]
    },
    "qq": {
      "enabled": false,
      "aiCommand": "codebuddy",
      "appId": "你的 QQ App ID（可选）",
      "secret": "你的 QQ App Secret（可选）",
      "allowedUserIds": ["允许访问的 QQ 用户 ID（可选）"]
    },
    "wework": {
      "enabled": false,
      "corpId": "你的企业微信 Corp ID（可选）",
      "secret": "你的企业微信 Secret（可选）",
      "allowedUserIds": ["允许访问的企业微信用户 ID（可选）"]
    },
    "dingtalk": {
      "enabled": false,
      "clientId": "你的钉钉 Client ID（可选）",
      "clientSecret": "你的钉钉 Client Secret（可选）",
      "cardTemplateId": "你的钉钉 AI 卡片模板 ID（可选，配置后启用单条流式）",
      "allowedUserIds": ["允许访问的钉钉用户 ID（可选）"]
    },
    "wechat": {
      "enabled": false,
      "workbuddyAccessToken": "（由 open-im init 在浏览器完成 WorkBuddy 登录后自动写入）",
      "workbuddyRefreshToken": "",
      "userId": "",
      "allowedUserIds": ["允许访问的微信用户 ID（可选）"]
    }
  }
}`);
  console.log("");
  console.log("提示：至少需要配置 Telegram、Feishu、QQ、WeChat、WeWork 或 DingTalk 其中一个平台");
  console.log(
    "或设置环境变量: TELEGRAM_BOT_TOKEN=xxx、FEISHU_APP_ID=xxx、QQ_BOT_APPID=xxx、WECHAT_WORKBUDDY_ACCESS_TOKEN=xxx、WEWORK_CORP_ID=xxx 或 DINGTALK_CLIENT_ID=xxx 后再运行",
  );
  console.log("");
}

const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

function loadClaudeSettings(): Record<string, unknown> {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 检查 ~/.claude/settings.json 中是否已有 API Key 或 Auth Token（env 内或顶层） */
function hasClaudeCredsInSettings(): boolean {
  const s = loadClaudeSettings();
  const env = s?.env as Record<string, unknown> | undefined;
  const fromEnv = !!(env?.ANTHROPIC_API_KEY || env?.ANTHROPIC_AUTH_TOKEN);
  const fromTop = !!(s?.ANTHROPIC_API_KEY || s?.ANTHROPIC_AUTH_TOKEN);
  return fromEnv || fromTop;
}

function printManualClaudeInstructions(): void {
  console.log("\n━━━ Claude API 配置 ━━━\n");
  console.log("当前环境不支持交互输入，请手动配置：");
  console.log("");
  console.log("  1. 编辑 ~/.claude/settings.json（与 Claude Code 共用）");
  console.log("  2. 添加 env 字段，例如：");
  console.log("");
  console.log('  { "env": { "ANTHROPIC_API_KEY": "sk-ant-..." } }');
  console.log("");
  console.log("  或使用第三方模型：");
  console.log('  { "env": { "ANTHROPIC_AUTH_TOKEN": "xxx", "ANTHROPIC_BASE_URL": "https://...", "ANTHROPIC_MODEL": "glm-4.7" } }');
  console.log("");
}

/**
 * Claude API 专用配置向导，保存到 ~/.claude/settings.json（与 Claude Code 共用）
 */
export async function runClaudeApiSetup(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    printManualClaudeInstructions();
    return false;
  }

  const existing = loadClaudeSettings();
  const existingEnv = (existing.env as Record<string, string>) || {};

  console.log("\n━━━ Claude API 配置向导 ━━━\n");
  console.log("配置将保存到 ~/.claude/settings.json（Claude Code 配置，与 Claude Code 共用）\n");

  const onCancel = () => {
    console.log("\n已取消配置。");
    process.exit(0);
  };

  const apiTypeResp = await prompts(
    {
      type: "select",
      name: "apiType",
      message: "选择 API 类型",
      choices: [
        { title: "官方 API（Anthropic）", value: "official" },
        { title: "第三方模型 / 自定义 API", value: "thirdparty" },
      ],
      initial: 0,
    },
    { onCancel },
  );

  if (!apiTypeResp.apiType) return false;

  const env: Record<string, string> = { ...existingEnv };

  if (apiTypeResp.apiType === "official") {
    const keyTypeResp = await prompts(
      {
        type: "select",
        name: "keyType",
        message: "选择认证方式",
        choices: [
          { title: "API Key（sk-ant-...）", value: "apikey" },
          { title: "Auth Token（claude setup-token 生成）", value: "token" },
        ],
        initial: 0,
      },
      { onCancel },
    );
    if (!keyTypeResp.keyType) return false;

    if (keyTypeResp.keyType === "apikey") {
      const key = await question("ANTHROPIC_API_KEY: ");
      if (!key.trim()) {
        console.log("API Key 不能为空");
        return false;
      }
      env.ANTHROPIC_API_KEY = key.trim();
      delete env.ANTHROPIC_AUTH_TOKEN;
    } else {
      const token = await question("ANTHROPIC_AUTH_TOKEN: ");
      if (!token.trim()) {
        console.log("Auth Token 不能为空");
        return false;
      }
      env.ANTHROPIC_AUTH_TOKEN = token.trim();
      delete env.ANTHROPIC_API_KEY;
    }
  } else {
    const token = await question("ANTHROPIC_AUTH_TOKEN（第三方模型 Token）: ");
    if (!token.trim()) {
      console.log("Token 不能为空");
      return false;
    }
    const baseUrl = await question("ANTHROPIC_BASE_URL（API 地址）: ");
    if (!baseUrl.trim()) {
      console.log("Base URL 不能为空");
      return false;
    }
    const model = await question("ANTHROPIC_MODEL（模型名称，如 glm-4.7）: ");
    if (!model.trim()) {
      console.log("模型名称不能为空");
      return false;
    }
    env.ANTHROPIC_AUTH_TOKEN = token.trim();
    env.ANTHROPIC_BASE_URL = baseUrl.trim();
    env.ANTHROPIC_MODEL = model.trim();
    delete env.ANTHROPIC_API_KEY;
  }

  const dir = dirname(CLAUDE_SETTINGS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const merged = { ...existing, env };
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(merged, null, 2), "utf-8");
  console.log("\n✓ Claude API 配置已保存到", CLAUDE_SETTINGS_PATH);
  return true;
}

export async function runInteractiveSetup(): Promise<boolean> {
  const configPath = join(APP_HOME, "config.json");
  const forceManual =
    process.argv.includes("--manual") || process.argv.includes("-m");

  if (forceManual || !process.stdin.isTTY) {
    printManualInstructions(configPath);
    return false;
  }

  const existing = loadExistingConfig();
  const configured = getConfiguredPlatforms(existing);

  console.log("\n━━━ open-im 配置向导 ━━━\n");
  console.log("配置将保存到:", configPath);
  if (configured.length > 0) {
    console.log("当前已配置:", configured.join("、"));
    console.log("（本次可追加或修改，未选中的平台配置将保留）");
  }
  console.log("");

  const onCancel = () => {
    console.log("\n已取消配置。");
    process.exit(0);
  };

  const hasTg = !!existing?.platforms?.telegram?.botToken;
  const hasFs = !!(existing?.platforms?.feishu?.appId && existing?.platforms?.feishu?.appSecret);
  const hasQq = !!(existing?.platforms?.qq?.appId && existing?.platforms?.qq?.secret);
  const wc = existing?.platforms?.workbuddy;
  const hasWc = !!(wc?.accessToken && wc?.refreshToken);
  const hasWw = !!(existing?.platforms?.wework?.corpId && existing?.platforms?.wework?.secret);
  const hasDt = !!(existing?.platforms?.dingtalk?.clientId && existing?.platforms?.dingtalk?.clientSecret);

  // 第一步：选择平台（在选项和提示中显示已配置项）
  const configuredHint =
    configured.length > 0 ? `（当前已配置: ${configured.join("、")}）` : "";
  const platformResp = await prompts(
    {
      type: "select",
      name: "platform",
      message: `选择要配置的平台 ${configuredHint}（↑↓ 选择）`,
      choices: [
        {
          title: "Telegram - 需要 Bot Token" + (hasTg ? " ✓已配置" : ""),
          value: "telegram",
        },
        {
          title:
            "飞书 (Feishu/Lark) - 需要 App ID 和 App Secret" +
            (hasFs ? " ✓已配置" : ""),
          value: "feishu",
        },
        {
          title: "QQ Bot - App ID + Secret" + (hasQq ? " configured" : ""),
          value: "qq",
        },
        {
          title:
            "企业微信 (WeCom/WeWork) - 需要 Bot ID 和 Secret" +
            (hasWw ? " ✓已配置" : ""),
          value: "wework",
        },
        {
          title:
            "钉钉 (DingTalk) - 需要 Client ID 和 Client Secret" +
            (hasDt ? " ✓已配置" : ""),
          value: "dingtalk",
        },
        {
          title:
            "WorkBuddy 微信客服 (WeChat KF)" +
            (hasWc ? " ✓已配置" : ""),
          value: "workbuddy",
        },
        { title: "配置多个平台", value: "multi" },
      ],
      initial: 0,
    },
    { onCancel },
  );

  if (!platformResp.platform) {
    return false;
  }

  const platform = platformResp.platform;
  const config: Record<string, unknown> = { platforms: {} };

  // 第二步：选择要配置的多个平台（如果选择了 multi）
  let selectedPlatforms: string[] = [];
  if (platform === "multi") {
    const multiResp = await prompts(
      {
        type: "multiselect",
        name: "platforms",
        message: "选择要配置的平台（空格选择，回车确认）",
        choices: [
          { title: "Telegram" + (hasTg ? " ✓已配置" : ""), value: "telegram", selected: hasTg },
          { title: "飞书 (Feishu)" + (hasFs ? " ✓已配置" : ""), value: "feishu", selected: hasFs },
          { title: "企业微信 (WeWork)" + (hasWw ? " ✓已配置" : ""), value: "wework", selected: hasWw },
          { title: "钉钉 (DingTalk)" + (hasDt ? " ✓已配置" : ""), value: "dingtalk", selected: hasDt },
          { title: "WorkBuddy 微信客服 (WeChat KF)" + (hasWc ? " ✓已配置" : ""), value: "workbuddy", selected: hasWc },
        ],
      },
      { onCancel },
    );
    if (!multiResp.platforms || multiResp.platforms.length === 0) {
      console.log("至少需要选择一个平台");
      return false;
    }
    selectedPlatforms = multiResp.platforms;
  } else {
    selectedPlatforms = [platform];
  }

  // 收集平台配置（Telegram 用 readline 避免 Windows 下 prompts 重绘/重复行问题）
  if (selectedPlatforms.includes("telegram")) {
    const hint = hasTg ? "（留空保留现有）" : "";
    const token = await question(`Telegram Bot Token（从 @BotFather 获取）${hint}: `);
    if (token) {
      config.telegramBotToken = token;
    } else if (hasTg) {
      config.telegramBotToken = existing!.platforms!.telegram!.botToken;
    } else if (platform === "telegram") {
      console.log("Token 不能为空");
      return false;
    }
  }

  if (selectedPlatforms.includes("feishu")) {
    const feishuResp = await prompts(
      [
        {
          type: "text",
          name: "appId",
          message: "飞书 App ID（从飞书开放平台获取）",
          initial: existing?.platforms?.feishu?.appId ?? "",
          validate: (v: string) => (v.trim() ? true : "App ID 不能为空"),
        },
        {
          type: "text",
          name: "appSecret",
          message: "飞书 App Secret（从飞书开放平台获取）",
          initial: existing?.platforms?.feishu?.appSecret ?? "",
          validate: (v: string) => (v.trim() ? true : "App Secret 不能为空"),
        },
      ],
      { onCancel },
    );

    const fsAppId = feishuResp.appId?.trim() || existing?.platforms?.feishu?.appId;
    const fsAppSecret = feishuResp.appSecret?.trim() || existing?.platforms?.feishu?.appSecret;
    if (fsAppId && fsAppSecret) {
      (config.platforms as ExistingConfig["platforms"])!.feishu = {
        ...(config.platforms as ExistingConfig["platforms"])?.feishu,
        enabled: true,
        appId: fsAppId,
        appSecret: fsAppSecret,
      };
    } else if (platform === "feishu") {
      return false;
    }
  }

  if (selectedPlatforms.includes("qq")) {
    const qqResp = await prompts(
      [
        {
          type: "text",
          name: "appId",
          message: "QQ Bot App ID",
          initial: existing?.platforms?.qq?.appId ?? "",
          validate: (v: string) => (v.trim() ? true : "App ID 不能为空"),
        },
        {
          type: "text",
          name: "secret",
          message: "QQ Bot Secret",
          initial: existing?.platforms?.qq?.secret ?? "",
          validate: (v: string) => (v.trim() ? true : "Secret 不能为空"),
        },
      ],
      { onCancel },
    );

    const qqAppId = qqResp.appId?.trim() || existing?.platforms?.qq?.appId;
    const qqSecret = qqResp.secret?.trim() || existing?.platforms?.qq?.secret;
    if (qqAppId && qqSecret) {
      (config.platforms as Record<string, unknown>).qq = {
        enabled: true,
        appId: qqAppId,
        secret: qqSecret,
        
      };
    } else if (platform === "qq") {
      return false;
    }
  }

  if (selectedPlatforms.includes("workbuddy")) {
    const wb = existing?.platforms?.workbuddy as Record<string, unknown> | undefined;
    const hasWbCreds = !!(wb?.accessToken && wb?.refreshToken);

    const wbModeResp = await prompts(
      {
        type: "select",
        name: "mode",
        message: "WorkBuddy 微信客服（CodeBuddy OAuth）",
        choices: [
          {
            title: "在浏览器中完成 CodeBuddy 登录并绑定微信客服（推荐）",
            value: "oauth",
          },
          {
            title: "使用已有 WorkBuddy 凭证" + (hasWbCreds ? " ✓" : ""),
            value: "keep",
            disabled: !hasWbCreds,
          },
        ],
        initial: hasWbCreds ? 1 : 0,
      },
      { onCancel }
    );

    if (wbModeResp.mode === "oauth") {
      console.log("\n正在启动 WorkBuddy OAuth 登录...\n");

      // Phase 1: OAuth token acquisition (fatal if fails)
      let oauthOk = false;
      try {
        const { WorkBuddyOAuth } = await import("./workbuddy/oauth.js");
        const oauth = new WorkBuddyOAuth();

        console.log("步骤 1/3: 获取登录链接...");
        const { authUrl, state } = await oauth.fetchAuthState();

        console.log("\n请在浏览器中打开以下链接完成登录：");
        console.log(authUrl);
        console.log("\n等待登录完成（最长 5 分钟）...\n");

        const tokenResult = await oauth.pollToken(state);

        console.log("✅ 登录成功！ 正在获取账号信息...");

        let accountInfo: Record<string, unknown> = {};
        try {
          accountInfo = await oauth.getAccount(state);
        } catch {
          // account info is optional
        }

        const userId = ((accountInfo as Record<string, unknown>)?.uid as string)?.toString() ?? "";

        // Set oauth.userId so buildSessionId() produces the correct sessionId.
        oauth.userId = userId;

        // Save credentials immediately — even if binding fails below
        (config.platforms as Record<string, unknown>).workbuddy = {
          enabled: true,
          accessToken: tokenResult.accessToken,
          refreshToken: tokenResult.refreshToken,
          userId,
        };

        oauthOk = true;
        console.log("\n✅ WorkBuddy 凭证已获取，正在生成微信客服绑定链接...");

        // Phase 2: WeChat KF binding (non-fatal)
        try {
          const sessionId = oauth.buildSessionId();
          const linkResult = await oauth.getWeChatKfLink(sessionId);
          if (linkResult.success && linkResult.url) {
            console.log("\n━━━ 微信客服绑定 ━━━");
            console.log("请复制以下链接，在微信中发给「文件传输助手」并点击打开：");
            console.log(linkResult.url);
            console.log("\n等待绑定完成（最长 5 分钟）...\n");

            const bindResult = await oauth.pollBindStatus(sessionId);
            if (bindResult.bound) {
              console.log(`✅ 微信客服绑定成功！${bindResult.nickname ? ` 用户: ${bindResult.nickname}` : ""}`);
            } else {
              console.log("⚠️ 绑定超时，你可以稍后重新运行 open-im init 完成绑定");
            }
          } else {
            console.log(`⚠️ 获取微信客服链接失败: ${linkResult.message ?? "未知错误"}`);
            console.log("   凭证已保存，稍后重新运行 open-im init 可重试绑定");
          }
        } catch (bindErr) {
          const cause = (bindErr as NodeJS.ErrnoException)?.cause ?? (bindErr as NodeJS.ErrnoException)?.code;
          const detail = cause ? ` (${cause})` : "";
          console.log(`⚠️ 获取微信客服绑定链接网络失败: ${bindErr instanceof Error ? bindErr.message : String(bindErr)}${detail}`);
          console.log("   凭证已保存，稍后重新运行 open-im init 可重试绑定");
        }

        console.log("\n✅ WorkBuddy 登录成功，配置已保存");
      } catch (err) {
        const cause = (err as NodeJS.ErrnoException)?.cause ?? (err as NodeJS.ErrnoException)?.code;
        const detail = cause ? ` (${cause})` : "";
        console.error(`\n❌ WorkBuddy 登录失败: ${err instanceof Error ? err.message : String(err)}${detail}`);
        if (!oauthOk && platform === "workbuddy") return false;
      }
    } else if (hasWbCreds) {
      (config.platforms as Record<string, unknown>).workbuddy = {
        ...wb,
        enabled: true,
      };
      // Also (re-)generate the WeChat KF binding link with existing credentials
      try {
        const { WorkBuddyOAuth } = await import("./workbuddy/oauth.js");
        const oauthKeep = new WorkBuddyOAuth(wb?.baseUrl as string | undefined);
        oauthKeep.loadCredentials({
          accessToken: wb?.accessToken as string ?? '',
          refreshToken: wb?.refreshToken as string ?? '',
          userId: wb?.userId as string ?? '',
        });
        oauthKeep.userId = wb?.userId as string ?? '';
        const sessionId = oauthKeep.buildSessionId();
        console.log(`\n正在获取微信客服绑定链接... (sessionId: ${sessionId})`);
        const linkResult = await oauthKeep.getWeChatKfLink(sessionId);
        if (linkResult.success && linkResult.url) {
          console.log("\n━━━ 微信客服绑定 ━━━");
          console.log("请复制以下链接，在微信中发给「文件传输助手」并点击打开：");
          console.log(linkResult.url);
          console.log("\n等待绑定完成（最长 5 分钟）...\n");
          const bindResult = await oauthKeep.pollBindStatus(sessionId);
          if (bindResult.bound) {
            console.log(`✅ 微信客服绑定成功！${bindResult.nickname ? ` 用户: ${bindResult.nickname}` : ""}`);
          } else {
            console.log("⚠️ 绑定超时，你可以稍后重新运行 open-im init 完成绑定");
          }
        } else {
          console.log(`⚠️ 获取绑定链接失败: ${linkResult.message ?? "未知"}`);
        }
      } catch (keepErr) {
        const cause = (keepErr as NodeJS.ErrnoException)?.cause ?? (keepErr as NodeJS.ErrnoException)?.code;
        console.log(`⚠️ 绑定链接请求失败: ${keepErr instanceof Error ? keepErr.message : String(keepErr)}${cause ? ` (${cause})` : ""}`);
        console.log("   稍后重新运行 open-im init 可重试");
      }
    } else if (platform === "workbuddy") {
      return false;
    }
  }

  if (selectedPlatforms.includes("wework")) {
    const weworkResp = await prompts(
      [
        {
          type: "text",
          name: "corpId",
          message: "企业微信 Bot ID（从企业微信管理后台获取）",
          initial: existing?.platforms?.wework?.corpId ?? "",
          validate: (v: string) => (v.trim() ? true : "Bot ID 不能为空"),
        },
        {
          type: "text",
          name: "secret",
          message: "企业微信 Secret（从企业微信管理后台获取）",
          initial: existing?.platforms?.wework?.secret ?? "",
          validate: (v: string) => (v.trim() ? true : "Secret 不能为空"),
        },
      ],
      { onCancel },
    );

    const wwCorpId = weworkResp.corpId?.trim() || existing?.platforms?.wework?.corpId;
    const wwSecret = weworkResp.secret?.trim() || existing?.platforms?.wework?.secret;
    if (wwCorpId && wwSecret) {
      (config.platforms as ExistingConfig["platforms"])!.wework = {
        enabled: true,
        corpId: wwCorpId,
        secret: wwSecret,
      };
    } else if (platform === "wework") {
      return false;
    }
  }

  if (selectedPlatforms.includes("dingtalk")) {
    const dingtalkResp = await prompts(
      [
        {
          type: "text",
          name: "clientId",
          message: "钉钉 Client ID / AppKey（从钉钉开放平台获取）",
          initial: existing?.platforms?.dingtalk?.clientId ?? "",
          validate: (v: string) => (v.trim() ? true : "Client ID 不能为空"),
        },
        {
          type: "text",
          name: "clientSecret",
          message: "钉钉 Client Secret / AppSecret（从钉钉开放平台获取）",
          initial: existing?.platforms?.dingtalk?.clientSecret ?? "",
          validate: (v: string) => (v.trim() ? true : "Client Secret 不能为空"),
        },
        {
          type: "text",
          name: "cardTemplateId",
          message: "钉钉 AI 卡片模板 ID（可选，配置后启用单条流式）",
          initial: existing?.platforms?.dingtalk?.cardTemplateId ?? "",
        },
      ],
      { onCancel },
    );

    const dtClientId = dingtalkResp.clientId?.trim() || existing?.platforms?.dingtalk?.clientId;
    const dtClientSecret = dingtalkResp.clientSecret?.trim() || existing?.platforms?.dingtalk?.clientSecret;
    const dtCardTemplateId = dingtalkResp.cardTemplateId?.trim() || existing?.platforms?.dingtalk?.cardTemplateId;
    if (dtClientId && dtClientSecret) {
      (config.platforms as ExistingConfig["platforms"])!.dingtalk = {
        enabled: true,
        clientId: dtClientId,
        clientSecret: dtClientSecret,
        cardTemplateId: dtCardTemplateId,
      };
    } else if (platform === "dingtalk") {
      return false;
    }
  }

  // 通用配置：只询问所选平台的白名单，未选平台沿用已有配置
  const tgIds = existing?.platforms?.telegram?.allowedUserIds?.join(", ") ?? "";
  const fsIds = existing?.platforms?.feishu?.allowedUserIds?.join(", ") ?? "";
  const qqIds = existing?.platforms?.qq?.allowedUserIds?.join(", ") ?? "";
  const wcIds = existing?.platforms?.workbuddy?.allowedUserIds?.join(", ") ?? "";
  const wwIds = existing?.platforms?.wework?.allowedUserIds?.join(", ") ?? "";
  const dtIds = existing?.platforms?.dingtalk?.allowedUserIds?.join(", ") ?? "";
  const aiIdx = ["claude", "codex", "codebuddy"].indexOf(existing?.aiCommand ?? "claude");

  const commonPrompts: prompts.PromptObject[] = [];
  if (selectedPlatforms.includes("qq")) {
    commonPrompts.push({
      type: "text",
      name: "qqAllowedUserIds",
      message: "QQ allowed user IDs (optional, comma-separated, empty means allow all)",
      initial: qqIds,
    });
  }
  if (selectedPlatforms.includes("telegram")) {
    commonPrompts.push({
      type: "text",
      name: "telegramAllowedUserIds",
      message: "Telegram 白名单用户 ID（可选，逗号分隔，留空=所有人可访问）",
      initial: tgIds,
    });
  }
  if (selectedPlatforms.includes("feishu")) {
    commonPrompts.push({
      type: "text",
      name: "feishuAllowedUserIds",
      message: "飞书白名单用户 ID（可选，逗号分隔，留空=所有人可访问）",
      initial: fsIds,
    });
  }
  if (selectedPlatforms.includes("workbuddy")) {
    commonPrompts.push({
      type: "text",
      name: "workbuddyAllowedUserIds",
      message: "WorkBuddy 白名单用户 ID（可选，逗号分隔，留空=所有人可访问）",
      initial: wcIds,
    });
  }
  if (selectedPlatforms.includes("wework")) {
    commonPrompts.push({
      type: "text",
      name: "weworkAllowedUserIds",
      message: "企业微信白名单用户 ID（可选，逗号分隔，留空=所有人可访问）",
      initial: wwIds,
    });
  }
  if (selectedPlatforms.includes("dingtalk")) {
    commonPrompts.push({
      type: "text",
      name: "dingtalkAllowedUserIds",
      message: "钉钉白名单用户 ID（可选，逗号分隔，留空=所有人可访问）",
      initial: dtIds,
    });
  }
  commonPrompts.push(
    {
      type: "select",
      name: "aiCommand",
      message: "AI 工具（↑↓ 选择）",
      choices: [
        { title: "claude-code", value: "claude" },
        { title: "codex", value: "codex" },
        { title: "codebuddy", value: "codebuddy" },
      ],
      initial: aiIdx >= 0 ? aiIdx : 0,
    },
    {
      type: "text",
      name: "workDir",
      message: "工作目录",
      initial: existing?.tools?.claude?.workDir ?? process.cwd(),
    },
  );

  const commonResp = await prompts(commonPrompts, { onCancel });
  const codexProxyResp =
    commonResp.aiCommand === "codex"
      ? await prompts(
          {
            type: "text",
            name: "codexProxy",
            message: "Codex 代理（可选，如 http://127.0.0.1:7890）",
            initial: existing?.tools?.codex?.proxy ?? "",
          },
          { onCancel }
        )
      : {};

  // 如果选择 Claude，询问 API 配置
  let claudeApiConfig: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    haikuModel?: string;
    sonnetModel?: string;
    opusModel?: string;
  } = {};
  if (commonResp.aiCommand === "claude") {
    // 检查是否已配置 API 密钥（环境变量、open-im config、或 ~/.claude/settings.json）
    const hasExistingApiKey = !!(
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN ||
      existing?.env?.ANTHROPIC_API_KEY ||
      existing?.env?.ANTHROPIC_AUTH_TOKEN ||
      hasClaudeCredsInSettings()
    );

    if (hasExistingApiKey) {
      // 已经配置过，直接保留原有配置，跳过询问
      if (existing?.env) {
        claudeApiConfig = {
          apiKey: existing.env.ANTHROPIC_API_KEY || existing.env.ANTHROPIC_AUTH_TOKEN,
          baseUrl: existing.env.ANTHROPIC_BASE_URL,
          model: existing.env.ANTHROPIC_MODEL,
          haikuModel: existing.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
          sonnetModel: existing.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
          opusModel: existing.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
        };
      }
    } else {
      // 没有配置过，引导用户配置
      console.log('');
      console.log('━━━ Claude API 配置 ━━━');
      console.log('提示：以下配置均为可选，留空将使用默认值');
      console.log('');

      const apiResp = await prompts(
      [
        {
          type: "text",
          name: "apiKey",
          message: "API Key / Auth Token（回车跳过，稍后手动配置）",
          initial: "",
        },
        {
          type: "text",
          name: "baseUrl",
          message: "Base URL（回车跳过，使用官方 API）",
          initial: "",
        },
        {
          type: "text",
          name: "model",
          message: "默认模型（回车跳过）",
          initial: "",
        },
        {
          type: "text",
          name: "haikuModel",
          message: "Haiku 模型（回车跳过）",
          initial: "",
        },
        {
          type: "text",
          name: "sonnetModel",
          message: "Sonnet 模型（回车跳过）",
          initial: "",
        },
        {
          type: "text",
          name: "opusModel",
          message: "Opus 模型（回车跳过）",
          initial: "",
        },
      ],
      { onCancel }
    );
    claudeApiConfig = apiResp;
    }
  }

  const parseIds = (value: string | undefined): string[] =>
    value
      ? value
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [];

  // 分平台白名单：已询问的用输入值，未询问的用已有配置
  const telegramIds = selectedPlatforms.includes("telegram")
    ? parseIds(commonResp.telegramAllowedUserIds)
    : parseIds(existing?.platforms?.telegram?.allowedUserIds?.join(", "));
  const feishuIds = selectedPlatforms.includes("feishu")
    ? parseIds(commonResp.feishuAllowedUserIds)
    : parseIds(existing?.platforms?.feishu?.allowedUserIds?.join(", "));
  const qqIdsFinal = selectedPlatforms.includes("qq")
    ? parseIds(commonResp.qqAllowedUserIds)
    : parseIds(existing?.platforms?.qq?.allowedUserIds?.join(", "));
  const workbuddyIds = selectedPlatforms.includes("workbuddy")
    ? parseIds(commonResp.workbuddyAllowedUserIds)
    : parseIds(existing?.platforms?.workbuddy?.allowedUserIds?.join(", "));
  const weworkIds = selectedPlatforms.includes("wework")
    ? parseIds(commonResp.weworkAllowedUserIds)
    : parseIds(existing?.platforms?.wework?.allowedUserIds?.join(", "));
  const dingtalkIds = selectedPlatforms.includes("dingtalk")
    ? parseIds(commonResp.dingtalkAllowedUserIds)
    : parseIds(existing?.platforms?.dingtalk?.allowedUserIds?.join(", "));

  // 增量合并：以已有配置为底，只覆盖本次选中的平台（不写入根级旧字段 telegramBotToken 等）
  const base = existing
    ? (JSON.parse(JSON.stringify(existing)) as ExistingConfig)
    : null;
  const {
    telegramBotToken: _,
    feishuAppId: __,
    feishuAppSecret: ___,
    claudeWorkDir: _cwd,
    claudeTimeoutMs: _ctm,
    claudeModel: _cm,
    ...baseRest
  } = (base ?? {}) as Record<string, unknown>;

  // Claude API 凭证不存入 config.json，仅从 ~/.claude/settings.json 或环境变量读取
  const ANTHROPIC_KEYS = [
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL",
  ];
  const envConfig: Record<string, string> = {};
  for (const [k, v] of Object.entries(base?.env ?? {})) {
    if (v != null && typeof v === "string" && !ANTHROPIC_KEYS.includes(k)) {
      envConfig[k] = v;
    }
  }
  // 若用户在向导中输入了 Claude 配置，写入 ~/.claude/settings.json（与 Claude Code 共用）
  if (claudeApiConfig.apiKey || claudeApiConfig.baseUrl || claudeApiConfig.model) {
    const claudeExisting = loadClaudeSettings();
    const claudeEnv: Record<string, string> = { ...((claudeExisting.env ?? {}) as Record<string, string>) };
    if (claudeApiConfig.apiKey?.trim()) {
      const key = claudeApiConfig.apiKey.trim();
      if (key.startsWith("sk-")) {
        claudeEnv.ANTHROPIC_API_KEY = key;
        delete claudeEnv.ANTHROPIC_AUTH_TOKEN;
      } else {
        claudeEnv.ANTHROPIC_AUTH_TOKEN = key;
        delete claudeEnv.ANTHROPIC_API_KEY;
      }
    }
    if (claudeApiConfig.baseUrl?.trim()) claudeEnv.ANTHROPIC_BASE_URL = claudeApiConfig.baseUrl.trim();
    if (claudeApiConfig.model?.trim()) claudeEnv.ANTHROPIC_MODEL = claudeApiConfig.model.trim();
    if (claudeApiConfig.haikuModel?.trim()) claudeEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = claudeApiConfig.haikuModel.trim();
    if (claudeApiConfig.sonnetModel?.trim()) claudeEnv.ANTHROPIC_DEFAULT_SONNET_MODEL = claudeApiConfig.sonnetModel.trim();
    if (claudeApiConfig.opusModel?.trim()) claudeEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = claudeApiConfig.opusModel.trim();
    const claudeDir = dirname(CLAUDE_SETTINGS_PATH);
    if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
    writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify({ ...claudeExisting, env: claudeEnv }, null, 2), "utf-8");
    console.log("\n✓ Claude API 配置已保存到", CLAUDE_SETTINGS_PATH);
  }

  const workDir = (commonResp.workDir || process.cwd()).trim();
  const aiCmd = commonResp.aiCommand ?? base?.aiCommand ?? "claude";
  const baseTools = base?.tools ?? {};

  const out: Record<string, unknown> = {
    ...baseRest,
    platforms: { ...(base?.platforms ?? {}) },
    env: Object.keys(envConfig).length > 0 ? envConfig : undefined,
    aiCommand: aiCmd,
    tools: {
      claude: {
        ...baseTools.claude,
        cliPath: baseTools.claude?.cliPath ?? "claude",
        workDir,
        timeoutMs: baseTools.claude?.timeoutMs ?? 600000,
      },
      codex: {
        ...baseTools.codex,
        cliPath: baseTools.codex?.cliPath ?? "codex",
        workDir: workDir,
        proxy:
          commonResp.aiCommand === "codex"
            ? (codexProxyResp as { codexProxy?: string }).codexProxy?.trim() || undefined
            : baseTools.codex?.proxy,
      },
      codebuddy: {
        ...baseTools.codebuddy,
        cliPath: baseTools.codebuddy?.cliPath ?? "codebuddy",
        timeoutMs: baseTools.codebuddy?.timeoutMs ?? 600000,
      },
    },
  };

  type Platforms = NonNullable<ExistingConfig["platforms"]>;
  const outPlatforms = out.platforms as Platforms;
  const configPlatforms = config.platforms as Platforms | undefined;
  const basePlatforms = base?.platforms;

  if (selectedPlatforms.includes("telegram")) {
    outPlatforms.telegram = {
      ...basePlatforms?.telegram,
      enabled: true,
      botToken: (config as { telegramBotToken?: string }).telegramBotToken ?? basePlatforms?.telegram?.botToken,
      allowedUserIds: telegramIds,
    };
  } else if (basePlatforms?.telegram) {
    outPlatforms.telegram = {
      ...basePlatforms.telegram,
      allowedUserIds: telegramIds.length > 0 ? telegramIds : basePlatforms.telegram.allowedUserIds ?? [],
    };
  } else {
    outPlatforms.telegram = { enabled: false, allowedUserIds: telegramIds };
  }

  if (selectedPlatforms.includes("feishu")) {
    outPlatforms.feishu = {
      ...basePlatforms?.feishu,
      enabled: true,
      appId: configPlatforms?.feishu?.appId,
      appSecret: configPlatforms?.feishu?.appSecret,
      allowedUserIds: feishuIds,
    };
  } else if (basePlatforms?.feishu) {
    outPlatforms.feishu = {
      ...basePlatforms.feishu,
      allowedUserIds: feishuIds.length > 0 ? feishuIds : basePlatforms.feishu.allowedUserIds ?? [],
    };
  } else {
    outPlatforms.feishu = { enabled: false, allowedUserIds: feishuIds };
  }

  if (selectedPlatforms.includes("qq")) {
    outPlatforms.qq = {
      ...basePlatforms?.qq,
      enabled: true,
      appId: configPlatforms?.qq?.appId,
      secret: configPlatforms?.qq?.secret,
      allowedUserIds: qqIdsFinal,
    };
  } else if (basePlatforms?.qq) {
    outPlatforms.qq = {
      ...basePlatforms.qq,
      allowedUserIds: qqIdsFinal.length > 0 ? qqIdsFinal : basePlatforms.qq.allowedUserIds ?? [],
    };
  } else {
    outPlatforms.qq = { enabled: false, allowedUserIds: qqIdsFinal };
  }

  if (selectedPlatforms.includes("workbuddy")) {
    const wbConfig = (config.platforms as Record<string, unknown>)?.workbuddy as Record<string, unknown> | undefined;
    const baseWb = base?.platforms?.workbuddy as Record<string, unknown> | undefined;
    const wbOut: Record<string, unknown> = {
      enabled: true,
      accessToken: wbConfig?.accessToken ?? baseWb?.accessToken,
      refreshToken: wbConfig?.refreshToken ?? baseWb?.refreshToken,
      userId: wbConfig?.userId ?? baseWb?.userId ?? "",
      allowedUserIds: workbuddyIds,
    };
    const wbBaseUrl = wbConfig?.baseUrl ?? baseWb?.baseUrl;
    if (wbBaseUrl) wbOut.baseUrl = wbBaseUrl;
    (out.platforms as Record<string, unknown>).workbuddy = wbOut;
  } else if (basePlatforms?.workbuddy) {
    outPlatforms.workbuddy = {
      ...basePlatforms.workbuddy,
      allowedUserIds: workbuddyIds.length > 0 ? workbuddyIds : basePlatforms.workbuddy.allowedUserIds ?? [],
    };
  } else {
    outPlatforms.workbuddy = { enabled: false, allowedUserIds: workbuddyIds };
  }

  if (selectedPlatforms.includes("wework")) {
    outPlatforms.wework = {
      ...basePlatforms?.wework,
      enabled: true,
      corpId: configPlatforms?.wework?.corpId,
      secret: configPlatforms?.wework?.secret,
      allowedUserIds: weworkIds,
    };
  } else if (basePlatforms?.wework) {
    outPlatforms.wework = {
      ...basePlatforms.wework,
      allowedUserIds: weworkIds.length > 0 ? weworkIds : basePlatforms.wework.allowedUserIds ?? [],
    };
  } else {
    outPlatforms.wework = { enabled: false, allowedUserIds: weworkIds };
  }

  if (selectedPlatforms.includes("dingtalk")) {
    outPlatforms.dingtalk = {
      ...basePlatforms?.dingtalk,
      enabled: true,
      clientId: configPlatforms?.dingtalk?.clientId,
      clientSecret: configPlatforms?.dingtalk?.clientSecret,
      cardTemplateId: configPlatforms?.dingtalk?.cardTemplateId,
      allowedUserIds: dingtalkIds,
    };
  } else if (basePlatforms?.dingtalk) {
    outPlatforms.dingtalk = {
      ...basePlatforms.dingtalk,
      allowedUserIds: dingtalkIds.length > 0 ? dingtalkIds : basePlatforms.dingtalk.allowedUserIds ?? [],
    };
  } else {
    outPlatforms.dingtalk = { enabled: false, allowedUserIds: dingtalkIds };
  }

  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(out, null, 2), "utf-8");

  console.log("\n✅ 配置已保存到", configPath);
  console.log("");
  return true;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  telegram: "Telegram",
  qq: "QQ",
  feishu: "飞书",
  wework: "企业微信",
  dingtalk: "钉钉",
  workbuddy: "WorkBuddy 微信客服",
};

const ALL_PLATFORMS: Platform[] = ["telegram", "feishu", "qq", "wework", "dingtalk", "workbuddy"];

/**
 * 启动时让用户选择要启用的平台（无论单通道还是多通道）
 * 显示全部 4 个平台，已配置的预选；若用户选择未配置的，引导运行 init
 * @returns 更新后的 config，或 null 表示取消
 */
export async function runPlatformSelectionPrompt(
  config: Config,
): Promise<Config | null> {
  const withCreds = new Set(getPlatformsWithCredentials(config));
  const configPath = join(APP_HOME, "config.json");
  const existing = loadExistingConfig();

  const choices = ALL_PLATFORMS.map((p) => {
    const hasCreds = withCreds.has(p);
    const isEnabled = config.enabledPlatforms.includes(p);
    const suffix = hasCreds
      ? (isEnabled ? " ✓已配置且启用" : " ✓已配置")
      : "（未配置）";
    return {
      title: `${PLATFORM_LABELS[p]}${suffix}`,
      value: p,
      selected: isEnabled && hasCreds,
    };
  });

  console.log("\n━━━ 选择要启用的平台 ━━━\n");
  const resp = await prompts(
    {
      type: "multiselect",
      name: "platforms",
      message: "选择要启用的平台（空格切换，回车确认）",
      choices,
      hint: "未配置的平台需先运行 open-im init",
    },
    {
      onCancel: () => {
        console.log("\n已取消启动。");
        process.exit(0);
      },
    },
  );

  if (!resp.platforms || !Array.isArray(resp.platforms)) return null;

  const selected = new Set(resp.platforms as Platform[]);
  const selectedUnconfigured = ALL_PLATFORMS.filter(
    (p) => selected.has(p) && !withCreds.has(p),
  );

  if (selectedUnconfigured.length > 0) {
    console.log("");
    console.log(
      "您选择了 " +
        selectedUnconfigured.map((p) => PLATFORM_LABELS[p]).join("、") +
        "，但这些平台尚未配置。",
    );
    console.log("请运行 open-im init 进行配置，配置完成后再次启动。");
    console.log("");
    const runNow = await prompts(
      {
        type: "confirm",
        name: "run",
        message: "是否现在运行配置向导？",
        initial: true,
      },
      { onCancel: () => process.exit(0) },
    );
    if (runNow.run) {
      const saved = await runInteractiveSetup();
      if (saved) {
        console.log("\n配置完成，请再次运行 open-im start 或 open-im dev 启动。");
      }
    }
    process.exit(0);
  }

  // 至少需要 1 个已配置的平台被选中
  const selectedWithCreds = ALL_PLATFORMS.filter(
    (p) => selected.has(p) && withCreds.has(p),
  );
  if (selectedWithCreds.length === 0) {
    console.log("\n请至少选择 1 个已配置的平台，或运行 open-im init 添加配置。");
    return null;
  }

  // 更新 config.json 中的 platforms.xxx.enabled
  const updated = { ...existing } as ExistingConfig;
  if (!updated.platforms) updated.platforms = {};

  for (const p of ALL_PLATFORMS) {
    const plat = (updated.platforms as Record<string, unknown>)[p] ?? {};
    (updated.platforms as Record<string, unknown>)[p] = {
      ...plat,
      enabled: selected.has(p) && withCreds.has(p),
    };
  }

  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf-8");

  return loadConfig();
}
