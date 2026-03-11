#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { main, needsSetup, runInteractiveSetup } from "./index.js";
import { loadConfig } from "./config.js";
import { runPlatformSelectionPrompt } from "./setup.js";
import { APP_HOME, SHUTDOWN_PORT } from "./constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PID_FILE = join(APP_HOME, "open-im.pid");
const PORT_FILE = join(APP_HOME, "open-im.port");
const INDEX_JS = join(__dirname, "index.js");

// ============================================================================
// PID 文件管理
// ============================================================================

function getPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function writePid(pid: number): void {
  try {
    writeFileSync(PID_FILE, String(pid), "utf-8");
  } catch (err) {
    console.error("无法写入 PID 文件:", err);
  }
}

function removePid(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// 配置校验
// ============================================================================

async function validateOrSetup(): Promise<boolean> {
  if (needsSetup()) {
    console.log("\n━━━ open-im 首次配置 ━━━\n");
    console.log("检测到尚未配置，将先进入配置向导...\n");
    const saved = await runInteractiveSetup();
    if (!saved) {
      console.log("配置未完成，已取消启动。");
      return false;
    }
    console.log("");
  }

  try {
    loadConfig();
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("配置无效或缺少必要字段:", msg);
    console.log("\n请运行以下命令重新配置:\n  npx @wu529778790/open-im init");
    return false;
  }
}

// ============================================================================
// 命令处理
// ============================================================================

async function cmdStart(skipPlatformPrompt = false): Promise<void> {
  const pid = getPid();
  if (pid && isRunning(pid)) {
    console.log(`open-im 已在后台运行 (pid=${pid})`);
    return;
  }
  removePid();

  if (!(await validateOrSetup())) {
    process.exit(1);
  }

  // 有 TTY 时在父进程让用户选择要启用的平台，再启动子进程
  // skipPlatformPrompt 为 true 时跳过提示（用于 restart 命令）
  let config = loadConfig();
  if (process.stdin.isTTY && !skipPlatformPrompt) {
    const updated = await runPlatformSelectionPrompt(config);
    if (!updated) {
      console.log("已取消启动。");
      process.exit(0);
    }
  }

  const child = spawn(process.execPath, [INDEX_JS], {
    detached: true,
    stdio: "ignore",
    cwd: process.cwd(),
    env: process.env,
    windowsHide: process.platform === "win32",
  });
  child.unref();

  writePid(child.pid!);
  console.log(`open-im 已在后台启动 (pid=${child.pid})`);
}

async function cmdStop(): Promise<void> {
  const pid = getPid();
  if (!pid) {
    console.log("open-im 未在后台运行");
    return;
  }
  if (!isRunning(pid)) {
    removePid();
    console.log("open-im 进程已不存在");
    return;
  }

  const port = existsSync(PORT_FILE)
    ? parseInt(readFileSync(PORT_FILE, "utf-8").trim(), 10) || SHUTDOWN_PORT
    : SHUTDOWN_PORT;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/shutdown`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (!isRunning(pid)) break;
      }
    }
  } catch {
    // HTTP 失败则用 SIGTERM 兜底
    process.kill(pid, "SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  }

  if (isRunning(pid)) {
    process.kill(pid, "SIGKILL");
  }

  removePid();
  try {
    if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE);
  } catch {
    /* ignore */
  }
  console.log(`open-im 已停止 (pid=${pid})`);
}

async function cmdRestart(): Promise<void> {
  const pid = getPid();
  const wasRunning = pid && isRunning(pid);

  if (wasRunning) {
    console.log(`正在停止 open-im (pid=${pid})...`);
    await cmdStop();
    // 等待进程完全停止
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (!isRunning(pid)) break;
    }
    console.log("open-im 已停止");
  } else {
    console.log("open-im 未在后台运行");
  }

  console.log("正在启动 open-im...");
  await cmdStart(true);  // 传递 true 跳过平台选择提示
}

async function cmdInit(): Promise<void> {
  console.log("\n━━━ open-im 配置向导 ━━━\n");
  const saved = await runInteractiveSetup();
  if (saved) {
    console.log("\n✅ 配置完成！");
    console.log("\n现在可以运行以下命令启动服务：");
    console.log("  open-im start   # 后台运行");
    console.log("  open-im dev     # 前台运行（调试）");
  } else {
    console.log("\n❌ 配置未完成，已取消。");
    process.exit(1);
  }
}

function showHelp(exitCode = 0): void {
  console.log(`
用法: open-im <command>

命令:
  start    后台运行服务
  stop     停止后台服务
  restart  重启服务
  init     配置向导（首次或追加配置，会覆盖已有 config.json）
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
  restart: cmdRestart,
  init: cmdInit,
  dev: main,
};

if (cmd === "--help" || cmd === "-h") {
  showHelp(0);
} else if (cmd === undefined) {
  main().catch((err) => {
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
