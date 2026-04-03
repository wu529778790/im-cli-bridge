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
          platforms: {},
          enabledPlatforms: [],
          claudeModel: "",
          codexProxy: "",
          wechatUserId: "",
          dingtalkClientId: "",
          dingtalkClientSecret: "",
          qqAppId: "",
          qqSecret: "",
          weworkCorpId: "",
          weworkSecret: "",
          telegramBotToken: "",
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

  it("calls sendComplete on successful AI response", async () => {
    const sessionManager = {
      addTurnsForThread: vi.fn(() => 0),
      addTurns: vi.fn(() => 0),
      setSessionIdForThread: vi.fn(),
      setSessionIdForConv: vi.fn(),
      clearSessionForConv: vi.fn(),
      clearActiveToolSession: vi.fn(),
      getModel: vi.fn(() => undefined),
    };

    const streamUpdate = vi.fn();
    const sendComplete = vi.fn(async () => {});
    const sendError = vi.fn(async () => {});

    const toolAdapter: ToolAdapter = {
      toolId: "claude",
      run(_prompt, _sessionId, _workDir, callbacks) {
        // Simulate text streaming then completion
        callbacks.onText("Hello from AI");
        callbacks.onComplete({
          success: true,
          result: "done",
          accumulated: "Hello from AI",
          cost: 0.01,
          durationMs: 1500,
          numTurns: 1,
          toolStats: {},
        });
        return { abort: vi.fn() };
      },
    };

    const taskPromise = runAITask(
      {
        config: {
          aiCommand: "claude",
          platforms: {},
          enabledPlatforms: [],
          claudeModel: "",
          codexProxy: "",
          wechatUserId: "",
          dingtalkClientId: "",
          dingtalkClientSecret: "",
          qqAppId: "",
          qqSecret: "",
          weworkCorpId: "",
          weworkSecret: "",
          telegramBotToken: "",
        } as never,
        sessionManager: sessionManager as never,
      },
      {
        userId: "u1",
        chatId: "c1",
        workDir: "/tmp/project",
        sessionId: undefined,
        convId: "conv-2",
        platform: "telegram",
        taskKey: "task-2",
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

    expect(sendComplete).toHaveBeenCalledOnce();
    expect(sendComplete).toHaveBeenCalledWith(
      "Hello from AI",
      expect.any(String),
      undefined
    );
    expect(sendError).not.toHaveBeenCalled();
    expect(streamUpdate).toHaveBeenCalled();
  });

  it("calls sendError when adapter reports error", async () => {
    const sessionManager = {
      addTurnsForThread: vi.fn(() => 0),
      addTurns: vi.fn(() => 0),
      setSessionIdForThread: vi.fn(),
      setSessionIdForConv: vi.fn(),
      clearSessionForConv: vi.fn(),
      clearActiveToolSession: vi.fn(),
      newSession: vi.fn(() => true),
      getModel: vi.fn(() => undefined),
    };

    const streamUpdate = vi.fn();
    const sendComplete = vi.fn(async () => {});
    const sendError = vi.fn(async () => {});

    const toolAdapter: ToolAdapter = {
      toolId: "codex",
      run(_prompt, _sessionId, _workDir, callbacks) {
        callbacks.onError("Network connection failed");
        return { abort: vi.fn() };
      },
    };

    const taskPromise = runAITask(
      {
        config: {
          aiCommand: "codex",
          platforms: {},
          enabledPlatforms: [],
          claudeModel: "",
          codexProxy: "",
          wechatUserId: "",
          dingtalkClientId: "",
          dingtalkClientSecret: "",
          qqAppId: "",
          qqSecret: "",
          weworkCorpId: "",
          weworkSecret: "",
          telegramBotToken: "",
        } as never,
        sessionManager: sessionManager as never,
      },
      {
        userId: "u1",
        chatId: "c1",
        workDir: "/tmp/project",
        sessionId: "sess-3",
        convId: "conv-3",
        platform: "feishu",
        taskKey: "task-3",
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

    expect(sendError).toHaveBeenCalledOnce();
    expect(sendError).toHaveBeenCalledWith("Network connection failed");
    expect(sendComplete).not.toHaveBeenCalled();
    expect(streamUpdate).not.toHaveBeenCalled();
  });
});
