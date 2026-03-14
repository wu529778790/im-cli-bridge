import { beforeEach, describe, expect, it, vi } from "vitest";

const sendPrivateMessageMock = vi.fn();
const sendGroupMessageMock = vi.fn();
const sendChannelMessageMock = vi.fn();

vi.mock("./client.js", () => ({
  getQQBot: () => ({
    sendPrivateMessage: sendPrivateMessageMock,
    sendGroupMessage: sendGroupMessageMock,
    sendChannelMessage: sendChannelMessageMock,
  }),
}));

describe("QQ message sender", () => {
  beforeEach(() => {
    vi.resetModules();
    sendPrivateMessageMock.mockReset();
    sendGroupMessageMock.mockReset();
    sendChannelMessageMock.mockReset();
  });

  it("routes image replies through the fallback text sender", async () => {
    const sender = await import("./message-sender.js");

    await sender.sendImageReply("group:group-1", "C:\\images\\out.png");

    expect(sendGroupMessageMock).toHaveBeenCalledTimes(1);
    expect(sendGroupMessageMock.mock.calls[0][0]).toBe("group-1");
    expect(sendGroupMessageMock.mock.calls[0][1]).toContain("open-im");
    expect(sendGroupMessageMock.mock.calls[0][1]).toContain("C:\\images\\out.png");
  });

  it("does not send a second completion message after streaming the full reply", async () => {
    const sender = await import("./message-sender.js");

    const messageId = await sender.sendThinkingMessage("private:user-1", "reply-1", "codex");
    await sender.updateMessage("private:user-1", messageId, "第一段回复", "streaming", undefined, "codex");
    await sender.sendFinalMessages("private:user-1", messageId, "第一段回复", "耗时 1.2s", "codex");

    expect(sendPrivateMessageMock).toHaveBeenCalledTimes(1);
    expect(sendPrivateMessageMock.mock.calls[0][1]).toContain("第一段回复");
    expect(sendPrivateMessageMock.mock.calls[0][1]).not.toContain("耗时 1.2s");
  });

  it("resets the stream when content switches from a longer draft to a shorter answer", async () => {
    const sender = await import("./message-sender.js");

    const messageId = await sender.sendThinkingMessage("private:user-1", undefined, "codex");
    await sender.updateMessage(
      "private:user-1",
      messageId,
      "这是比较长的前置内容，用来模拟思考流。",
      "streaming",
      undefined,
      "codex",
    );
    await sender.updateMessage("private:user-1", messageId, "短答案", "streaming", undefined, "codex");

    expect(sendPrivateMessageMock).toHaveBeenCalledTimes(2);
    expect(sendPrivateMessageMock.mock.calls[1][1]).toContain("短答案");
  });
});
