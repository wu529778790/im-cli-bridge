import { createServer } from "node:http";
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig, needsSetup, getPlatformsWithCredentials } from "./config.js";
import { runInteractiveSetup, runPlatformSelectionPrompt } from "./setup.js";

// 导出供 cli.ts 使用
export { needsSetup, runInteractiveSetup };
import { initTelegram, stopTelegram } from "./telegram/client.js";
import { setupTelegramHandlers } from "./telegram/event-handler.js";
import { sendTextReply as sendTelegramTextReply } from "./telegram/message-sender.js";
import { initFeishu, stopFeishu } from "./feishu/client.js";
import { setupFeishuHandlers } from "./feishu/event-handler.js";
import { sendTextReply as sendFeishuTextReply } from "./feishu/message-sender.js";
import { initWeChat, stopWeChat } from "./wechat/client.js";
import { setupWeChatHandlers } from "./wechat/event-handler.js";
import { sendTextReply as sendWeChatTextReply } from "./wechat/message-sender.js";
import { initWeWork, stopWeWork } from "./wework/client.js";
import { setupWeWorkHandlers } from "./wework/event-handler.js";
import { sendProactiveTextReply as sendWeWorkTextReply } from "./wework/message-sender.js";
import { initAdapters, cleanupAdapters } from "./adapters/registry.js";
import { SessionManager } from "./session/session-manager.js";
import {
  loadActiveChats,
  getActiveChatId,
  flushActiveChats,
} from "./shared/active-chats.js";
import { initLogger, createLogger, closeLogger } from "./logger.js";
import { APP_HOME, SHUTDOWN_PORT } from "./constants.js";
import { startPermissionServer, stopPermissionServer } from "./hook/permission-server.js";
import { initPermissionModes } from "./permission-mode/session-mode.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require("../package.json") as {
  version: string;
};

const log = createLogger("Main");

async function sendLifecycleNotification(platform: string, message: string) {
  const telegramChatId = getActiveChatId("telegram");
  const feishuChatId = getActiveChatId("feishu");
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

export async function main() {
  if (needsSetup()) {
    const saved = await runInteractiveSetup();
    if (!saved) process.exit(1);
  }

  let config = loadConfig();

  // 多通道时让用户确认启用哪些（仅 TTY 交互模式）
  if (
    getPlatformsWithCredentials(config).length > 1 &&
    process.stdin.isTTY
  ) {
    const updated = await runPlatformSelectionPrompt(config);
    if (!updated) process.exit(0);
    config = updated;
  }
  initLogger(config.logDir, config.logLevel);
  loadActiveChats();
  initPermissionModes();

  initAdapters(config);

  // Start permission server for tool approval
  const actualPort = startPermissionServer(config.hookPort);
  log.info(`Permission server listening on port ${actualPort}`);

  const { MODE_LABELS } = await import('./permission-mode/types.js');
  const defaultModeLabel = MODE_LABELS[config.defaultPermissionMode];

  log.info("Starting open-im bridge...");
  log.info(`AI 工具: ${config.aiCommand}`);
  log.info(`工作目录: ${config.claudeWorkDir}`);
  log.info(`默认权限模式: ${defaultModeLabel} (${config.defaultPermissionMode})`);
  log.info(`启用平台: ${config.enabledPlatforms.join(", ")}`);

  const sessionManager = new SessionManager(
    config.claudeWorkDir,
    config.allowedBaseDirs,
  );
  let telegramHandle: ReturnType<typeof setupTelegramHandlers> | null = null;
  let feishuHandle: ReturnType<typeof setupFeishuHandlers> | null = null;
  let wechatHandle: ReturnType<typeof setupWeChatHandlers> | null = null;
  let weworkHandle: ReturnType<typeof setupWeWorkHandlers> | null = null;

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

  // Require at least one platform to start successfully
  if (successfulPlatforms.length === 0) {
    throw new Error("No platforms initialized successfully. Service cannot start.");
  }

  log.info("Service is running. Press Ctrl+C to stop.");
  log.info(`Successfully initialized platforms: ${successfulPlatforms.join(", ")}`);

  const startupMsg = [
    `🟢 open-im v${APP_VERSION} 服务已启动`,
    "",
    `AI 工具: ${config.aiCommand}`,
    `工作目录: ${config.claudeWorkDir}`,
    `默认权限模式: ${defaultModeLabel} (${config.defaultPermissionMode})`,
    `成功启动平台: ${successfulPlatforms.join(", ")}`,
  ].join("\n");

  // Send notification only to successfully initialized platforms
  for (const platform of successfulPlatforms) {
    await sendLifecycleNotification(platform, startupMsg).catch(() => {});
  }

  const startedAt = Date.now();

  // 防止重复发送关闭通知
  let shutdownNotificationSent = false;

  const shutdown = async () => {
    log.info("Shutting down...");
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
    const m = Math.floor(uptimeSec / 60);
    const shutdownMsg = `🔴 open-im 服务正在关闭...\n运行时长: ${m}分钟`;

    // Send notification only to successfully initialized platforms
    for (const platform of successfulPlatforms) {
      await sendLifecycleNotification(platform, shutdownMsg).catch(() => {});
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
    wechatHandle?.stop();
    stopWeChat();
    weworkHandle?.stop();
    stopWeWork();
    stopPermissionServer();
    sessionManager.destroy();
    cleanupAdapters();
    flushActiveChats();
    closeLogger();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown().catch(() => process.exit(1)));
  process.on("SIGTERM", () => shutdown().catch(() => process.exit(1)));

  // 优雅关闭 HTTP 服务：stop 命令通过此端口触发 shutdown（Windows 下 SIGTERM 不可靠）
  const shutdownServer = createServer((req, res) => {
    if (req.url === "/shutdown" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      shutdown().catch(() => process.exit(1));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  shutdownServer.listen(SHUTDOWN_PORT, "127.0.0.1", () => {
    const portFile = join(APP_HOME, "open-im.port");
    const dir = dirname(portFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(portFile, String(SHUTDOWN_PORT), "utf-8");
  });
}

const isEntry =
  process.argv[1]?.replace(/\\/g, "/").endsWith("/index.js") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("/index.ts");
if (isEntry) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    closeLogger();
    process.exit(1);
  });
}
