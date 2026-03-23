import { createServer } from "node:http";
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { getConfiguredAiCommands, loadConfig, needsSetup, resolvePlatformAiCommand } from "./config.js";
import { runInteractiveSetup, runClaudeApiSetup } from "./setup.js";
import { runWebConfigFlow } from "./config-web.js";

// 导出供 cli.ts 使用
export { needsSetup, runInteractiveSetup };
import { initTelegram, stopTelegram } from "./telegram/client.js";
import { setupTelegramHandlers } from "./telegram/event-handler.js";
import { sendTextReply as sendTelegramTextReply } from "./telegram/message-sender.js";
import { initFeishu, stopFeishu } from "./feishu/client.js";
import { setupFeishuHandlers } from "./feishu/event-handler.js";
import { sendTextReply as sendFeishuTextReply } from "./feishu/message-sender.js";
import { initQQ, stopQQ } from "./qq/client.js";
import { setupQQHandlers } from "./qq/event-handler.js";
import { sendTextReply as sendQQTextReply } from "./qq/message-sender.js";
import { initWeChat, stopWeChat } from "./wechat/client.js";
import { setupWeChatHandlers } from "./wechat/event-handler.js";
import { sendTextReply as sendWeChatTextReply } from "./wechat/message-sender.js";
import { initWeWork, stopWeWork } from "./wework/client.js";
import { setupWeWorkHandlers } from "./wework/event-handler.js";
import { sendProactiveTextReply as sendWeWorkTextReply } from "./wework/message-sender.js";
import { initDingTalk, stopDingTalk, formatDingTalkInitError } from "./dingtalk/client.js";
import { setupDingTalkHandlers } from "./dingtalk/event-handler.js";
import { initWorkBuddy, stopWorkBuddy } from "./workbuddy/client.js";
import { setupWorkBuddyHandlers } from "./workbuddy/event-handler.js";
import { sendTextReply as sendWorkBuddyTextReply } from "./workbuddy/message-sender.js";
import { initAdapters, cleanupAdapters } from "./adapters/registry.js";
import { SessionManager } from "./session/session-manager.js";
import {
  loadActiveChats,
  getActiveChatId,
  flushActiveChats,
} from "./shared/active-chats.js";
import { initLogger, createLogger, closeLogger } from "./logger.js";
import { APP_HOME, SHUTDOWN_PORT } from "./constants.js";
import { createRequire } from "node:module";
import { escapePathForMarkdown } from "./shared/utils.js";

const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require("../package.json") as {
  version: string;
};

const log = createLogger("Main");

async function sendLifecycleNotification(platform: string, message: string) {
  // DingTalk 和 WorkBuddy 不支持主动发消息（OpenAPI 需 robotCode 等，易报 robot 不存在），跳过启动/关闭通知
  if (platform === "dingtalk" || platform === "workbuddy") return;

  const telegramChatId = getActiveChatId("telegram");
  const feishuChatId = getActiveChatId("feishu");
  const qqChatId = getActiveChatId("qq");
  const wechatChatId = getActiveChatId("wechat");
  const weworkChatId = getActiveChatId("wework");

  const sendPromises: Promise<void>[] = [];

  if (platform === "telegram" && telegramChatId) {
    sendPromises.push(
      sendTelegramTextReply(telegramChatId, message).catch((err) => {
        log.debug("Failed to send Telegram notification:", err);
      }),
    );
  }

  if (platform === "feishu" && feishuChatId) {
    sendPromises.push(
      sendFeishuTextReply(feishuChatId, message).catch((err) => {
        log.debug("Failed to send Feishu notification:", err);
      }),
    );
  }

  if (platform === "qq" && qqChatId) {
    sendPromises.push(
      sendQQTextReply(qqChatId, message).catch((err) => {
        log.debug("Failed to send QQ notification:", err);
      }),
    );
  }

  if (platform === "wechat" && wechatChatId) {
    sendPromises.push(
      sendWeChatTextReply(wechatChatId, message).catch((err) => {
        log.debug("Failed to send WeChat notification:", err);
      }),
    );
  }

  if (platform === "wework" && weworkChatId) {
    sendPromises.push(
      sendWeWorkTextReply(weworkChatId, message).catch((err) => {
        log.debug("Failed to send WeWork notification:", err);
      }),
    );
  }

  await Promise.all(sendPromises);
}

