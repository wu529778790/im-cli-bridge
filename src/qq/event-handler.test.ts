import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QQMessageEvent } from "./types.js";

const sendThinkingMessageMock = vi.fn(async () => "stream-1");
const sendFinalMessagesMock = vi.fn(async () => {});
const sendTextReplyMock = vi.fn(async () => {});
const sendImageReplyMock = vi.fn(async () => {});
const sendErrorMessageMock = vi.fn(async () => {});
const runAITaskMock = vi.fn(async (_deps, _ctx, _prompt, _adapter, callbacks) => {
  await callbacks.sendComplete("ok", "耗时 0.1s");
});
const getAdapterMock = vi.fn(() => ({ name: "mock-adapter" }));

vi.mock("./message-sender.js", () => ({
  sendThinkingMessage: sendThinkingMessageMock,
  updateMessage: vi.fn(async () => {}),
  sendFinalMessages: sendFinalMessagesMock,
  sendErrorMessage: sendErrorMessageMock,
  sendTextReply: sendTextReplyMock,
  sendImageReply: sendImageReplyMock,
  sendModeKeyboard: vi.fn(async () => {}),
  sendDirectorySelection: vi.fn(async () => {}),
  startTypingLoop: vi.fn(() => vi.fn()),
}));

vi.mock("../shared/ai-task.js", () => ({
  runAITask: runAITaskMock,
}));

vi.mock("../adapters/registry.js", () => ({
  getAdapter: getAdapterMock,
}));

vi.mock("../hook/permission-server.js", () => ({
  registerPermissionSender: vi.fn(),
}));

function createPrivateMessage(id: string): QQMessageEvent {
  return {
    type: "private",
    id,
    content: "你好",
    userOpenid: "user-1",
  };
}

describe("QQ event handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores semantically duplicated events with different ids", async () => {
    const { setupQQHandlers } = await import("./event-handler.js");

    const config = {
      aiCommand: "codex",
      qqAllowedUserIds: ["user-1"],
      defaultPermissionMode: "ask",
      platforms: {
        qq: {
          enabled: true,
          aiCommand: "codex",
          allowedUserIds: ["user-1"],
        },
      },
    } as never;

    const sessionManager = {
      getWorkDir: vi.fn(() => "D:\\coding\\open-im"),
      getConvId: vi.fn(() => "conv-1"),
      getSessionIdForConv: vi.fn(() => "session-1"),
    } as never;

    const handler = setupQQHandlers(config, sessionManager);

    await handler.handleEvent(createPrivateMessage("evt-1"));
    await handler.handleEvent(createPrivateMessage("evt-2"));

    expect(sendThinkingMessageMock).toHaveBeenCalledTimes(1);
    expect(runAITaskMock).toHaveBeenCalledTimes(1);
    expect(sendFinalMessagesMock).toHaveBeenCalledTimes(1);
  });
});
