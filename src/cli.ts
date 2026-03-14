#!/usr/bin/env node

import { main, needsSetup, runInteractiveSetup } from "./index.js";
import { loadConfig } from "./config.js";
import { checkAndUpdate } from "./check-update.js";
import { getWebConfigUrl, runWebConfigFlow } from "./config-web.js";
import { getManagerStatus, startManagerProcess, stopManagerProcess } from "./manager-control.js";
import { stopBackgroundService } from "./service-control.js";

async function ensureConfigured(mode: "init" | "start" | "dev"): Promise<boolean> {
  if (mode === "init") {
    if (!process.stdin.isTTY) {
      console.error("CLI setup requires an interactive terminal.");
      return false;
    }

    const saved = await runInteractiveSetup();
    if (!saved) return false;

    try {
      loadConfig();
      return true;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  if (!needsSetup()) {
    try {
      loadConfig();
      return true;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  const result = await runWebConfigFlow({ mode, cwd: process.cwd() });
  if (result !== "saved") return false;

  try {
    loadConfig();
    return true;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function cmdStart(): Promise<void> {
  const status = getManagerStatus();
  if (status.running && status.pid) {
    console.log("\nopen-im is already running in the background.");
    console.log(`  pid: ${status.pid}`);
    console.log(`  config page: ${getWebConfigUrl()}`);
    return;
  }

  if (!(await ensureConfigured("start"))) {
    process.exit(1);
  }

  await checkAndUpdate();

  const child = await startManagerProcess(process.cwd());
  console.log("\nopen-im started in the background.");
  console.log(`  pid: ${child.pid}`);
  console.log(`  config page: ${getWebConfigUrl()}`);
}

async function cmdStop(): Promise<void> {
  const status = getManagerStatus();
  if (!status.pid) {
    console.log("open-im is not running in the background.");
    return;
  }

  await stopBackgroundService();
  const result = await stopManagerProcess();
  console.log("\nopen-im stopped.");
  console.log(`  pid: ${result.pid}`);
}

async function cmdRestart(): Promise<void> {
  const status = getManagerStatus();
  if (status.pid) {
    await stopBackgroundService();
    const stopped = await stopManagerProcess();
    console.log("\nopen-im stopped.");
    console.log(`  pid: ${stopped.pid}`);
  } else {
    console.log("open-im is not running in the background. Starting a new instance.");
  }

  if (!(await ensureConfigured("start"))) {
    process.exit(1);
  }

  await checkAndUpdate();

  const child = await startManagerProcess(process.cwd());
  console.log("\nopen-im restarted in the background.");
  console.log(`  pid: ${child.pid}`);
  console.log(`  config page: ${getWebConfigUrl()}`);
}

async function cmdInit(): Promise<void> {
  console.log("\nopen-im CLI setup\n");

  const saved = await ensureConfigured("init");
  if (!saved) {
    console.log("\nConfiguration was not completed.");
    process.exit(1);
  }

  console.log("\nConfiguration saved.");
  console.log("\nYou can start the app with:");
  console.log("  open-im start");
  console.log("  open-im dev");
}

async function cmdDev(): Promise<void> {
  if (!(await ensureConfigured("dev"))) {
    console.log("Configuration was not completed.");
    process.exit(1);
  }
  await main();
}

async function cmdDashboard(): Promise<void> {
  // Start web config server in persistent mode (no timeout)
  const { startWebConfigServer, openWebConfigUrl } = await import("./config-web.js");
  const server = await startWebConfigServer({ mode: "dev", cwd: process.cwd(), persistent: true });
  console.log(`\nDashboard: ${server.url}`);
  console.log("Press Ctrl+C to close.\n");
  openWebConfigUrl();
  await server.waitForResult;
}

function showHelp(exitCode = 0): void {
  console.log(`
Usage: open-im <command>

Commands:
  start     Run the full app in the background and serve the dashboard
  stop      Stop the full app
  restart   Restart the full app in the background
  init      Run CLI setup
  dev       Run in the foreground for debugging
  dashboard Open the web dashboard (keeps running until Ctrl+C)

Local dashboard:
  http://127.0.0.1:39282
  - "start" keeps it available while the service runs
  - "dashboard" opens it standalone (use to modify existing config)
  - "dev" opens it only during initial setup

Options:
  -h, --help    Show this help message
`);
  process.exit(exitCode);
}

const cmd = process.argv[2];

const commands: Record<string, () => Promise<void>> = {
  start: cmdStart,
  stop: cmdStop,
  restart: cmdRestart,
  init: cmdInit,
  dev: cmdDev,
  dashboard: cmdDashboard,
};

if (cmd === "--help" || cmd === "-h") {
  showHelp(0);
} else if (cmd === undefined) {
  cmdDev().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (commands[cmd]) {
  commands[cmd]().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.error(`Unknown command: ${cmd}`);
  showHelp(1);
}
