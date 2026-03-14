import { beforeEach, describe, expect, it, vi } from "vitest";

const sendAGPMessageMock = vi.fn();

vi.mock("./client.js", () => ({
  sendAGPMessage: sendAGPMessageMock,
}));

describe("WeChat message sender", () => {
  beforeEach(() => {
    vi.resetModules();
    sendAGPMessageMock.mockReset();
  });

  it("routes image replies through session.promptResponse fallback text", async () => {
    const sender = await import("./message-sender.js");

    await sender.sendImageReply("session-1", "C:\\images\\out.png");

    expect(sendAGPMessageMock).toHaveBeenCalledTimes(1);
    expect(sendAGPMessageMock).toHaveBeenCalledWith(
      "session.promptResponse",
      expect.objectContaining({
        session_id: "session-1",
        status: "success",
        content: expect.stringContaining("open-im"),
      }),
    );
    expect(sendAGPMessageMock.mock.calls[0][1].content).toContain("C:\\images\\out.png");
  });

  it("marks the streaming message done in-place before sending overflow parts", async () => {
    const sender = await import("./message-sender.js");

    await sender.sendFinalMessages("session-1", "msg-1", "最终结果", "耗时 1s", "codex");

    expect(sendAGPMessageMock).toHaveBeenCalledTimes(1);
    expect(sendAGPMessageMock).toHaveBeenCalledWith(
      "session.update",
      expect.objectContaining({
        session_id: "session-1",
        updates: expect.objectContaining({
          status: "done",
          content: expect.stringContaining("最终结果"),
        }),
      }),
    );
    expect(sendAGPMessageMock.mock.calls[0][1].updates.content).toContain("耗时 1s");
  });
});
