import { describe, expect, it } from "vitest";
import { buildMediaContext } from "./media-context.js";

describe("buildMediaContext", () => {
  it("includes leading text and skips empty values", () => {
    const text = buildMediaContext(
      {
        Filename: "demo.png",
        Width: 1280,
        Empty: "",
        Missing: undefined,
      },
      "Caption: hello",
    );

    expect(text).toBe("Caption: hello\nFilename: demo.png\nWidth: 1280");
  });
});
