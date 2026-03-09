import { Telegraf } from 'telegraf';
import type { Config } from '../config.js';
import { createLogger } from '../logger.js';

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
  const token = config.telegramBotToken ?? '';
  if (!token) {
    throw new Error('Telegram bot token is required');
  }
  bot = new Telegraf(token);
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
