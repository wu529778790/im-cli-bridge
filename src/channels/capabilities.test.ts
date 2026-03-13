import { describe, expect, it } from "vitest";
import {
  CHANNEL_CAPABILITIES,
  buildImageFallbackMessage,
  buildUnsupportedInboundMessage,
} from "./capabilities.js";

describe("channel capabilities", () => {
  it("defines core inbound and outbound capabilities for every channel", () => {
    expect(CHANNEL_CAPABILITIES.telegram.inbound.image).toBe("native");
    expect(CHANNEL_CAPABILITIES.telegram.inbound.file).toBe("native");
    expect(CHANNEL_CAPABILITIES.feishu.outbound.card).toBe("native");
    expect(CHANNEL_CAPABILITIES.qq.inbound.image).toBe("fallback");
    expect(CHANNEL_CAPABILITIES.qq.inbound.voice).toBe("fallback");
    expect(CHANNEL_CAPABILITIES.qq.inbound.video).toBe("fallback");
    expect(CHANNEL_CAPABILITIES.wechat.inbound.image).toBe("fallback");
    expect(CHANNEL_CAPABILITIES.wework.inbound.video).toBe("fallback");
    expect(CHANNEL_CAPABILITIES.wework.outbound.image).toBe("native");
    expect(CHANNEL_CAPABILITIES.dingtalk.inbound.file).toBe("fallback");
  });

  it("builds actionable fallback copy for unsupported inbound messages", () => {
    expect(buildUnsupportedInboundMessage("dingtalk", "image")).toContain("Telegram");
    expect(buildUnsupportedInboundMessage("dingtalk", "image")).toContain("Feishu");
    expect(buildUnsupportedInboundMessage("dingtalk", "image")).toContain("文字说明");
  });

  it("builds a consistent image delivery fallback message", () => {
    expect(buildImageFallbackMessage("qq", "/tmp/out.png")).toContain("/tmp/out.png");
    expect(buildImageFallbackMessage("qq", "/tmp/out.png")).toContain("QQ");
  });
});
