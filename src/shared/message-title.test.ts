import { describe, expect, it } from "vitest";

import { buildMessageTitle, OPEN_IM_SYSTEM_TITLE } from "./message-title.js";

describe("buildMessageTitle", () => {
  it("uses a consistent title format for non-final statuses", () => {
    expect(buildMessageTitle("codex", "thinking")).toBe("Codex - 思考中");
    expect(buildMessageTitle("codex", "streaming")).toBe("Codex - 执行中");
    expect(buildMessageTitle("codex", "error")).toBe("Codex - 错误");
  });

  it("keeps done titles as the bare tool name", () => {
    expect(buildMessageTitle("claude", "done")).toBe("Claude Code");
  });

  it("can append the Feishu brand suffix", () => {
    expect(buildMessageTitle("cursor", "done", { brandSuffix: true })).toBe(
      "Cursor · 通过 open-im 控制",
    );
  });

  it("exposes a shared system title", () => {
    expect(OPEN_IM_SYSTEM_TITLE).toBe("open-im");
  });
});
