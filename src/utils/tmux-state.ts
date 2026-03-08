/**
 * Tmux 模式下 user_id -> window 的持久化状态
 */

import * as fs from 'fs';
import { getStatePath } from './config-path';

export interface TmuxSessionState {
  windowId: string;
  workDir: string;
}

let state: Record<string, TmuxSessionState> = {};
let dirty = false;

function load(): void {
  try {
    const raw = fs.readFileSync(getStatePath(), 'utf-8');
    state = JSON.parse(raw) || {};
  } catch {
    state = {};
  }
}

function save(): void {
  if (!dirty) return;
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2) + '\n');
    dirty = false;
  } catch (e) {
    console.error('Failed to save tmux state', e);
  }
}

export function getTmuxState(userId: string): TmuxSessionState | null {
  if (Object.keys(state).length === 0) load();
  return state[userId] || null;
}

export function setTmuxState(userId: string, session: TmuxSessionState): void {
  if (Object.keys(state).length === 0) load();
  state[userId] = session;
  dirty = true;
  save();
}

export function removeTmuxState(userId: string): void {
  if (Object.keys(state).length === 0) load();
  delete state[userId];
  dirty = true;
  save();
}

export function getUserIdByWindowId(windowId: string): string | null {
  if (Object.keys(state).length === 0) load();
  for (const [uid, s] of Object.entries(state)) {
    if (s.windowId === windowId) return uid;
  }
  return null;
}
