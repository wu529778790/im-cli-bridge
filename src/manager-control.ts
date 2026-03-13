import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_HOME } from "./constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PID_FILE = join(APP_HOME, "open-im.pid");
const READY_FILE = join(APP_HOME, "open-im.ready");

function getManagerEntry(): { command: string; args: string[] } {
  const extension = extname(fileURLToPath(import.meta.url));
  if (extension === ".ts") {
    return {
      command: process.execPath,
      args: ["--import", "tsx", join(__dirname, "manager.ts")],
    };
  }

  return {
    command: process.execPath,
    args: [join(__dirname, "manager.js")],
  };
}

function isRunning(pid: number): boolean {
  try {
    if (process.platform === "win32") {
      const result = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], {
        stdio: "pipe",
        windowsHide: true,
      }).toString();
      return result.includes(String(pid));
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getManagerPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function removeManagerPid(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

export function removeManagerReady(): void {
  try {
    if (existsSync(READY_FILE)) unlinkSync(READY_FILE);
  } catch {
    /* ignore */
  }
}

export function writeManagerReady(): void {
  if (!existsSync(APP_HOME)) mkdirSync(APP_HOME, { recursive: true });
  writeFileSync(READY_FILE, "1", "utf-8");
}

export function isManagerReady(): boolean {
  return existsSync(READY_FILE);
}

export function writeManagerPid(pid: number): void {
  if (!existsSync(APP_HOME)) mkdirSync(APP_HOME, { recursive: true });
  writeFileSync(PID_FILE, String(pid), "utf-8");
}

export function getManagerStatus(): { running: boolean; pid: number | null } {
  const pid = getManagerPid();
  if (!pid) return { running: false, pid: null };
  if (!isRunning(pid)) {
    removeManagerReady();
    removeManagerPid();
    return { running: false, pid: null };
  }
  return { running: true, pid };
}

export async function startManagerProcess(cwd: string): Promise<{ pid: number }> {
  const current = getManagerStatus();
  if (current.running && current.pid) {
    if (isManagerReady()) {
      return { pid: current.pid };
    }
    throw new Error("Manager process exists but is not ready yet.");
  }

  removeManagerReady();
  removeManagerPid();
  const entry = getManagerEntry();
  const child = spawn(entry.command, entry.args, {
    detached: true,
    stdio: "ignore",
    cwd,
    env: process.env,
    windowsHide: process.platform === "win32",
  });
  child.unref();

  if (!child.pid) {
    throw new Error("Failed to start manager process.");
  }

  writeManagerPid(child.pid);

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!isRunning(child.pid)) {
      removeManagerReady();
      removeManagerPid();
      throw new Error("Manager process exited before becoming ready.");
    }
    if (isManagerReady()) {
      return { pid: child.pid };
    }
  }

  removeManagerReady();
  removeManagerPid();
  try {
    process.kill(child.pid, "SIGTERM");
  } catch {
    /* ignore */
  }
  throw new Error("Manager process did not become ready in time.");
}

export async function stopManagerProcess(): Promise<{ pid: number | null; stopped: boolean }> {
  const pid = getManagerPid();
  if (!pid) {
    removeManagerReady();
    return { pid: null, stopped: false };
  }
  if (!isRunning(pid)) {
    removeManagerReady();
    removeManagerPid();
    return { pid, stopped: true };
  }

  try {
    process.kill(pid, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
  } catch {
    /* ignore */
  }

  if (isRunning(pid)) {
    process.kill(pid, "SIGKILL");
  }

  removeManagerReady();
  removeManagerPid();
  return { pid, stopped: true };
}
