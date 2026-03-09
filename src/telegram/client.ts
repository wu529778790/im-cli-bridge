import { Telegraf } from 'telegraf';
import type { Config } from '../config.js';
import { createLogger } from '../logger.js';
import { HttpsProxyAgent } from 'https-proxy-agent';

const log = createLogger('Telegram');

let bot: Telegraf;
let botUsername: string | undefined;

export function getBot(): Telegraf {
  if (!bot) throw new Error('Telegram bot not initialized');
  return bot;
}

export function getBotUsername(): string | undefined {
  return botUsername;
}

export async function initTelegram(config: Config, setupHandlers: (bot: Telegraf) => void): Promise<void> {
  const telegrafOptions: Record<string, unknown> = {};

  // 配置代理
  if (config.proxy) {
    try {
      const agent = new HttpsProxyAgent(config.proxy);
      telegrafOptions.telegram = {
        agent,
      };
      log.info(`Using proxy: ${config.proxy}`);
    } catch (err) {
      log.warn(`Failed to create proxy agent: ${err}. Continuing without proxy.`);
    }
  }

  bot = new Telegraf(config.telegramBotToken, telegrafOptions);
  setupHandlers(bot);
  const me = (await bot.telegram.getMe()) as { username?: string };
  botUsername = me.username;
  bot.launch().catch((err) => {
    log.error('Telegram polling error:', err);
    process.exit(1);
  });
  log.info('Telegram bot launched');
}

export function stopTelegram(): void {
  bot?.stop('SIGTERM');
}
