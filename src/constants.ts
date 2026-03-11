import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

export const APP_HOME = join(homedir(), ".open-im");
/** 优雅关闭 HTTP 端口（stop 命令通过此端口触发 shutdown） */
export const SHUTDOWN_PORT = 39281;
export const IMAGE_DIR = join(tmpdir(), "open-im-images");

export const READ_ONLY_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoRead",
];

export const TERMINAL_ONLY_COMMANDS = new Set([
  "/context",
  "/rewind",
  "/resume",
  "/copy",
  "/export",
  "/config",
  "/init",
  "/memory",
  "/permissions",
  "/theme",
  "/vim",
  "/statusline",
  "/terminal-setup",
  "/debug",
  "/tasks",
  "/mcp",
  "/teleport",
  "/add-dir",
]);

export const DEDUP_TTL_MS = 5 * 60 * 1000;
/** 飞书流式更新节流：250ms（约 4 次/秒，留余量避免 5 QPS 频控） */
export const FEISHU_THROTTLE_MS = 250;
/** Telegram 编辑消息节流：200ms（open-im 默认值） */
export const TELEGRAM_THROTTLE_MS = 200;
/** WeChat 流式更新节流：1000ms（AGP 协议建议值） */
export const WECHAT_THROTTLE_MS = 1000;
export const WEWORK_THROTTLE_MS = 500;
export const MAX_TELEGRAM_MESSAGE_LENGTH = 4000;
export const MAX_FEISHU_MESSAGE_LENGTH = 4000;
export const MAX_WECHAT_MESSAGE_LENGTH = 2048;
export const MAX_WEWORK_MESSAGE_LENGTH = 2048;
