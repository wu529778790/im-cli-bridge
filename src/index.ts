import { createServer } from "node:http";
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig, needsSetup } from "./config.js";
import { runInteractiveSetup } from "./setup.js";

// 导出供 cli.ts 使用
export { needsSetup, runInteractiveSetup };
import { initTelegram, stopTelegram } from "./telegram/client.js";
import { setupTelegramHandlers } from "./telegram/event-handler.js";
import { sendTextReply as sendTelegramTextReply } from "./telegram/message-sender.js";
import { initFeishu, stopFeishu } from "./feishu/client.js";
import { setupFeishuHandlers } from "./feishu/event-handler.js";
import { sendTextReply as sendFeishuTextReply } from "./feishu/message-sender.js";
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

  await Promise.all(sendPromises);
}

export async function main() {
  if (needsSetup()) {
    const saved = await runInteractiveSetup();
    if (!saved) process.exit(1);
  }

  const config = loadConfig();
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

  if (config.enabledPlatforms.includes("telegram")) {
    await initTelegram(config, (bot) => {
      telegramHandle = setupTelegramHandlers(bot, config, sessionManager);
    });
  }

  if (config.enabledPlatforms.includes("feishu")) {
    feishuHandle = setupFeishuHandlers(config, sessionManager);
    await initFeishu(config, feishuHandle.handleEvent);
  }

  log.info("Service is running. Press Ctrl+C to stop.");

  const startupMsg = [
    `🟢 open-im v${APP_VERSION} 服务已启动`,
    "",
    `AI 工具: ${config.aiCommand}`,
    `工作目录: ${config.claudeWorkDir}`,
    `默认权限模式: ${defaultModeLabel} (${config.defaultPermissionMode})`,
    `启用平台: ${config.enabledPlatforms.join(", ")}`,
  ].join("\n");

  // Send notification to all enabled platforms
  for (const platform of config.enabledPlatforms) {
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

    // Send notification to all enabled platforms
    for (const platform of config.enabledPlatforms) {
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
