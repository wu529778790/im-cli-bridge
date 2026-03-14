import { createCipheriv, randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMediaPrompt } from "./event-handler.js";
import { WeWorkCommand, type WeWorkCallbackMessage } from "./types.js";

function createImageMessage(url: string, aeskey: string): WeWorkCallbackMessage {
  return {
    cmd: WeWorkCommand.AIBOT_CALLBACK,
    headers: { req_id: "req-1" },
    body: {
      msgid: "msg-1",
      aibotid: "bot-1",
      chatid: "chat-1",
      chattype: "single",
      from: { userid: "user-1" },
      response_url: "https://example.com/response",
      msgtype: "image",
      image: {
        url,
        aeskey,
        md5: "wework-image-test",
      },
    },
  };
}

describe("WeWork buildMediaPrompt", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm("C:/Users/52977/AppData/Local/Temp/open-im-images/wework-image-test.jpg", { force: true });
    await rm("C:/Users/52977/AppData/Local/Temp/open-im-images/wework-file-test.pdf", { force: true });
  });

  it("builds a saved-image prompt for AES-CBC images with non-standard trailer bytes", async () => {
    const key = randomBytes(32);
    const iv = key.subarray(0, 16);
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
      0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
    ]);
    const paddedJpeg = Buffer.concat([jpeg, Buffer.alloc(10)]);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(paddedJpeg), cipher.final()]);
    const aeskey = key.toString("base64").replace(/=+$/g, "");

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(encrypted, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );

    const prompt = await buildMediaPrompt(createImageMessage("https://example.com/image", aeskey), "image");

    expect(prompt).toContain("Saved local file path:");
    expect(prompt).toContain("wework-image-test.jpg");
    expect(prompt).not.toContain("Remote image URL:");

    const match = /Saved local file path: (.+)/.exec(prompt ?? "");
    expect(match?.[1]).toBeTruthy();

    const saved = await readFile(match![1], null);
    expect(saved).toEqual(jpeg);
  });

  it("builds a saved-file prompt for AES-CBC file attachments", async () => {
    const key = randomBytes(32);
    const iv = key.subarray(0, 16);
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF", "ascii");
    const paddedPdf = Buffer.concat([
      pdf,
      Buffer.alloc((16 - (pdf.length % 16)) % 16 || 16),
    ]);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(paddedPdf), cipher.final()]);
    const aeskey = key.toString("base64").replace(/=+$/g, "");

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(encrypted, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );

    const fileMessage = {
      cmd: WeWorkCommand.AIBOT_CALLBACK,
      headers: { req_id: "req-2" },
      body: {
        msgid: "msg-2",
        aibotid: "bot-1",
        chatid: "chat-1",
        chattype: "single",
        from: { userid: "user-1" },
        response_url: "https://example.com/response",
        msgtype: "file",
        file: {
          url: "https://example.com/file",
          aeskey,
          filename: "wework-file-test",
        },
      },
    } as WeWorkCallbackMessage;

    const prompt = await buildMediaPrompt(fileMessage, "file");

    expect(prompt).toContain("Saved local file path:");
    expect(prompt).toContain("wework-file-test.pdf");
    expect(prompt).not.toContain("No direct image bytes were included");

    const match = /Saved local file path: (.+)/.exec(prompt ?? "");
    expect(match?.[1]).toBeTruthy();

    const saved = await readFile(match![1], null);
    expect(saved).toEqual(pdf);
  });
});
