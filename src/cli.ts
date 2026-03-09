#!/usr/bin/env node

import { main, needsSetup, runInteractiveSetup } from './index.js';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { platform, homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// PID 文件路径
const PID_DIR = join(homedir(), '.open-im');
const PID_FILE = join(PID_DIR, 'daemon.pid');
const STOP_FILE = join(PID_DIR, 'stop.flag');
const CONFIG_FILE = join(PID_DIR, 'config.json');

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

// 更新工作目录到配置文件
async function updateWorkDir(workDir: string): Promise<void> {
  try {
    await mkdir(PID_DIR, { recursive: true });

    let config: Record<string, any> = {};
    if (existsSync(CONFIG_FILE)) {
      try {
        config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      } catch {
        // 忽略解析错误
      }
    }

    // 更新工作目录
    config.claudeWorkDir = workDir;

    await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('无法保存工作目录配置:', err);
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

// 停止服务 - 创建停止标记文件，让服务优雅关闭
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
    // 创建停止标记文件，服务会定期检查并优雅关闭
    await mkdir(PID_DIR, { recursive: true });
    await writeFile(STOP_FILE, Date.now().toString(), 'utf-8');
    console.log('正在停止服务...');

    // 等待进程退出（最多 10 秒）
    const maxWait = 10000;
    const interval = 200;
    let waited = 0;

    while (waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, interval));
      if (!(await isProcessRunning(pid))) {
        await removePidFile();
        console.log('服务已停止');
        return;
      }
      waited += interval;
    }

    // 超时后强制终止
    console.log('等待超时，强制终止服务...');
    const isWindows = platform() === 'win32';
    if (isWindows) {
      execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    await removePidFile();
    console.log('服务已强制停止');
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`停止服务失败: ${errorMsg}`);
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
  // 首先检查是否需要配置
  if (needsSetup()) {
    console.log('\n━━━ open-im 首次配置 ━━━\n');
    console.log('检测到未配置，需要先完成配置才能启动服务\n');

    const saved = await runInteractiveSetup();
    if (!saved) {
      console.log('配置未完成，取消启动。');
      process.exit(1);
    }
    console.log('');
  }

  // 获取当前工作目录
  const currentDir = process.cwd();

  // 更新配置中的工作目录
  await updateWorkDir(currentDir);
  console.log(`工作目录已设置为: ${currentDir}`);

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
