import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock, existsSyncMock, readFileSyncMock, unlinkSyncMock, writeFileSyncMock, spawnMock } =
  vi.hoisted(() => ({
    execFileSyncMock: vi.fn(),
    existsSyncMock: vi.fn(),
    readFileSyncMock: vi.fn(),
    unlinkSyncMock: vi.fn(),
    writeFileSyncMock: vi.fn(),
    spawnMock: vi.fn(),
  }));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
  spawn: spawnMock,
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
  unlinkSync: unlinkSyncMock,
  writeFileSync: writeFileSyncMock,
}));

import { waitForBackgroundServiceReady } from "./service-control.js";

describe("waitForBackgroundServiceReady", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Windows: isRunning() uses execFileSync('tasklist', ...)
    execFileSyncMock.mockReturnValue(Buffer.from("node.exe 123 Console 1 10,000 K"));
    // Non-Windows (e.g. CI): isRunning() uses process.kill(pid, 0); mock so it doesn't throw (pid 123 doesn't exist)
    killSpy = vi.spyOn(process, "kill").mockImplementation((_pid: number, sig?: number) => {
      if (sig === 0) return true;
      throw new Error("process.kill mock: only sig=0 supported");
    });
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it("returns once the worker pid is running and the port file appears", async () => {
    existsSyncMock.mockImplementation(
      (target: string) => target.includes("worker.pid") || target.includes("open-im.port"),
    );
    readFileSyncMock.mockImplementation((target: string) => (target.includes("worker.pid") ? "123" : "39281"));

    await expect(waitForBackgroundServiceReady(20, 0)).resolves.toBeUndefined();
  });

  it("fails if the worker never becomes ready", async () => {
    existsSyncMock.mockImplementation((target: string) => target.includes("worker.pid"));
    readFileSyncMock.mockReturnValue("123");

    await expect(waitForBackgroundServiceReady(10, 0)).rejects.toThrow(
      "Background service did not become ready in time.",
    );
  });
});