function buildStartupMessage(
  platform: string,
  appVersion: string,
  aiCommand: string,
  defaultWorkDir: string,
  sessionManager: SessionManager,
): string {
  let sessionDir: string | undefined;

  // Telegram 私聊、企业微信当前实现里，活跃 chatId 可直接对应到 session userId。
  if (platform === "telegram" || platform === "wework") {
    const activeChatId = getActiveChatId(platform);
    if (activeChatId) {
      sessionDir = sessionManager.getWorkDir(activeChatId);
    }
  }

  const lines = [
    `**服务已启动**`,
    "",
    `- 版本: \`open-im v${appVersion}\``,
    `- 当前渠道: \`${platform}\``,
    `- 当前渠道 CLI: \`${aiCommand}\``,
  ];

  if (sessionDir) {
    lines.push(`- 会话目录: ${escapePathForMarkdown(sessionDir)}`);
  } else {
    lines.push(`- 会话目录: 发送 \`/pwd\` 查看`);
  }
  return lines.join("\n");
}

function buildShutdownMessage(uptimeMinutes: number): string {
  return [
    `**服务正在关闭**`,
    "",
    `- 服务: \`open-im\``,
    `- 运行时长: \`${uptimeMinutes} 分钟\``,
  ].join("\n");
}

export async function main() {
  const startupCwd = process.cwd();

  if (needsSetup()) {
    const saved = process.stdin.isTTY
      ? (await runWebConfigFlow({ mode: "dev", cwd: process.cwd() })) === "saved"
      : await runInteractiveSetup();
    if (!saved) process.exit(1);
  }

  const CLAUDE_API_CRED_ERROR = "未配置 Claude API 凭证";
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes(CLAUDE_API_CRED_ERROR) &&
      process.stdin.isTTY
    ) {
      log.info("检测到未配置 Claude API 凭证，启动配置向导...");
      const saved = await runClaudeApiSetup();
      if (!saved) process.exit(1);
      config = loadConfig();
    } else {
      throw err;
    }
  }

  initLogger(config.logDir, config.logLevel);
  loadActiveChats();

  initAdapters(config);

  // 尽早启动 shutdown 并写入 port 文件，使 open-im start 的 8s 就绪超时能通过（平台初始化可能较慢）
  let shutdownServer: ReturnType<typeof createServer> | null = null;
  await new Promise<void>((resolve, reject) => {
    shutdownServer = createServer((req, res) => {
      if (req.url === "/shutdown" || req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        shutdown().catch(() => process.exit(1));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    shutdownServer!.listen(SHUTDOWN_PORT, "127.0.0.1", () => {
      const portFile = join(APP_HOME, "open-im.port");
      const dir = dirname(portFile);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(portFile, String(SHUTDOWN_PORT), "utf-8");
      resolve();
    });
    shutdownServer!.on("error", reject);
  });

  log.info("Starting open-im bridge...");
  log.info(`AI 工具: ${getConfiguredAiCommands(config).join(", ")}`);
  log.info(`默认会话目录(本次启动 cwd): ${startupCwd}`);
  if (startupCwd !== config.claudeWorkDir) {
    log.info(`历史默认会话目录(配置中的 claudeWorkDir): ${config.claudeWorkDir}`);
  }
  log.info(`启用平台: ${config.enabledPlatforms.join(", ")}`);

  const sessionManager = new SessionManager(startupCwd, config.claudeWorkDir);

  // CLI 工具（Codex/CodeBuddy）的 session 是进程级别的，服务重启后一定无效。
  // 启动时仅清除 CLI 工具自己的 sessionId，保留 Claude 的持久上下文。
  sessionManager.clearAllCliSessionIds();

  let telegramHandle: ReturnType<typeof setupTelegramHandlers> | null = null;
  let feishuHandle: ReturnType<typeof setupFeishuHandlers> | null = null;
  let qqHandle: ReturnType<typeof setupQQHandlers> | null = null;
  let wechatHandle: ReturnType<typeof setupWeChatHandlers> | null = null;
  let weworkHandle: ReturnType<typeof setupWeWorkHandlers> | null = null;
  let dingtalkHandle: ReturnType<typeof setupDingTalkHandlers> | null = null;
  let workbuddyHandle: ReturnType<typeof setupWorkBuddyHandlers> | null = null;

  // Track successfully initialized platforms
  const successfulPlatforms: string[] = [];

  if (config.enabledPlatforms.includes("telegram")) {
    try {
      await initTelegram(config, (bot) => {
        telegramHandle = setupTelegramHandlers(bot, config, sessionManager);
      });
      successfulPlatforms.push("telegram");
    } catch (err) {
      log.error("Failed to initialize Telegram:", err);
    }
  }

  if (config.enabledPlatforms.includes("feishu")) {
    try {
      feishuHandle = setupFeishuHandlers(config, sessionManager);
      await initFeishu(config, feishuHandle.handleEvent);
      successfulPlatforms.push("feishu");
    } catch (err) {
      log.error("Failed to initialize Feishu:", err);
    }
  }

  if (config.enabledPlatforms.includes("qq")) {
    try {
      qqHandle = setupQQHandlers(config, sessionManager);
      await initQQ(config, qqHandle.handleEvent);
      successfulPlatforms.push("qq");
    } catch (err) {
      log.error("Failed to initialize QQ:", err);
    }
  }

  if (config.enabledPlatforms.includes("wechat")) {
    try {
      wechatHandle = setupWeChatHandlers(config, sessionManager);
      await initWeChat(config, wechatHandle.handleEvent);
      successfulPlatforms.push("wechat");
    } catch (err) {
      log.error("Failed to initialize WeChat:", err);
    }
  }

  if (config.enabledPlatforms.includes("wework")) {
    try {
      weworkHandle = setupWeWorkHandlers(config, sessionManager);
      await initWeWork(config, weworkHandle.handleEvent);
      successfulPlatforms.push("wework");
    } catch (err) {
      log.error("Failed to initialize WeWork:", err);
    }
  }

  if (config.enabledPlatforms.includes("dingtalk")) {
    try {
      dingtalkHandle = setupDingTalkHandlers(config, sessionManager);
      await initDingTalk(config, dingtalkHandle.handleEvent);
      successfulPlatforms.push("dingtalk");
    } catch (err) {
      log.error("Failed to initialize DingTalk:", formatDingTalkInitError(err));
    }
  }

  if (config.enabledPlatforms.includes("workbuddy")) {
    try {
      workbuddyHandle = setupWorkBuddyHandlers(config, sessionManager);
      await initWorkBuddy(config, workbuddyHandle.handleEvent);
      successfulPlatforms.push("workbuddy");
    } catch (err) {
      log.error("Failed to initialize WorkBuddy:", err);
    }
  }

  // Require at least one platform to start successfully
  if (successfulPlatforms.length === 0) {
    throw new Error("No platforms initialized successfully. Service cannot start.");
  }

  log.info("Service is running. Press Ctrl+C to stop.");
  log.info(`Successfully initialized platforms: ${successfulPlatforms.join(", ")}`);

  // Send notification only to successfully initialized platforms
  for (const platform of successfulPlatforms) {
    const startupMsg = buildStartupMessage(
      platform,
      APP_VERSION,
      resolvePlatformAiCommand(config, platform as "telegram" | "feishu" | "qq" | "wechat" | "wework" | "dingtalk" | "workbuddy"),
      startupCwd,
      sessionManager,
    );
    await sendLifecycleNotification(platform, startupMsg).catch((err) => {
      log.warn(`Failed to send startup notification to ${platform}:`, err);
    });
  }

  const startedAt = Date.now();

  const shutdown = async () => {
    log.info("Shutting down...");
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
    const m = Math.floor(uptimeSec / 60);
    const shutdownMsg = buildShutdownMessage(m);

    // Send notification only to successfully initialized platforms
    for (const platform of successfulPlatforms) {
      await sendLifecycleNotification(platform, shutdownMsg).catch((err) => {
        log.warn(`Failed to send shutdown notification to ${platform}:`, err);
      });
    }

    shutdownServer?.close();
    const portFile = join(APP_HOME, "open-im.port");
    try {
      if (existsSync(portFile)) unlinkSync(portFile);
    } catch {
      /* ignore */
    }
    telegramHandle?.stop();
    stopTelegram();
    feishuHandle?.stop();
    stopFeishu();
    qqHandle?.stop();
    await stopQQ();
    wechatHandle?.stop();
    stopWeChat();
    weworkHandle?.stop();
    stopWeWork();
    dingtalkHandle?.stop();
    stopDingTalk();
    workbuddyHandle?.stop();
    stopWorkBuddy();
    sessionManager.destroy();
    cleanupAdapters();
    flushActiveChats();
    closeLogger();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown().catch(() => process.exit(1)));
  process.on("SIGTERM", () => shutdown().catch(() => process.exit(1)));
}

const isEntry =
  process.argv[1]?.replace(/\\/g, "/").endsWith("/index.js") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("/index.ts");
if (isEntry) {
  main().catch((err) => {
    log.error("Fatal error:", err);
    closeLogger();
    process.exit(1);
  });
}
