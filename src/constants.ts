import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

export const APP_HOME = join(homedir(), '.open-im');
export const IMAGE_DIR = join(tmpdir(), 'open-im-images');

export const READ_ONLY_TOOLS = [
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoRead',
];

export const TERMINAL_ONLY_COMMANDS = new Set([
  '/context', '/rewind', '/resume', '/copy', '/export', '/config',
  '/init', '/memory', '/permissions', '/theme', '/vim', '/statusline',
  '/terminal-setup', '/debug', '/tasks', '/mcp', '/teleport', '/add-dir',
]);

export const DEDUP_TTL_MS = 5 * 60 * 1000;
export const THROTTLE_MS = 200;
export const MAX_TELEGRAM_MESSAGE_LENGTH = 4000;
export const MAX_FEISHU_MESSAGE_LENGTH = 4000;
