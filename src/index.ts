import { loadConfig, needsSetup } from './config.js';
import { runInteractiveSetup } from './setup.js';

// 导出供 cli.ts 使用
export { needsSetup, runInteractiveSetup };
import { initTelegram, stopTelegram } from './telegram/client.js';
import { setupTelegramHandlers } from './telegram/event-handler.js';
import { sendTextReply } from './telegram/message-sender.js';
import { initAdapters } from './adapters/registry.js';
import { SessionManager } from './session/session-manager.js';
import { loadActiveChats, getActiveChatId, flushActiveChats } from './shared/active-chats.js';
import { initLogger, createLogger, closeLogger } from './logger.js';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require('../package.json') as { version: string };

const log = createLogger('Main');

// 停止标记文件路径
const STOP_FILE = join(homedir(), '.open-im', 'stop.flag');

// 检查是否收到停止信号
function checkStopSignal(): boolean {
  return existsSync(STOP_FILE);
}

// 清理停止标记文件
async function clearStopSignal(): Promise<void> {
  try {
    if (existsSync(STOP_FILE)) {
      await rm(STOP_FILE);
    }
  } catch {
    // 忽略错误
  }
}

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

    try {
      await sendLifecycleNotification(
        'telegram',
        `🔴 open-im 服务正在关闭...\n运行时长: ${m}分钟`
      );
      // 等待消息发送完成
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      log.debug('Failed to send shutdown notification:', err);
    }

    // 清理停止标记文件
    await clearStopSignal();

    telegramHandle?.stop();
    stopTelegram();
    sessionManager.destroy();
    flushActiveChats();
    closeLogger();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown().catch(() => process.exit(1)));
  process.on('SIGTERM', () => shutdown().catch(() => process.exit(1)));

  // 定期检查停止标记文件（用于 Windows 等无法发送信号的场景）
  const stopCheckInterval = setInterval(() => {
    if (checkStopSignal()) {
      clearInterval(stopCheckInterval);
      shutdown().catch(() => process.exit(1));
    }
  }, 1000);
}

const isEntry = process.argv[1]?.replace(/\\/g, '/').endsWith('/index.js') || process.argv[1]?.replace(/\\/g, '/').endsWith('/index.ts');
if (isEntry) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    closeLogger();
    process.exit(1);
  });
}
