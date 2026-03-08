#!/usr/bin/env node

// Load environment variables from .env file
import * as dotenv from 'dotenv';
dotenv.config();

import { IMCLIBridge } from './index';
import { logger } from './utils/logger';
import { defaultConfig } from './config/default.config';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

interface CLIOptions {
  command?: 'run' | 'start' | 'stop' | 'foreground';
  config?: string;
  port?: number;
  host?: string;
  logLevel?: string;
  verbose?: boolean;
  version?: boolean;
  help?: boolean;
}

const PID_FILE = path.join(process.cwd(), '.im-cli-bridge.pid');

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {};
  let i = 0;

  // 第一个参数可能是子命令
  const first = args[0];
  if (first === 'run' || first === 'start' || first === 'stop' || first === 'foreground') {
    options.command = first;
    i = 1;
  } else if (first === '--help' || first === '-h' || first === '--version' || first === '-v') {
    // 保持原有逻辑
  }

  for (; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '-c':
      case '--config':
        options.config = nextArg;
        i++;
        break;
      case '-p':
      case '--port':
        options.port = parseInt(nextArg, 10);
        i++;
        break;
      case '-H':
      case '--host':
        options.host = nextArg;
        i++;
        break;
      case '-l':
      case '--log-level':
        options.logLevel = nextArg;
        i++;
        break;
      case '-v':
      case '--verbose':
        options.verbose = true;
        break;
      case '--version':
        options.version = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
IM CLI Bridge - Bridge between IM platforms and CLI tools

USAGE:
  im-cli-bridge [COMMAND] [OPTIONS]

COMMANDS:
  run, foreground    前台模式：直接运行，日志输出到控制台，Ctrl+C 退出（默认）
  start              后台模式：启动后台服务，需用 stop 停止
  stop               后台模式：停止后台服务

OPTIONS:
  -c, --config <path>   Custom configuration file
  -p, --port <number>   Server port (default: 3000)
  -H, --host <address>  Server host
  -l, --log-level <level>  Log level: debug, info, warn, error
  -v, --verbose          Verbose logging
      --version          Show version
      --help             Show this help

EXAMPLES:
  # 前台运行（默认），Ctrl+C 退出
  im-cli-bridge
  im-cli-bridge run

  # 后台运行
  im-cli-bridge start
  im-cli-bridge stop

  # 带参数
  im-cli-bridge run --log-level debug
  im-cli-bridge start -c ./config/custom.js
`);
}

function printVersion(): void {
  const packagePath = path.join(__dirname, '../package.json');
  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    console.log(`IM CLI Bridge v${packageJson.version}`);
  } catch {
    console.log('IM CLI Bridge v1.0.0');
  }
}

function loadCustomConfig(configPath: string): Partial<any> {
  try {
    const absolutePath = path.resolve(process.cwd(), configPath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }
    delete require.cache[require.resolve(absolutePath)];
    const config = require(absolutePath);
    return config.default || config;
  } catch (error) {
    logger.error(`Failed to load configuration from ${configPath}`, error);
    throw error;
  }
}

function getConfig(options: CLIOptions) {
  let config = { ...defaultConfig };
  if (options.config) {
    const customConfig = loadCustomConfig(options.config);
    config = { ...config, ...customConfig };
  }
  if (options.port) config.server.port = options.port;
  if (options.host) config.server.host = options.host;
  if (options.logLevel || options.verbose) {
    config.logging.level = (options.logLevel || 'debug') as any;
  }
  if (config.logging.level) {
    process.env.LOG_LEVEL = config.logging.level;
  }
  return config;
}

async function runForeground(config: any): Promise<void> {
  const bridge = new IMCLIBridge(config);

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    await bridge.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    await bridge.stop();
    process.exit(0);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    bridge.stop().then(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', reason);
    bridge.stop().then(() => process.exit(1));
  });

  await bridge.initialize();
  await bridge.start();
  logger.info('Bridge is running. Press Ctrl+C to stop.');
}

function startBackground(options: CLIOptions): void {
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    try {
      process.kill(pid, 0);
      console.log(`Bridge is already running (PID: ${pid}). Use 'im-cli-bridge stop' first.`);
      return;
    } catch {
      // 进程不存在，删除旧 pid 文件
      fs.unlinkSync(PID_FILE);
    }
  }

  const cliPath = path.join(__dirname, 'cli.js');
  const args = [cliPath, 'run'];
  if (options.config) args.push('-c', options.config);
  if (options.port) args.push('-p', String(options.port));
  if (options.host) args.push('-H', options.host);
  if (options.logLevel) args.push('-l', options.logLevel);
  if (options.verbose) args.push('-v');

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    env: { ...process.env, IM_CLI_BRIDGE_DAEMON: '1' },
    windowsHide: true
  });

  child.unref();

  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log(`Bridge started in background (PID: ${child.pid})`);
  console.log('Use "im-cli-bridge stop" to stop.');
}

function stopBackground(): void {
  if (!fs.existsSync(PID_FILE)) {
    console.log('Bridge is not running (no PID file found).');
    return;
  }

  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
  try {
    process.kill(pid, 'SIGTERM');
    fs.unlinkSync(PID_FILE);
    console.log(`Bridge stopped (PID: ${pid}).`);
  } catch (err: any) {
    if (err.code === 'ESRCH') {
      fs.unlinkSync(PID_FILE);
      console.log('Bridge was not running (stale PID file removed).');
    } else {
      console.error(`Failed to stop bridge: ${err.message}`);
      process.exit(1);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.version) {
    printVersion();
    process.exit(0);
  }

  const config = getConfig(options);
  const command = options.command || 'run';

  if (command === 'start') {
    startBackground(options);
    return;
  }

  if (command === 'stop') {
    stopBackground();
    return;
  }

  // run / foreground
  try {
    await runForeground(config);
  } catch (error) {
    logger.error('Failed to start bridge', error);
    process.exit(1);
  }
}

// Run CLI
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main, parseArgs, printHelp, printVersion, loadCustomConfig };
