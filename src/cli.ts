#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './index.js';
import { APP_HOME } from './constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PID_FILE = join(APP_HOME, 'open-im.pid');
const INDEX_JS = join(__dirname, 'index.js');

function getPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function writePid(pid: number): void {
  try {
    writeFileSync(PID_FILE, String(pid), 'utf-8');
  } catch (err) {
    console.error('无法写入 PID 文件:', err);
  }
}

function removePid(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cmdStart(): Promise<void> {
  const pid = getPid();
  if (pid && isRunning(pid)) {
    console.log(`open-im 已在后台运行 (pid=${pid})`);
    return;
  }
  removePid();

  const child = spawn(process.execPath, [INDEX_JS], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    env: process.env,
    windowsHide: process.platform === 'win32',
  });
  child.unref();

  writePid(child.pid!);
  console.log(`open-im 已在后台启动 (pid=${child.pid})`);
}

function cmdStop(): void {
  const pid = getPid();
  if (!pid) {
    console.log('open-im 未在后台运行');
    return;
  }
  if (!isRunning(pid)) {
    removePid();
    console.log('open-im 进程已不存在');
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    removePid();
    console.log(`open-im 已停止 (pid=${pid})`);
  } catch (err) {
    console.error('停止失败:', err);
    process.exit(1);
  }
}

const cmd = process.argv[2];
if (cmd === 'start') {
  cmdStart().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (cmd === 'stop') {
  cmdStop();
} else if (cmd === 'run' || cmd === undefined) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.log(`用法: open-im [start|stop|run]
  start  - 后台运行
  stop   - 停止后台进程
  run    - 前台运行（默认），Ctrl+C 停止`);
  process.exit(cmd === '--help' || cmd === '-h' ? 0 : 1);
}
