import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../permission-mode/session-mode.js", () => ({
  getPermissionMode: vi.fn(() => "ask"),
}));

import { runAITask } from "./ai-task.js";
import type { ToolAdapter } from "../adapters/tool-adapter.interface.js";

describe("runAITask", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("keeps the codex session on usage limit errors", async () => {
    const clearSessionForConv = vi.fn();
    const clearActiveToolSession = vi.fn();
    const setSessionIdForConv = vi.fn();
    const sessionManager = {
      addTurnsForThread: vi.fn(() => 0),
      addTurns: vi.fn(() => 0),
      setSessionIdForThread: vi.fn(),
      setSessionIdForConv,
      clearSessionForConv,
      clearActiveToolSession,
      getModel: vi.fn(() => undefined),
    };

    const streamUpdate = vi.fn();
    const sendComplete = vi.fn(async () => {});
    const sendError = vi.fn(async () => {});

    const toolAdapter: ToolAdapter = {
      toolId: "codex",
      run(_prompt, _sessionId, _workDir, callbacks) {
        callbacks.onError("You've hit your usage limit. To get more access now, send a request to your admin or try again at 12:56 PM.");
        return { abort: vi.fn() };
      },
    };

    const taskPromise = runAITask(
      {
        config: {
          aiCommand: "codex",
          defaultPermissionMode: "ask",
          codexTimeoutMs: 600000,
          claudeTimeoutMs: 600000,
          claudeSkipPermissions: false,
          claudeModel: "",
          hookPort: 35801,
          codexProxy: "",
        } as never,
        sessionManager: sessionManager as never,
      },
      {
        userId: "u1",
        chatId: "c1",
        workDir: "D:\\coding\\open-im",
        sessionId: "sess-1",
        convId: "conv-1",
        platform: "wework",
        taskKey: "task-1",
      },
      "hello",
      toolAdapter,
      {
        streamUpdate,
        sendComplete,
        sendError,
        throttleMs: 0,
        onTaskReady: vi.fn(),
      }
    );

    await taskPromise;

    expect(clearSessionForConv).not.toHaveBeenCalled();
    expect(clearActiveToolSession).not.toHaveBeenCalled();
    expect(sendComplete).not.toHaveBeenCalled();
    expect(sendError).toHaveBeenCalledOnce();
    expect(sendError).toHaveBeenCalledWith(expect.stringContaining("usage limit"));
    expect(streamUpdate).not.toHaveBeenCalled();
  });
});
