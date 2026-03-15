/**
 * 启动时检查并自动更新到最新版本
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createLogger } from "./logger.js";

const log = createLogger("CheckUpdate");
const require = createRequire(import.meta.url);
const { version: CURRENT_VERSION } = require("../package.json") as { version: string };

const PKG_NAME = "@wu529778790/open-im";
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PKG_NAME)}`;

/** 从 npm registry 获取最新版本 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${REGISTRY_URL}?fields=dist-tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { "dist-tags"?: { latest?: string } };
    return data["dist-tags"]?.latest ?? null;
  } catch {
    return null;
  }
}

/** 简单 semver 比较：若 a < b 返回 true */
function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string) => {
    const m = v.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : [0, 0, 0];
  };
  const [c1, c2, c3] = parse(current);
  const [l1, l2, l3] = parse(latest);
  if (l1 !== c1) return l1 > c1;
  if (l2 !== c2) return l2 > c2;
  return l3 > c3;
}

/** 执行全局更新 */
function runGlobalUpdate(): boolean {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["install", "-g", `${PKG_NAME}@latest`], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return result.status === 0;
}

async function confirmUpdate(latest: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log.info(`检测到新版本 v${latest}，可手动更新: npm install -g ${PKG_NAME}@latest`);
    return false;
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`\n📦 检测到新版本 v${latest}，是否现在更新？[Y/n] `);
    return /^(|y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * 检查更新，若有新版本则询问用户是否执行全局更新
 * @returns true 表示已更新，调用方应继续当前 start/restart 流程以拉起最新版本
 */
export async function checkAndUpdate(): Promise<{ updated: boolean; latest?: string }> {
  const latest = await fetchLatestVersion();
  if (!latest || !isNewerVersion(CURRENT_VERSION, latest)) {
    return { updated: false };
  }

  const shouldUpdate = await confirmUpdate(latest);
  if (!shouldUpdate) {
    return { updated: false, latest };
  }

  log.info(`检测到新版本 v${latest}（当前 v${CURRENT_VERSION}），正在更新...`);
  const ok = runGlobalUpdate();
  if (ok) {
    log.info(`已更新到 v${latest}，继续按最新版本启动服务...`);
    return { updated: true, latest };
  }
  log.warn("自动更新失败，请手动执行: npm install -g @wu529778790/open-im@latest");
  return { updated: false };
}
