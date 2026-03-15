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
    // Check for the new data-driven LANGUAGE_UPDATES pattern
    const simpleTextIds = collectMatches(PAGE_SCRIPT, /\{ id: "([^"]+)", (?:value:|key:)/g);
    const aiLabelIds = collectMatches(PAGE_SCRIPT, /\{ id: "ai-[^"]+", key: "[^"]+" \}/g);
    const allIds = [...simpleTextIds, ...aiLabelIds.map((id) => id.replace(/\{ id: "/, '').replace(/", key: "[^"]+" \}/, ''))];

    expect(allIds.length).toBeGreaterThan(0);
    for (const id of allIds) {
      expect(PAGE_HTML).toContain(`id="${id}"`);
    }
  });

  it("keeps every script-managed help block present in the HTML template", () => {
    // Check for the new data-driven platformHelp pattern
    const helpTargets = collectMatches(PAGE_SCRIPT, /\{ platform: "([^"]+)", key: "[^"]+Help" \}/g);

    expect(helpTargets).toEqual([
      "telegram",
      "feishu",
      "qq",
      "wework",
      "dingtalk",
    ]);

    for (const platform of helpTargets) {
      expect(PAGE_HTML).toContain(`id="${platform}-help"`);
    }
  });

  it("keeps AI tool switch buttons and tool panels aligned", () => {
    const toolListMatch = PAGE_SCRIPT.match(/const aiTools = \[([^\]]+)\]/);
    expect(toolListMatch).toBeTruthy();

    const tools = Array.from(
      (toolListMatch?.[1] ?? "").matchAll(/"([^"]+)"/g),
      (match) => match[1],
    );

    expect(tools).toEqual(["claude", "codex", "codebuddy"]);
    for (const tool of tools) {
      expect(PAGE_HTML).toContain(`data-tool="${tool}"`);
      expect(PAGE_HTML).toContain(`data-tool-panel="${tool}"`);
    }
  });
});
