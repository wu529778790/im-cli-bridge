import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_HOME, SHUTDOWN_PORT } from "./constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PID_FILE = join(APP_HOME, "open-im-worker.pid");
const PORT_FILE = join(APP_HOME, "open-im.port");

function removePortFile(): void {
  try {
    if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE);
  } catch {
    /* ignore */
  }
}

function getServiceEntry(): { command: string; args: string[] } {
  const extension = extname(fileURLToPath(import.meta.url));
  if (extension === ".ts") {
    return {
      command: process.execPath,
      args: ["--import", "tsx", join(__dirname, "index.ts")],
    };
  }

  return {
    command: process.execPath,
    args: [join(__dirname, "index.js")],
  };
}

export function getPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function writePid(pid: number): void {
  writeFileSync(PID_FILE, String(pid), "utf-8");
}

export function removePid(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

export function isRunning(pid: number): boolean {
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

export function getServiceStatus(): { running: boolean; pid: number | null } {
  const pid = getPid();
  if (!pid) return { running: false, pid: null };
  if (!isRunning(pid)) {
    removePid();
    removePortFile();
    return { running: false, pid: null };
  }
  return { running: true, pid };
}

export function startBackgroundService(cwd: string): { pid: number } {
  const current = getServiceStatus();
  if (current.running && current.pid) {
    return { pid: current.pid };
  }

  removePid();
  removePortFile();
  const entry = getServiceEntry();
  const child = spawn(entry.command, entry.args, {
    detached: true,
    stdio: "ignore",
    cwd,
    env: process.env,
    windowsHide: process.platform === "win32",
  });
  child.unref();

  if (!child.pid) {
    throw new Error("Failed to start background service.");
  }

  writePid(child.pid);
  return { pid: child.pid };
}

export async function waitForBackgroundServiceReady(
  timeoutMs = 8000,
  pollIntervalMs = 100,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = getServiceStatus();
    if (!status.running || !status.pid) {
      throw new Error("Background service exited before becoming ready.");
    }

    if (existsSync(PORT_FILE)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Background service did not become ready in time.");
}

export async function stopBackgroundService(): Promise<{ pid: number | null; stopped: boolean }> {
  const pid = getPid();
  if (!pid) return { pid: null, stopped: false };
  if (!isRunning(pid)) {
    removePid();
    return { pid, stopped: true };
  }

  const port = existsSync(PORT_FILE)
    ? parseInt(readFileSync(PORT_FILE, "utf-8").trim(), 10) || SHUTDOWN_PORT
    : SHUTDOWN_PORT;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/shutdown`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      for (let index = 0; index < 50; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!isRunning(pid)) break;
      }
    }
  } catch {
    process.kill(pid, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (isRunning(pid)) {
    process.kill(pid, "SIGKILL");
  }

  removePid();
  removePortFile();

  return { pid, stopped: true };
}
