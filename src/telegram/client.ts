import { Telegraf } from "telegraf";
import type { Config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("Telegram");

let bot: Telegraf;
let botUsername: string | undefined;

export function getBot(): Telegraf {
  if (!bot) throw new Error("Telegram bot not initialized");
  return bot;
}

export function getBotUsername(): string | undefined {
  return botUsername;
}

export async function initTelegram(
  config: Config,
  setupHandlers: (bot: Telegraf) => void,
): Promise<void> {
  const token = config.telegramBotToken ?? "";
  if (!token) {
    throw new Error("Telegram bot token is required");
  }
  bot = new Telegraf(token);
  setupHandlers(bot);
  const me = (await bot.telegram.getMe()) as { username?: string };
  botUsername = me.username;

  const launchWithRetry = async (attempt = 1): Promise<void> => {
    try {
      await bot.launch();
    } catch (err) {
      log.error("Telegram polling error:", err);
      try {
        bot.stop("Telegram polling error");
      } catch {
        /* ignore */
      }
      const maxAttempts = 10;
      const delayMs = Math.min(5000 * attempt, 60000);
      if (attempt < maxAttempts) {
        log.info(`Telegram reconnect in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/${maxAttempts})`);
        await new Promise((r) => setTimeout(r, delayMs));
        return launchWithRetry(attempt + 1);
      }
      log.error("Telegram gave up reconnecting, exiting");
      process.exit(1);
    }
  };
  void launchWithRetry();
  log.info("Telegram bot launched");
}

export function stopTelegram(): void {
  bot?.stop("SIGTERM");
}
