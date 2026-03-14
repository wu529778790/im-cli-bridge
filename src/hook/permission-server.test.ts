import { describe, expect, it } from "vitest";
import { resolvePermissionChatId } from "./permission-server.js";

describe("resolvePermissionChatId", () => {
  it("prefers explicit chatId fields from the request payload", () => {
    expect(resolvePermissionChatId({ chatId: "chat-1" })).toBe("chat-1");
    expect(resolvePermissionChatId({ chat_id: "chat-2" })).toBe("chat-2");
  });

  it("does not fall back to process-global state", () => {
    process.env.CC_IM_CHAT_ID = "leaked-chat";

    expect(resolvePermissionChatId({})).toBeUndefined();
  });
});
