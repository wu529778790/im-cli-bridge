import { describe, expect, it } from "vitest";
import { createMediaTargetPath, inferExtensionFromContentType } from "./media-storage.js";

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

describe("inferExtensionFromContentType", () => {
  it("maps common media content types to file extensions", () => {
    expect(inferExtensionFromContentType("audio/ogg")).toBe(".ogg");
    expect(inferExtensionFromContentType("video/mp4")).toBe(".mp4");
    expect(inferExtensionFromContentType("image/jpeg")).toBe(".jpg");
    expect(inferExtensionFromContentType("application/pdf")).toBe(".pdf");
  });
});
