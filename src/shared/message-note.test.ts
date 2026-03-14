import { describe, expect, it } from "vitest";

import { buildErrorNote, buildProgressNote, buildTextNote } from "./message-note.js";

describe("message note helpers", () => {
  it("builds a consistent progress note", () => {
    expect(buildProgressNote()).toBe("\u8f93\u51fa\u4e2d...");
    expect(buildProgressNote("Read x.ts")).toBe("\u8f93\u51fa\u4e2d...\nRead x.ts");
  });

  it("builds a consistent error note", () => {
    expect(buildErrorNote()).toBe("\u6267\u884c\u5931\u8d25");
  });

  it("builds a consistent rendered note block", () => {
    expect(buildTextNote("\u8f93\u51fa\u4e2d...")).toBe(
      "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n\u{1F4A1} \u8f93\u51fa\u4e2d...",
    );
  });
});
