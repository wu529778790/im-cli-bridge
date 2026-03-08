import { loadConfig, needsSetup } from './config.js';
import { runInteractiveSetup } from './setup.js';
import { initTelegram, stopTelegram } from './telegram/client.js';
import { setupTelegramHandlers } from './telegram/event-handler.js';
import { sendTextReply } from './telegram/message-sender.js';
import { initAdapters } from './adapters/registry.js';
import { SessionManager } from './session/session-manager.js';
import { loadActiveChats, getActiveChatId, flushActiveChats } from './shared/active-chats.js';
import { initLogger, createLogger, closeLogger } from './logger.js';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require('../package.json') as { version: string };

const log = createLogger('Main');

async function sendLifecycleNotification(platform: string, message: string) {
  const chatId = getActiveChatId('telegram');
  if (!chatId) return;
  try {
    await sendTextReply(chatId, message);
  } catch (err) {
    log.debug('Failed to send lifecycle notification:', err);
  }
}

export async function main() {
  if (needsSetup()) {
    const saved = await runInteractiveSetup();
    if (!saved) process.exit(1);
  }

  const config = loadConfig();
  initLogger(config.logDir, config.logLevel);
  loadActiveChats();

  initAdapters(config);

  log.info('Starting open-im bridge...');
  log.info(`AI 工具: ${config.aiCommand}`);
  log.info(`工作目录: ${config.claudeWorkDir}`);

  const sessionManager = new SessionManager(config.claudeWorkDir, config.allowedBaseDirs);
  let telegramHandle: ReturnType<typeof setupTelegramHandlers> | null = null;

  if (config.enabledPlatforms.includes('telegram')) {
    await initTelegram(config, (bot) => {
      telegramHandle = setupTelegramHandlers(bot, config, sessionManager);
    });
  }

  log.info('Service is running. Press Ctrl+C to stop.');

  const startupMsg = [
    `🟢 open-im v${APP_VERSION} 服务已启动`,
    '',
    `AI 工具: ${config.aiCommand}`,
    `工作目录: ${config.claudeWorkDir}`,
  ].join('\n');
  await sendLifecycleNotification('telegram', startupMsg).catch(() => {});

  const startedAt = Date.now();

  const shutdown = async () => {
    log.info('Shutting down...');
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
    const m = Math.floor(uptimeSec / 60);
    await sendLifecycleNotification(
      'telegram',
      `🔴 open-im 服务正在关闭...\n运行时长: ${m}分钟`
    ).catch(() => {});

    telegramHandle?.stop();
    stopTelegram();
    sessionManager.destroy();
    flushActiveChats();
    closeLogger();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown().catch(() => process.exit(1)));
  process.on('SIGTERM', () => shutdown().catch(() => process.exit(1)));
}

const isEntry = process.argv[1]?.replace(/\\/g, '/').endsWith('/index.js') || process.argv[1]?.replace(/\\/g, '/').endsWith('/index.ts');
if (isEntry) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    closeLogger();
    process.exit(1);
  });
}
