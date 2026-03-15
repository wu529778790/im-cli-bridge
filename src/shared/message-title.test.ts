import { describe, expect, it } from "vitest";

import { buildMessageTitle, OPEN_IM_SYSTEM_TITLE } from "./message-title.js";
import { OPEN_IM_BRAND_SUFFIX } from "./utils.js";

describe("buildMessageTitle", () => {
  it("uses a consistent title format for non-final statuses", () => {
    expect(buildMessageTitle("codex", "thinking")).toBe("Codex - \u601d\u8003\u4e2d");
    expect(buildMessageTitle("codex", "streaming")).toBe("Codex - \u6267\u884c\u4e2d");
    expect(buildMessageTitle("codex", "error")).toBe("Codex - \u9519\u8bef");
  });

  it("keeps the tool name first for done titles", () => {
    expect(buildMessageTitle("claude", "done")).toBe("Claude Code - \u5b8c\u6210");
  });

  it("can append the Feishu brand suffix", () => {
    expect(buildMessageTitle("codebuddy", "done", { brandSuffix: true })).toBe(
      `CodeBuddy - \u5b8c\u6210${OPEN_IM_BRAND_SUFFIX}`,
    );
  });

  it("exposes a shared system title", () => {
    expect(OPEN_IM_SYSTEM_TITLE).toBe("open-im");
  });
});
