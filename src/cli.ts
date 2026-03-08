#!/usr/bin/env node

import { main } from './index.js';
import { exec, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);

if (args[0] === 'stop') {
  exec("pkill -f 'node dist/index.js'", (err) => {
    if (err) {
      console.log('未找到运行中的服务');
    } else {
      console.log('服务已停止');
    }
  });
} else if (args[0] === 'start') {
  // 后台启动
  const distPath = join(__dirname, '..', 'dist', 'index.js');
  const child = spawn('node', [distPath], {
    detached: true,
    stdio: 'ignore',
    shell: true
  });
  child.unref();
  console.log('服务已在后台启动');
} else {
  // 默认启动（兼容直接运行 open-im）
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
