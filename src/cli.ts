#!/usr/bin/env node

import { main, needsSetup, runInteractiveSetup } from "./index.js";
import { loadConfig } from "./config.js";
import { checkAndUpdate } from "./check-update.js";
import { getWebConfigUrl, runWebConfigFlow } from "./config-web.js";
import { getServiceStatus, removePid, startBackgroundService, stopBackgroundService } from "./service-control.js";

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

// ============================================================================
// 命令处理
// ============================================================================

async function cmdStart(): Promise<void> {
  const status = getServiceStatus();
  if (status.running && status.pid) {
    console.log("\n🟢 open-im 已在后台运行");
    console.log(`   pid: ${status.pid}`);
    return;
  }
  removePid();

  if (!(await ensureConfigured("start"))) {
    process.exit(1);
  }

  // 检查并自动更新到最新版本
  const { updated } = await checkAndUpdate();
  if (updated) {
    process.exit(0);
  }

  process.env.OPEN_IM_AUTO_OPEN_CONFIG_ONCE = "1";
  const child = startBackgroundService(process.cwd());
  delete process.env.OPEN_IM_AUTO_OPEN_CONFIG_ONCE;
  console.log("\n🟢 open-im 已在后台启动");
  console.log(`   pid: ${child.pid}`);
  console.log(`   配置页: ${getWebConfigUrl()}`);
}

async function cmdStop(): Promise<void> {
  const status = getServiceStatus();
  if (!status.pid) {
    console.log("open-im 未在后台运行");
    return;
  }
  const result = await stopBackgroundService();
  console.log("\n🔴 open-im 已停止");
  console.log(`   pid: ${result.pid}`);
}

async function cmdInit(): Promise<void> {
  console.log("\n━━━ open-im 本地控制台 ━━━\n");
  const saved = await ensureConfigured("init");
  if (!saved) {
    console.log("\n❌ 配置未完成，已取消。");
    process.exit(1);
  }
  console.log("\n✅ 配置完成！");
  console.log("\n现在可以运行以下命令启动服务：");
  console.log("  open-im start");
  console.log("  open-im dev");
}

async function cmdDev(): Promise<void> {
  if (!(await ensureConfigured("dev"))) {
    console.log("配置未完成，已取消启动。");
    process.exit(1);
  }
  await main();
}

function showHelp(exitCode = 0): void {
  console.log(`
用法: open-im <command>

命令:
  start    后台运行服务
  stop     停止后台服务
  init     打开本地 Web 配置页
  dev      前台运行（调试模式），Ctrl+C 停止

选项:
  -h, --help    显示此帮助信息
`);
  process.exit(exitCode);
}

// ============================================================================
// 命令路由
// ============================================================================

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
  console.error(`未知命令: ${cmd}`);
  showHelp(1);
}
