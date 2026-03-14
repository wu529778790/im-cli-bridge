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
});
