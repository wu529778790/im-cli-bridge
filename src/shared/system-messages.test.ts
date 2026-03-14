import { describe, expect, it } from "vitest";

import {
  buildDirectoryMessage,
  buildModeMessage,
  buildPermissionRequestMessage,
} from "./system-messages.js";

describe("system message builders", () => {
  it("builds a permission request message", () => {
    expect(buildPermissionRequestMessage("Read", "file.txt", "abcdef123456")).toContain("权限请求");
    expect(buildPermissionRequestMessage("Read", "file.txt", "abcdef123456")).toContain("123456");
  });

  it("builds a mode message", () => {
    expect(buildModeMessage("计划模式")).toContain("当前模式: 计划模式");
  });

  it("builds a directory message", () => {
    expect(buildDirectoryMessage("D:/coding/open-im", ["- src", "- dist"])).toContain("可用目录:");
    expect(buildDirectoryMessage("D:/coding/open-im")).toContain("没有可访问的子目录");
  });
});
