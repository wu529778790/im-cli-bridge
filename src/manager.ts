import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_HOME } from "./constants.js";
import { openWebConfigUrl, startWebConfigServer } from "./config-web.js";
import { removeManagerPid, removeManagerReady, writeManagerReady } from "./manager-control.js";
import { startBackgroundService, stopBackgroundService } from "./service-control.js";

const CONFIG_UI_ONCE_FILE = join(APP_HOME, ".config-ui-once");

async function main(): Promise<void> {
  const web = await startWebConfigServer({ mode: "start", cwd: process.cwd(), persistent: true });
  startBackgroundService(process.cwd());
  writeManagerReady();

  if (process.env.OPEN_IM_AUTO_OPEN_CONFIG_ONCE === "1" && !existsSync(CONFIG_UI_ONCE_FILE)) {
    if (!existsSync(APP_HOME)) mkdirSync(APP_HOME, { recursive: true });
    writeFileSync(CONFIG_UI_ONCE_FILE, "1", "utf-8");
    openWebConfigUrl();
  }

  const shutdown = async () => {
    await web.close().catch(() => {});
    await stopBackgroundService().catch(() => {});
    removeManagerReady();
    removeManagerPid();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown().catch(() => process.exit(1)));
  process.on("SIGTERM", () => shutdown().catch(() => process.exit(1)));
}

const isEntry =
  process.argv[1]?.replace(/\\/g, "/").endsWith("/manager.js") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("/manager.ts");

if (isEntry) {
  main().catch((error) => {
    console.error("Manager fatal error:", error);
    removeManagerReady();
    removeManagerPid();
    process.exit(1);
  });
}
