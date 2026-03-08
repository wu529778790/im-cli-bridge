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
} else {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
