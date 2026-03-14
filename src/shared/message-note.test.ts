import { describe, expect, it } from "vitest";

import { buildErrorNote, buildProgressNote, buildTextNote } from "./message-note.js";

describe("message note helpers", () => {
  it("builds a consistent progress note", () => {
    expect(buildProgressNote()).toBe("输出中...");
    expect(buildProgressNote("Read x.ts")).toBe("输出中...\nRead x.ts");
  });

  it("builds a consistent error note", () => {
    expect(buildErrorNote()).toBe("执行失败");
  });

  it("builds a consistent rendered note block", () => {
    expect(buildTextNote("输出中...")).toBe("─────────\n💡 输出中...");
  });
});
