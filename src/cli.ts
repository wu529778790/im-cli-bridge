#!/usr/bin/env node

// 全局安装时从用户目录加载配置
import * as dotenv from 'dotenv';
import * as path from 'path';
import { getEnvPath, getConfigDir, getPidPath, ensureConfigDir } from './utils/config-path';

ensureConfigDir();
const envPath = getEnvPath();
dotenv.config({ path: envPath }); // 不存在则 no-op，环境变量优先

import { IMCLIBridge } from './index';
import { logger } from './utils/logger';
import { runHook, runHookInstall } from './hooks/claude-hook';
import { defaultConfig } from './config/default.config';
import * as fs from 'fs';
import * as readline from 'readline';
import { spawn } from 'child_process';

interface CLIOptions {
  command?: 'run' | 'start' | 'stop' | 'foreground' | 'init' | 'hook';
  config?: string;
  port?: number;
  host?: string;
  logLevel?: string;
  verbose?: boolean;
  version?: boolean;
  help?: boolean;
}

const PID_FILE = getPidPath();

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {};
  let i = 0;

  // 第一个参数可能是子命令
  const first = args[0];
  if (first === 'run' || first === 'start' || first === 'stop' || first === 'foreground' || first === 'init' || first === 'hook') {
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
  run, foreground    前台模式：直接运行，Ctrl+C 退出（默认）
  start              后台模式：启动服务
  stop               后台模式：停止服务
  init               初始化配置目录和 .env 模板
  hook                Claude SessionStart hook (写 session_map)
  hook --install     安装 hook 到 ~/.claude/settings.json

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
    const absolutePath = path.isAbsolute(configPath)
      ? configPath
      : path.resolve(process.cwd(), configPath);
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

function question(rl: readline.Interface, prompt: string, defaultValue?: string): Promise<string> {
  const p = defaultValue ? `${prompt} [${defaultValue}]: ` : `${prompt}: `;
  return new Promise((resolve) => {
    rl.question(p, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

async function ensureConfigOrPrompt(): Promise<void> {
  if (process.env.TELEGRAM_BOT_TOKEN?.trim()) return;

  console.log('\n未检测到 TELEGRAM_BOT_TOKEN，请配置后启动。');
  console.log('运行 im-cli-bridge init 可创建配置文件，或将 token 写入 ~/.im-cli-bridge/.env\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const token = await question(rl, '请输入 TELEGRAM_BOT_TOKEN（直接回车跳过，将退出）');
  if (!token) {
    rl.close();
    console.log('未输入 token，退出。');
    process.exit(1);
  }

  const aiCmd = await question(rl, '请输入 AI_COMMAND', 'claude');
  rl.close();

  process.env.TELEGRAM_BOT_TOKEN = token;
  if (aiCmd) process.env.AI_COMMAND = aiCmd;

  const envPath = getEnvPath();
  const lines = [
    `TELEGRAM_BOT_TOKEN=${token}`,
    `AI_COMMAND=${aiCmd || 'claude'}`,
    'LOG_LEVEL=info'
  ];
  fs.writeFileSync(envPath, lines.join('\n') + '\n');
  console.log(`\n已保存到 ${envPath}\n`);
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

async function startBackground(options: CLIOptions): Promise<void> {
  await ensureConfigOrPrompt();

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
    cwd: getConfigDir(),
    env: { ...process.env, IM_CLI_BRIDGE_DAEMON: '1' },
    windowsHide: true
  });

  child.unref();

  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log(`Bridge started in background (PID: ${child.pid})`);
  console.log('Use "im-cli-bridge stop" to stop.');
}

function runInit(): void {
  const envPath = getEnvPath();
  if (fs.existsSync(envPath)) {
    console.log(`Config already exists: ${envPath}`);
    return;
  }
  const pkgRoot = path.join(__dirname, '..');
  const examplePath = path.join(pkgRoot, '.env.example');
  if (!fs.existsSync(examplePath)) {
    fs.writeFileSync(envPath, [
      '# Telegram（必填）',
      'TELEGRAM_BOT_TOKEN=your_bot_token',
      '',
      '# AI CLI',
      'AI_COMMAND=claude',
      '',
      'LOG_LEVEL=info'
    ].join('\n'));
  } else {
    fs.copyFileSync(examplePath, envPath);
  }
  console.log(`Created ${envPath}`);
  console.log('Edit the file and add your TELEGRAM_BOT_TOKEN.');
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
    await ensureConfigOrPrompt();
    startBackground(options);
    return;
  }

  if (command === 'stop') {
    stopBackground();
    return;
  }

  if (command === 'init') {
    runInit();
    return;
  }

  if (command === 'hook') {
    const installFlag = args.includes('--install');
    process.exit(installFlag ? runHookInstall() : runHook());
    return;
  }

  // run / foreground
  try {
    await ensureConfigOrPrompt();
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
