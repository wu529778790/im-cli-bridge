import { beforeEach, describe, expect, it, vi } from "vitest";

const { dingtalkGetAccessTokenMock, initWeWorkMock, stopWeWorkMock } = vi.hoisted(() => ({
  dingtalkGetAccessTokenMock: vi.fn(),
  initWeWorkMock: vi.fn(),
  stopWeWorkMock: vi.fn(),
}));

vi.mock("dingtalk-stream", () => ({
  DWClient: vi.fn().mockImplementation(function MockDWClient() {
    return {
      getAccessToken: dingtalkGetAccessTokenMock,
    };
  }),
}));

vi.mock("./wework/client.js", () => ({
  initWeWork: initWeWorkMock,
  stopWeWork: stopWeWorkMock,
}));

import { testPlatformConfig } from "./config-web.js";

describe("testPlatformConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  it("validates Telegram credentials with getMe", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { username: "demo_bot" } }), { status: 200 }),
    );

    await expect(
      testPlatformConfig("telegram", { botToken: "123:abc", proxy: "" }),
    ).resolves.toBe("Telegram reachable as @demo_bot.");

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toBe(
      "https://api.telegram.org/bot123:abc/getMe",
    );
  });

  it("returns Feishu API errors", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 99991663, msg: "app access token invalid" }), { status: 200 }),
    );

    await expect(
      testPlatformConfig("feishu", { appId: "cli_a", appSecret: "secret" }),
    ).rejects.toThrow("app access token invalid");
  });

  it("uses the existing WeWork handshake and always stops the probe client", async () => {
    initWeWorkMock.mockResolvedValue(undefined);

    await expect(
      testPlatformConfig("wework", { corpId: "ww_bot", secret: "ww_secret" }),
    ).resolves.toBe("WeWork WebSocket authentication succeeded.");

    expect(initWeWorkMock).toHaveBeenCalledOnce();
    expect(stopWeWorkMock).toHaveBeenCalledOnce();
  });

  it("requests a DingTalk access token", async () => {
    dingtalkGetAccessTokenMock.mockResolvedValue("token-123");

    await expect(
      testPlatformConfig("dingtalk", { clientId: "ding-id", clientSecret: "ding-secret" }),
    ).resolves.toBe("DingTalk credentials are valid.");

    expect(dingtalkGetAccessTokenMock).toHaveBeenCalledOnce();
  });

  it("fails fast on missing required fields before probing", async () => {
    await expect(testPlatformConfig("qq", { appId: "" })).rejects.toThrow(
      "QQ app ID is required and must be a non-empty string.",
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
