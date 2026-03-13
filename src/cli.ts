#!/usr/bin/env node

import { main, needsSetup, runInteractiveSetup } from "./index.js";
import { loadConfig } from "./config.js";
import { checkAndUpdate } from "./check-update.js";
import { getWebConfigUrl, openWebConfigUrl, runWebConfigFlow } from "./config-web.js";
import { getManagerStatus, startManagerProcess, stopManagerProcess } from "./manager-control.js";
import { stopBackgroundService } from "./service-control.js";

async function ensureConfigured(mode: "init" | "start" | "dev"): Promise<boolean> {
  const forceWeb = process.env.OPEN_IM_FORCE_WEB === "1";

  if (mode !== "init" && !needsSetup()) {
    try {
      loadConfig();
      return true;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  if (!process.stdin.isTTY && !forceWeb) {
    return runInteractiveSetup();
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

  const { updated } = await checkAndUpdate();
  if (updated) {
    process.exit(0);
  }

  process.env.OPEN_IM_AUTO_OPEN_CONFIG_ONCE = "1";
  try {
    const child = await startManagerProcess(process.cwd());
    console.log("\nopen-im started in the background.");
    console.log(`  pid: ${child.pid}`);
    console.log(`  config page: ${getWebConfigUrl()}`);
  } finally {
    delete process.env.OPEN_IM_AUTO_OPEN_CONFIG_ONCE;
  }
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

async function cmdInit(): Promise<void> {
  console.log("\nopen-im local control\n");

  const status = getManagerStatus();
  if (status.running && status.pid) {
    openWebConfigUrl();
    console.log(`Config page is already running: ${getWebConfigUrl()}`);
    return;
  }

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

function showHelp(exitCode = 0): void {
  console.log(`
Usage: open-im <command>

Commands:
  start    Run the full app in the background
  stop     Stop the full app
  init     Open the local web configuration page
  dev      Run in the foreground for debugging

Options:
  -h, --help    Show this help message
`);
  process.exit(exitCode);
}

const cmd = process.argv[2];

const commands: Record<string, () => Promise<void>> = {
  start: cmdStart,
  stop: cmdStop,
  init: cmdInit,
  dev: cmdDev,
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
