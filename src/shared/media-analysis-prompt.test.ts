import { describe, expect, it } from "vitest";
import { buildSavedMediaBatchPrompt, buildSavedMediaPrompt } from "./media-analysis-prompt.js";

describe("buildSavedMediaPrompt", () => {
  it("includes source, local path, and optional text", () => {
    const prompt = buildSavedMediaPrompt({
      source: "Telegram",
      kind: "image",
      localPath: "/tmp/example.jpg",
      text: "look at this",
    });

    expect(prompt).toContain("The user sent a Telegram image message.");
    expect(prompt).toContain("/tmp/example.jpg");
    expect(prompt).toContain("look at this");
    expect(prompt).toContain("Read tool");
  });

  it("uses transcription guidance for audio-like media", () => {
    const prompt = buildSavedMediaPrompt({
      source: "Telegram",
      kind: "voice",
      localPath: "/tmp/example.ogg",
    });

    expect(prompt).toContain("transcribe");
    expect(prompt).toContain("/tmp/example.ogg");
  });

  it("includes every saved file when multiple attachments are available", () => {
    const prompt = buildSavedMediaBatchPrompt({
      source: "QQ",
      text: "compare these",
      items: [
        { kind: "image", localPath: "/tmp/one.jpg", label: "photo" },
        { kind: "video", localPath: "/tmp/two.mp4", label: "clip" },
      ],
    });

    expect(prompt).toContain("2 QQ media attachments");
    expect(prompt).toContain("/tmp/one.jpg");
    expect(prompt).toContain("/tmp/two.mp4");
    expect(prompt).toContain("compare these");
    expect(prompt).toContain("combined contents");
  });
});
