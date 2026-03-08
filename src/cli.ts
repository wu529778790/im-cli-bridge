#!/usr/bin/env node

import { main } from './index.js';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// PID 文件路径
const PID_DIR = join(homedir(), '.open-im');
const PID_FILE = join(PID_DIR, 'daemon.pid');

// 保存 PID 到文件
async function savePid(pid: number): Promise<void> {
  try {
    await mkdir(PID_DIR, { recursive: true });
    await writeFile(PID_FILE, String(pid), 'utf-8');
  } catch (err) {
    console.error('无法保存 PID 文件:', err);
  }
}

// 读取 PID 文件
async function readPid(): Promise<number | null> {
  try {
    if (!existsSync(PID_FILE)) {
      return null;
    }
    const content = await readFile(PID_FILE, 'utf-8');
    return parseInt(content.trim(), 10);
  } catch {
    return null;
  }
}

// 删除 PID 文件
async function removePidFile(): Promise<void> {
  try {
    if (existsSync(PID_FILE)) {
      await rm(PID_FILE);
    }
  } catch {
    // 忽略删除错误
  }
}

// 检查进程是否在运行
async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    // 尝试发送信号 0（不杀死进程，只检查是否存在）
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 停止服务
async function stopService(): Promise<void> {
  const pid = await readPid();

  if (!pid) {
    console.log('未找到运行中的服务（PID 文件不存在）');
    return;
  }

  const running = await isProcessRunning(pid);

  if (!running) {
    console.log(`服务未运行（进程 ${pid} 不存在）`);
    await removePidFile();
    return;
  }

  try {
    // 尝试优雅终止 - Windows 使用 taskkill，其他系统使用 SIGTERM
    const isWindows = platform() === 'win32';
    if (isWindows) {
      // taskkill 会发送控制台关闭事件，Node.js 会将其转换为 SIGINT
      execFileSync('taskkill', ['/PID', String(pid)], {
        stdio: 'ignore',
        timeout: 5000,
      });
    } else {
      process.kill(pid, 'SIGTERM');
    }

    // 等待进程退出
    const maxWait = 5000; // 最多等待 5 秒
    const interval = 100;
    let waited = 0;

    while (waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, interval));
      if (!(await isProcessRunning(pid))) {
        break;
      }
      waited += interval;
    }

    // 如果还在运行，强制终止
    if (await isProcessRunning(pid)) {
      process.kill(pid, 'SIGKILL');
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    await removePidFile();
    console.log('服务已停止');
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`停止服务失败: ${errorMsg}`);
    // 清理可能失效的 PID 文件
    await removePidFile();
  }
}

const args = process.argv.slice(2);

if (args[0] === 'stop') {
  stopService().catch((err) => {
    console.error('停止服务时出错:', err);
    process.exit(1);
  });
} else if (args[0] === 'start') {
  // 后台启动 - 跨平台方案
  const distPath = join(__dirname, '..', 'dist', 'index.js');

  // 使用 detached 模式创建独立进程
  const child = spawn(process.execPath, [distPath], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true  // Windows 上隐藏控制台窗口
  });

  // 保存 PID
  await savePid(child.pid!);

  // 让子进程独立于父进程
  child.unref();

  console.log(`服务已在后台启动 (PID: ${child.pid})`);
} else {
  // 默认启动（兼容直接运行 open-im）
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
