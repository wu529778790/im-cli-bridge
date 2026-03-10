/**
 * 首次运行时的交互式配置引导（支持增量：保留已有平台配置）
 * 使用 prompts 库，兼容 tsx watch、IDE 终端等环境
 * Telegram Token 使用 readline 避免 Windows 终端 prompts 重绘问题
 */

import prompts from "prompts";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { APP_HOME } from "./constants.js";

interface ExistingConfig {
  platforms?: {
    telegram?: { enabled?: boolean; botToken?: string; allowedUserIds?: string[]; proxy?: string };
    feishu?: { enabled?: boolean; appId?: string; appSecret?: string; allowedUserIds?: string[] };
    wechat?: {
      enabled?: boolean;
      appId?: string;
      appSecret?: string;
      token?: string;
      jwtToken?: string;
      loginKey?: string;
      guid?: string;
      userId?: string;
      wsUrl?: string;
      allowedUserIds?: string[];
    };
    wework?: { enabled?: boolean; corpId?: string; agentId?: string; secret?: string; allowedUserIds?: string[] };
  };
  claudeWorkDir?: string;
  claudeSkipPermissions?: boolean;
  aiCommand?: string;
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
    { k: "feishu", label: "飞书" },
    { k: "wechat", label: "微信" },
    { k: "wework", label: "企业微信" },
  ];
  return names
    .filter(({ k }) => {
      const p = (existing.platforms as Record<string, unknown>)?.[k] as Record<string, unknown> | undefined;
      if (!p) return false;
      if (k === "telegram") return !!p.botToken;
      if (k === "feishu") return !!(p.appId && p.appSecret);
      // 微信支持 AGP 协议（token + guid + userId）或标准协议（appId + appSecret）
      if (k === "wechat") return !!(p.token && p.guid && p.userId) || !!(p.appId && p.appSecret);
      if (k === "wework") return !!(p.corpId && p.agentId && p.secret);
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
    "wechat": {
      "enabled": false,
      "appId": "你的微信 App ID（可选）",
      "appSecret": "你的微信 App Secret（可选）",
      "wsUrl": "AGP WebSocket URL（可选，默认使用官方服务）",
      "allowedUserIds": ["允许访问的微信用户 ID（可选）"]
    },
    "wework": {
      "enabled": false,
      "corpId": "你的企业微信 Corp ID（可选）",
      "agentId": "你的企业微信 Agent ID（可选）",
      "secret": "你的企业微信 Secret（可选）",
      "allowedUserIds": ["允许访问的企业微信用户 ID（可选）"]
    }
  },
  "claudeWorkDir": "${process.cwd().replace(/\\/g, "/")}",
  "claudeSkipPermissions": true,
  "aiCommand": "claude"
}`);
  console.log("");
  console.log("提示：至少需要配置 Telegram、Feishu、WeChat 或 WeWork 其中一个平台");
  console.log(
    "或设置环境变量: TELEGRAM_BOT_TOKEN=xxx、FEISHU_APP_ID=xxx、WECHAT_APP_ID=xxx 或 WEWORK_CORP_ID=xxx 后再运行",
  );
  console.log("");
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
  const wc = existing?.platforms?.wechat;
  const hasWc = !!(wc?.token && wc?.guid && wc?.userId) || !!(wc?.appId && wc?.appSecret);
  const hasWw = !!(existing?.platforms?.wework?.corpId && existing?.platforms?.wework?.agentId && existing?.platforms?.wework?.secret);

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
          title:
            "微信 (WeChat) - 扫码登录获取 token（QClaw/AGP 协议）" +
            (hasWc ? " ✓已配置" : ""),
          value: "wechat",
        },
        {
          title:
            "企业微信 (WeCom/WeWork) - 需要 Corp ID、Agent ID 和 Secret" +
            (hasWw ? " ✓已配置" : ""),
          value: "wework",
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
          { title: "微信 (WeChat)" + (hasWc ? " ✓已配置" : ""), value: "wechat", selected: hasWc },
          { title: "企业微信 (WeWork)" + (hasWw ? " ✓已配置" : ""), value: "wework", selected: hasWw },
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
      (config.platforms as any).feishu = {
        ...(config.platforms as any).feishu,
        enabled: true,
        appId: fsAppId,
        appSecret: fsAppSecret,
      };
    } else if (platform === "feishu") {
      return false;
    }
  }

  if (selectedPlatforms.includes("wechat")) {
    const wc = existing?.platforms?.wechat;
    const hasToken = !!(wc?.token && wc?.guid && wc?.userId);

    const wechatModeResp = await prompts(
      {
        type: "select",
        name: "mode",
        message: "微信登录方式",
        choices: [
          {
            title: "扫码登录（推荐）- 用微信扫描二维码，自动获取 token",
            value: "qr",
          },
          {
            title: "使用已有配置" + (hasToken ? " ✓" : "（需已通过扫码登录获取）"),
            value: "keep",
            disabled: !hasToken,
          },
        ],
        initial: hasToken ? 1 : 0,
      },
      { onCancel }
    );

    if (wechatModeResp.mode === "qr") {
      console.log("\n正在启动微信扫码登录...\n");
      const appIdResp = await prompts(
        {
          type: "text",
          name: "appId",
          message: "请输入微信 AppID",
          initial: wc?.appId ?? "",
          validate: (v: string) => (v.trim() ? true : "AppID 不能为空"),
        },
        { onCancel }
      );

      try {
        const { performWeChatLogin } = await import("./wechat/auth/index.js");
        const credentials = await performWeChatLogin({
          envName: "production",
          appId: appIdResp.appId?.trim() || wc?.appId || "",
        });
        (config.platforms as Record<string, unknown>).wechat = {
          appId: appIdResp.appId?.trim() || wc?.appId,
          enabled: true,
          token: credentials.channelToken,
          jwtToken: credentials.jwtToken,
          loginKey: credentials.loginKey,
          guid: credentials.guid,
          userId: credentials.userId,
          wsUrl: "wss://mmgrcalltoken.3g.qq.com/agentwss",
        };
        console.log("\n✅ 微信登录成功，配置已获取");
      } catch (err) {
        console.error("\n❌ 微信登录失败:", err instanceof Error ? err.message : String(err));
        if (platform === "wechat") return false;
      }
    } else if (hasToken) {
      (config.platforms as Record<string, unknown>).wechat = {
        ...wc,
        enabled: true,
      };
    } else if (platform === "wechat") {
      return false;
    }
  }

  if (selectedPlatforms.includes("wework")) {
    const weworkResp = await prompts(
      [
        {
          type: "text",
          name: "corpId",
          message: "企业微信 Corp ID（从企业微信管理后台获取）",
          initial: existing?.platforms?.wework?.corpId ?? "",
          validate: (v: string) => (v.trim() ? true : "Corp ID 不能为空"),
        },
        {
          type: "text",
          name: "agentId",
          message: "企业微信 Agent ID（应用 ID，从企业微信管理后台获取）",
          initial: existing?.platforms?.wework?.agentId ?? "",
          validate: (v: string) => (v.trim() ? true : "Agent ID 不能为空"),
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
    const wwAgentId = weworkResp.agentId?.trim() || existing?.platforms?.wework?.agentId;
    const wwSecret = weworkResp.secret?.trim() || existing?.platforms?.wework?.secret;
    if (wwCorpId && wwAgentId && wwSecret) {
      (config.platforms as any).wework = {
        enabled: true,
        corpId: wwCorpId,
        agentId: wwAgentId,
        secret: wwSecret,
      };
    } else if (platform === "wework") {
      return false;
    }
  }

  // 通用配置：只询问所选平台的白名单，未选平台沿用已有配置
  const tgIds = existing?.platforms?.telegram?.allowedUserIds?.join(", ") ?? "";
  const fsIds = existing?.platforms?.feishu?.allowedUserIds?.join(", ") ?? "";
  const wcIds = existing?.platforms?.wechat?.allowedUserIds?.join(", ") ?? "";
  const wwIds = existing?.platforms?.wework?.allowedUserIds?.join(", ") ?? "";
  const aiIdx = ["claude", "codex", "cursor"].indexOf(existing?.aiCommand ?? "claude");

  const commonPrompts: prompts.PromptObject[] = [];
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
  if (selectedPlatforms.includes("wechat")) {
    commonPrompts.push({
      type: "text",
      name: "wechatAllowedUserIds",
      message: "微信白名单用户 ID（可选，逗号分隔，留空=所有人可访问）",
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
  commonPrompts.push(
    {
      type: "select",
      name: "aiCommand",
      message: "AI 工具（↑↓ 选择）",
      choices: [
        { title: "claude-code", value: "claude" },
        { title: "codex", value: "codex" },
        { title: "cursor", value: "cursor" },
      ],
      initial: aiIdx >= 0 ? aiIdx : 0,
    },
    {
      type: "text",
      name: "workDir",
      message: "工作目录",
      initial: existing?.claudeWorkDir ?? process.cwd(),
    },
  );

  const commonResp = await prompts(commonPrompts, { onCancel });

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
  const wechatIds = selectedPlatforms.includes("wechat")
    ? parseIds(commonResp.wechatAllowedUserIds)
    : parseIds(existing?.platforms?.wechat?.allowedUserIds?.join(", "));
  const weworkIds = selectedPlatforms.includes("wework")
    ? parseIds(commonResp.weworkAllowedUserIds)
    : parseIds(existing?.platforms?.wework?.allowedUserIds?.join(", "));

  // 增量合并：以已有配置为底，只覆盖本次选中的平台（不写入根级旧字段 telegramBotToken 等）
  const base = existing
    ? (JSON.parse(JSON.stringify(existing)) as ExistingConfig)
    : null;
  const { telegramBotToken: _, feishuAppId: __, feishuAppSecret: ___, ...baseRest } = (base ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {
    ...baseRest,
    platforms: { ...(base?.platforms ?? {}) },
    claudeWorkDir: (commonResp.workDir || process.cwd()).trim(),
    claudeSkipPermissions: base?.claudeSkipPermissions ?? true,
    aiCommand: commonResp.aiCommand ?? base?.aiCommand ?? "claude",
  };

  if (selectedPlatforms.includes("telegram")) {
    (out.platforms as any).telegram = {
      ...(base?.platforms?.telegram as object),
      enabled: true,
      botToken: (config as any).telegramBotToken ?? base?.platforms?.telegram?.botToken,
      allowedUserIds: telegramIds,
    };
  } else if (base?.platforms?.telegram) {
    (out.platforms as any).telegram = {
      ...base.platforms.telegram,
      allowedUserIds: telegramIds.length > 0 ? telegramIds : (base.platforms.telegram as any).allowedUserIds,
    };
  } else {
    (out.platforms as any).telegram = { enabled: false, allowedUserIds: telegramIds };
  }

  if (selectedPlatforms.includes("feishu")) {
    (out.platforms as any).feishu = {
      ...(base?.platforms?.feishu as object),
      enabled: true,
      appId: (config.platforms as any).feishu?.appId,
      appSecret: (config.platforms as any).feishu?.appSecret,
      allowedUserIds: feishuIds,
    };
  } else if (base?.platforms?.feishu) {
    (out.platforms as any).feishu = {
      ...base.platforms.feishu,
      allowedUserIds: feishuIds.length > 0 ? feishuIds : (base.platforms.feishu as any).allowedUserIds,
    };
  } else {
    (out.platforms as any).feishu = { enabled: false, allowedUserIds: feishuIds };
  }

  if (selectedPlatforms.includes("wechat")) {
    const wcConfig = (config.platforms as Record<string, unknown>)?.wechat as Record<string, unknown> | undefined;
    (out.platforms as Record<string, unknown>).wechat = {
      ...(base?.platforms?.wechat as object),
      enabled: true,
      appId: wcConfig?.appId ?? base?.platforms?.wechat?.appId,
      appSecret: wcConfig?.appSecret ?? base?.platforms?.wechat?.appSecret,
      token: wcConfig?.token ?? base?.platforms?.wechat?.token,
      jwtToken: wcConfig?.jwtToken ?? base?.platforms?.wechat?.jwtToken,
      loginKey: wcConfig?.loginKey ?? base?.platforms?.wechat?.loginKey,
      guid: wcConfig?.guid ?? base?.platforms?.wechat?.guid,
      userId: wcConfig?.userId ?? base?.platforms?.wechat?.userId,
      wsUrl: wcConfig?.wsUrl ?? base?.platforms?.wechat?.wsUrl,
      allowedUserIds: wechatIds,
    };
  } else if (base?.platforms?.wechat) {
    (out.platforms as any).wechat = {
      ...base.platforms.wechat,
      allowedUserIds: wechatIds.length > 0 ? wechatIds : (base.platforms.wechat as any).allowedUserIds,
    };
  } else {
    (out.platforms as any).wechat = { enabled: false, allowedUserIds: wechatIds };
  }

  if (selectedPlatforms.includes("wework")) {
    (out.platforms as any).wework = {
      ...(base?.platforms?.wework as object),
      enabled: true,
      corpId: (config.platforms as any).wework?.corpId,
      agentId: (config.platforms as any).wework?.agentId,
      secret: (config.platforms as any).wework?.secret,
      allowedUserIds: weworkIds,
    };
  } else if (base?.platforms?.wework) {
    (out.platforms as any).wework = {
      ...base.platforms.wework,
      allowedUserIds: weworkIds.length > 0 ? weworkIds : (base.platforms.wework as any).allowedUserIds,
    };
  } else {
    (out.platforms as any).wework = { enabled: false, allowedUserIds: weworkIds };
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
