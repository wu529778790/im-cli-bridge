import { startWebConfigServer } from "./config-web.js";
import { removeManagerPid, removeManagerReady, writeManagerReady } from "./manager-control.js";
import { startBackgroundService, stopBackgroundService } from "./service-control.js";

async function main(): Promise<void> {
  const web = await startWebConfigServer({ mode: "start", cwd: process.cwd(), persistent: true });
  startBackgroundService(process.cwd());
  writeManagerReady();

  const shutdown = async () => {
    await web.close().catch((err) => console.warn("[manager] Failed to close web server:", err));
    await stopBackgroundService().catch((err) => console.warn("[manager] Failed to stop background service:", err));
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
