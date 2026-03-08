#!/usr/bin/env node

import { main } from './index.js';
import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { platform } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);

if (args[0] === 'stop') {
  // 跨平台停止服务
  const isWindows = platform() === 'win32';
  const cmd = isWindows
    ? 'taskkill /F /IM node.exe /FI "WINDOWTITLE eq node*dist\\index.js*"'
    : "pkill -f 'node.*dist/index.js'";

  exec(cmd, (err) => {
    if (err) {
      console.log('未找到运行中的服务');
    } else {
      console.log('服务已停止');
    }
  });
} else if (args[0] === 'start') {
  // 后台启动 - 跨平台方案
  const distPath = join(__dirname, '..', 'dist', 'index.js');

  // 使用 detached 模式创建独立进程
  const child = spawn(process.execPath, [distPath], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });

  // 让子进程独立于父进程
  child.unref();

  console.log('服务已在后台启动');
} else {
  // 默认启动（兼容直接运行 open-im）
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
