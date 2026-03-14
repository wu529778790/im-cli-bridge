import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    vi.useFakeTimers();
    vi.resetModules();
    sendPrivateMessageMock.mockReset();
    sendGroupMessageMock.mockReset();
    sendChannelMessageMock.mockReset();
    sendPrivateMessageMock.mockResolvedValue(undefined);
    sendGroupMessageMock.mockResolvedValue(undefined);
    sendChannelMessageMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes image replies through the fallback text sender", async () => {
    const sender = await import("./message-sender.js");

    await sender.sendImageReply("group:group-1", "C:\\images\\out.png");

    expect(sendGroupMessageMock).toHaveBeenCalledTimes(1);
    expect(sendGroupMessageMock.mock.calls[0][0]).toBe("group-1");
    expect(sendGroupMessageMock.mock.calls[0][1]).toContain("open-im");
    expect(sendGroupMessageMock.mock.calls[0][1]).toContain("C:\\images\\out.png");
  });

  it("ignores intermediate stream updates and sends only the final reply", async () => {
    const sender = await import("./message-sender.js");

    const messageId = await sender.sendThinkingMessage("private:user-1", "reply-1", "codex");
    await sender.updateMessage("private:user-1", messageId, "第一段", "streaming", undefined, "codex");
    await sender.updateMessage("private:user-1", messageId, "第一段\n第二段", "streaming", "耗时 1.2s", "codex");
    await sender.sendFinalMessages("private:user-1", messageId, "最终答案", "耗时 1.2s", "codex");

    expect(sendPrivateMessageMock).toHaveBeenCalledTimes(1);
    expect(sendPrivateMessageMock.mock.calls[0][0]).toBe("user-1");
    expect(sendPrivateMessageMock.mock.calls[0][1]).toContain("最终答案");
    expect(sendPrivateMessageMock.mock.calls[0][1]).not.toContain("第一段");
    expect(sendPrivateMessageMock.mock.calls[0][2]).toBe("reply-1");
  });
});
