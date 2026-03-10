/**
 * 首次运行时的交互式配置引导
 * 使用 prompts 库，兼容 tsx watch、IDE 终端等环境
 * Telegram Token 使用 readline 避免 Windows 终端 prompts 重绘问题
 */

import prompts from "prompts";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { APP_HOME } from "./constants.js";

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
    }
  },
  "claudeWorkDir": "${process.cwd().replace(/\\/g, "/")}",
  "claudeSkipPermissions": true,
  "aiCommand": "claude"
}`);
  console.log("");
  console.log("提示：至少需要配置 Telegram、Feishu 或 WeChat 其中一个平台");
  console.log(
    "或设置环境变量: TELEGRAM_BOT_TOKEN=xxx、FEISHU_APP_ID=xxx 或 WECHAT_APP_ID=xxx 后再运行",
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

  console.log("\n━━━ open-im 首次配置 ━━━\n");
  console.log("配置将保存到:", configPath);
  console.log("");

  const onCancel = () => {
    console.log("\n已取消配置。");
    process.exit(0);
  };

  // 第一步：选择平台
  const platformResp = await prompts(
    {
      type: "select",
      name: "platform",
      message: "选择要配置的平台（↑↓ 选择）",
      choices: [
        { title: "Telegram - 需要 Bot Token", value: "telegram" },
        {
          title: "飞书 (Feishu/Lark) - 需要 App ID 和 App Secret",
          value: "feishu",
        },
        {
          title: "微信 (WeChat) - 需要 App ID 和 App Secret（AGP 协议）",
          value: "wechat",
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
          { title: "Telegram", value: "telegram", selected: true },
          { title: "飞书 (Feishu)", value: "feishu" },
          { title: "微信 (WeChat)", value: "wechat" },
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
    const token = await question("Telegram Bot Token（从 @BotFather 获取）: ");
    if (token) {
      config.telegramBotToken = token;
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
          validate: (v: string) => (v.trim() ? true : "App ID 不能为空"),
        },
        {
          type: "text",
          name: "appSecret",
          message: "飞书 App Secret（从飞书开放平台获取）",
          validate: (v: string) => (v.trim() ? true : "App Secret 不能为空"),
        },
      ],
      { onCancel },
    );

    if (feishuResp.appId && feishuResp.appSecret) {
      (config.platforms as any).feishu = {
        ...(config.platforms as any).feishu,
        enabled: true,
        appId: feishuResp.appId.trim(),
        appSecret: feishuResp.appSecret.trim(),
      };
    } else if (platform === "feishu") {
      return false;
    }
  }

  if (selectedPlatforms.includes("wechat")) {
    const wechatResp = await prompts(
      [
        {
          type: "text",
          name: "appId",
          message: "微信 App ID（从微信开放平台获取）",
          validate: (v: string) => (v.trim() ? true : "App ID 不能为空"),
        },
        {
          type: "text",
          name: "appSecret",
          message: "微信 App Secret（从微信开放平台获取）",
          validate: (v: string) => (v.trim() ? true : "App Secret 不能为空"),
        },
        {
          type: "text",
          name: "wsUrl",
          message: "AGP WebSocket URL（可选，留空使用默认）",
          initial: "",
        },
      ],
      { onCancel },
    );

    if (wechatResp.appId && wechatResp.appSecret) {
      (config.platforms as any).wechat = {
        enabled: true,
        appId: wechatResp.appId.trim(),
        appSecret: wechatResp.appSecret.trim(),
        wsUrl: wechatResp.wsUrl?.trim() || undefined,
      };
    } else if (platform === "wechat") {
      return false;
    }
  }

  // 通用配置
  const commonResp = await prompts(
    [
      {
        type: "text",
        name: "telegramAllowedUserIds",
        message:
          "Telegram 白名单用户 ID（可选，逗号分隔，留空=所有人可访问）",
        initial: "",
      },
      {
        type: "text",
        name: "feishuAllowedUserIds",
        message:
          "飞书白名单用户 ID（可选，逗号分隔，留空=所有人可访问）",
        initial: "",
      },
      {
        type: "text",
        name: "wechatAllowedUserIds",
        message:
          "微信白名单用户 ID（可选，逗号分隔，留空=所有人可访问）",
        initial: "",
      },
      {
        type: "select",
        name: "aiCommand",
        message: "AI 工具（↑↓ 选择）",
        choices: [
          { title: "claude-code", value: "claude" },
          { title: "codex", value: "codex" },
          { title: "cursor", value: "cursor" },
        ],
        initial: 0,
      },
      {
        type: "text",
        name: "workDir",
        message: "工作目录",
        initial: process.cwd(),
      },
    ],
    { onCancel },
  );

  const parseIds = (value: string | undefined): string[] =>
    value
      ? value
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [];

  // 分平台白名单
  const telegramIds = parseIds(commonResp.telegramAllowedUserIds);
  const feishuIds = parseIds(commonResp.feishuAllowedUserIds);
  const wechatIds = parseIds(commonResp.wechatAllowedUserIds);

  if (selectedPlatforms.includes("telegram")) {
    (config.platforms as any).telegram = {
      ...(config.platforms as any).telegram,
      enabled: true,
      botToken: (config as any).telegramBotToken ?? undefined,
      allowedUserIds: telegramIds,
    };
  } else {
    (config.platforms as any).telegram = {
      enabled: false,
      allowedUserIds: telegramIds,
    };
  }

  if (selectedPlatforms.includes("feishu")) {
    (config.platforms as any).feishu = {
      ...(config.platforms as any).feishu,
      enabled: true,
      allowedUserIds: feishuIds,
    };
  } else {
    (config.platforms as any).feishu = {
      enabled: false,
      allowedUserIds: feishuIds,
    };
  }

  if (selectedPlatforms.includes("wechat")) {
    (config.platforms as any).wechat = {
      ...(config.platforms as any).wechat,
      enabled: true,
      allowedUserIds: wechatIds,
    };
  } else {
    (config.platforms as any).wechat = {
      enabled: false,
      allowedUserIds: wechatIds,
    };
  }

  config.claudeWorkDir = (commonResp.workDir || process.cwd()).trim();
  config.claudeSkipPermissions = true;
  config.aiCommand = commonResp.aiCommand ?? "claude";

  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

  console.log("\n✅ 配置已保存到", configPath);
  console.log("");
  return true;
}
