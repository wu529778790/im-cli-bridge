import { describe, expect, it } from "vitest";
import { PAGE_HTML } from "./config-web-page.js";
import { PAGE_SCRIPT } from "./config-web-page-script.js";

function collectMatches(input: string, pattern: RegExp): string[] {
  return Array.from(input.matchAll(pattern), (match) => match[1]).filter(Boolean);
}

describe("config web page assembly", () => {
  it("embeds serialized i18n data into the final page", () => {
    expect(PAGE_HTML).not.toContain("__PAGE_TEXTS__");
    expect(PAGE_HTML).toContain("heroBodyFull");
    expect(PAGE_HTML).toContain("Local AI bridge");
  });

  it("keeps every script-managed text target present in the HTML template", () => {
    const textTargetIds = collectMatches(PAGE_SCRIPT, /setText\("([^"]+)"/g);

    expect(textTargetIds.length).toBeGreaterThan(0);
    for (const id of textTargetIds) {
      expect(PAGE_HTML).toContain(`id="${id}"`);
    }
  });

  it("keeps every script-managed help block present in the HTML template", () => {
    const helpTargetIds = collectMatches(PAGE_SCRIPT, /el\("([^"]+-help)"\)\.innerHTML/g);

    expect(helpTargetIds).toEqual([
      "telegram-help",
      "feishu-help",
      "qq-help",
      "wework-help",
      "dingtalk-help",
    ]);

    for (const id of helpTargetIds) {
      expect(PAGE_HTML).toContain(`id="${id}"`);
    }
  });

  it("keeps AI tool switch buttons and tool panels aligned", () => {
    const toolListMatch = PAGE_SCRIPT.match(/const aiTools = \[([^\]]+)\]/);
    expect(toolListMatch).toBeTruthy();

    const tools = Array.from(
      (toolListMatch?.[1] ?? "").matchAll(/"([^"]+)"/g),
      (match) => match[1],
    );

    expect(tools).toEqual(["claude", "codex", "cursor", "codebuddy"]);
    for (const tool of tools) {
      expect(PAGE_HTML).toContain(`data-tool="${tool}"`);
      expect(PAGE_HTML).toContain(`data-tool-panel="${tool}"`);
    }
  });
});
