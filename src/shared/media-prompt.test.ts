import { describe, expect, it } from "vitest";
import { buildMediaMetadataPrompt } from "./media-prompt.js";

describe("buildMediaMetadataPrompt", () => {
  it("renders the standard media prompt structure", () => {
    const prompt = buildMediaMetadataPrompt({
      source: "QQ",
      kind: "attachment",
      text: "please check this",
      metadata: [{ url: "https://example.com/a.png", kind: "image" }],
    });

    expect(prompt).toContain("The user sent a QQ attachment message.");
    expect(prompt).toContain("Accompanying text:");
    expect(prompt).toContain("please check this");
    expect(prompt).toContain("Available metadata:");
    expect(prompt).toContain("https://example.com/a.png");
  });
});
