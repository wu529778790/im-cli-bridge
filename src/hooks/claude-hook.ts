/**
 * Claude Code SessionStart hook - 写入 session_map.json
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { getSessionMapPath } from '../utils/config-path';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

interface HookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
}

function readStdin(): string {
  return fs.readFileSync(0, 'utf-8');
}

function installHook(): number {
  ensureConfigDir();
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    try {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf-8'));
    } catch (e) {
      console.error(`Error reading ${CLAUDE_SETTINGS}:`, e);
      return 1;
    }
  }

  const hooks = (settings.hooks as Record<string, unknown[]>) || {};
  let sessionStart = (hooks.SessionStart as unknown[]) || [];
  const hookCmd = 'im-cli-bridge hook';
  const already = sessionStart.some((entry: any) => {
    const inner = entry?.hooks || [];
    return inner.some((h: any) => (h?.command || '').includes('im-cli-bridge hook'));
  });
  if (already) {
    console.log(`Hook already installed in ${CLAUDE_SETTINGS}`);
    return 0;
  }

  const nodePath = process.execPath;
  const cliPath = path.join(__dirname, '..', 'cli.js');
  const fullCmd = `"${nodePath}" "${cliPath}" hook`;
  if (!settings.hooks) settings.hooks = {};
  (settings.hooks as Record<string, unknown[]>).SessionStart = sessionStart;
  sessionStart.push({
    hooks: [{ type: 'command', command: fullCmd, timeout: 5 }]
  });

  try {
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  } catch (e) {
    console.error(`Error writing ${CLAUDE_SETTINGS}:`, e);
    return 1;
  }
  console.log(`Hook installed in ${CLAUDE_SETTINGS}`);
  return 0;
}

function ensureConfigDir(): void {
  const dir = path.join(os.homedir(), '.im-cli-bridge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function runHook(): number {
  try {
    const raw = readStdin().trim();
    if (!raw) return 0;
    const payload: HookPayload = JSON.parse(raw || '{}');
    const sessionId = payload.session_id || '';
    const cwd = payload.cwd || '';
    const event = payload.hook_event_name || '';

    if (!sessionId || !event) return 0;
    if (!UUID_RE.test(sessionId)) return 0;
    if (event !== 'SessionStart') return 0;

    const paneId = process.env.TMUX_PANE || '';
    if (!paneId) return 0;

    const out = execSync(
      `tmux display-message -t "${paneId}" -p "#{session_name}:#{window_id}:#{window_name}"`,
      { encoding: 'utf-8' }
    ).trim();
    const parts = out.split(':');
    if (parts.length < 2) return 0;

    const sessionName = parts[0];
    const windowId = parts[1];
    const windowName = parts[2] || '';
    const sessionWindowKey = `${sessionName}:${windowId}`;

    ensureConfigDir();
    const mapPath = getSessionMapPath();
    let sessionMap: Record<string, { session_id: string; cwd?: string; window_name?: string }> = {};
    if (fs.existsSync(mapPath)) {
      try {
        sessionMap = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
      } catch {
        sessionMap = {};
      }
    }

    sessionMap[sessionWindowKey] = { session_id: sessionId, cwd, window_name: windowName };
    fs.writeFileSync(mapPath, JSON.stringify(sessionMap, null, 2) + '\n');
  } catch {
    // ignore
  }
  return 0;
}

export function runHookInstall(): number {
  return installHook();
}
