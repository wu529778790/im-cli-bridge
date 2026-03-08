#!/usr/bin/env node

// Load environment variables from .env file
import * as dotenv from 'dotenv';
dotenv.config();

import { IMCLIBridge } from './index';
import { logger } from './utils/logger';
import { defaultConfig } from './config/default.config';
import * as fs from 'fs';
import * as path from 'path';

interface CLIOptions {
  config?: string;
  port?: number;
  host?: string;
  logLevel?: string;
  verbose?: boolean;
  version?: boolean;
  help?: boolean;
}

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
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
      case '-h':
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
  im-cli-bridge [OPTIONS]

OPTIONS:
  -c, --config <path>      Path to custom configuration file
  -p, --port <number>      Server port (default: 3000)
  -h, --host <address>     Server host (default: localhost)
  -l, --log-level <level>  Log level: debug, info, warn, error (default: info)
  -v, --verbose            Enable verbose logging
      --version            Show version information
      --help               Show this help message

ENVIRONMENT VARIABLES:
  FEISHU_APP_ID           Feishu application ID
  FEISHU_APP_SECRET       Feishu application secret
  FEISHU_ENCRYPT_KEY      Feishu encryption key
  FEISHU_VERIFICATION_TOKEN  Feishu verification token
  TELEGRAM_BOT_TOKEN      Telegram bot token
  TELEGRAM_WEBHOOK_URL    Telegram webhook URL
  LOG_LEVEL               Logging level

EXAMPLES:
  # Start with default configuration
  im-cli-bridge

  # Start with custom port
  im-cli-bridge --port 8080

  # Start with custom configuration file
  im-cli-bridge --config ./config/custom.config.js

  # Start with verbose logging
  im-cli-bridge --verbose

  # Start using environment variables
  FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx im-cli-bridge

For more information, visit: https://github.com/yourusername/im-cli-bridge
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

    // Clear require cache to allow config reloading
    delete require.cache[require.resolve(absolutePath)];

    const config = require(absolutePath);
    return config.default || config;
  } catch (error) {
    logger.error(`Failed to load configuration from ${configPath}`, error);
    throw error;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Handle help
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Handle version
  if (options.version) {
    printVersion();
    process.exit(0);
  }

  // Load configuration
  let config = { ...defaultConfig };

  if (options.config) {
    const customConfig = loadCustomConfig(options.config);
    config = { ...config, ...customConfig };
  }

  // Apply CLI options
  if (options.port) {
    config.server.port = options.port;
  }

  if (options.host) {
    config.server.host = options.host;
  }

  if (options.logLevel || options.verbose) {
    config.logging.level = (options.logLevel || 'debug') as any;
  }

  // Override logger level
  if (config.logging.level) {
    process.env.LOG_LEVEL = config.logging.level;
  }

  try {
    // Create and start bridge
    const bridge = new IMCLIBridge(config);

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await bridge.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await bridge.stop();
      process.exit(0);
    });

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', error);
      bridge.stop().then(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', reason);
      bridge.stop().then(() => process.exit(1));
    });

    // Initialize and start the bridge
    await bridge.initialize();
    await bridge.start();

    logger.info('Bridge is running. Press Ctrl+C to stop.');

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
