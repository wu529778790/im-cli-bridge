import { describe, expect, it } from "vitest";
import { createMediaTargetPath } from "./media-storage.js";

describe("createMediaTargetPath", () => {
  it("does not append a fallback extension when basename already has one", () => {
    const path = createMediaTargetPath("bin", "report.pdf");

    expect(path).toMatch(/report\.pdf$/);
    expect(path).not.toMatch(/report\.pdf\.bin$/);
  });

  it("appends the fallback extension when basename has none", () => {
    const path = createMediaTargetPath("jpg", "image-upload");

    expect(path).toMatch(/image-upload\.jpg$/);
  });
});
