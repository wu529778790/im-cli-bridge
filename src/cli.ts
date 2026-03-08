#!/usr/bin/env node

import { main } from './index.js';
import { exec } from 'node:child_process';

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
  exec('node dist/index.js &', (err) => {
    if (err) {
      console.error('启动失败:', err);
      process.exit(1);
    } else {
      console.log('服务已在后台启动');
    }
  });
} else {
  // 默认启动（兼容直接运行 open-im）
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
