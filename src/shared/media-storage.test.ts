import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createMediaTargetPath,
  decryptAes256CbcMedia,
  inferExtensionFromBuffer,
  inferExtensionFromContentType,
} from "./media-storage.js";

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

describe("inferExtensionFromBuffer", () => {
  it("detects jpeg files from the magic header", () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);

    expect(inferExtensionFromBuffer(buffer)).toBe(".jpg");
  });
});

describe("decryptAes256CbcMedia", () => {
  it("decrypts WeWork-style AES-256-CBC media buffers", () => {
    const key = randomBytes(32);
    const iv = key.subarray(0, 16);
    const plaintext = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const aesKey = key.toString("base64").replace(/=+$/g, "");

    expect(decryptAes256CbcMedia(encrypted, aesKey)).toEqual(plaintext);
  });
});
