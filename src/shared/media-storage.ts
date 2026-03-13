import { createDecipheriv } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { IMAGE_DIR } from "../constants.js";

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function inferExtensionFromContentType(contentType: string): string {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!normalized.includes("/")) return "";

  const [, subtypeRaw] = normalized.split("/", 2);
  const subtype = subtypeRaw.replace("jpeg", "jpg");
  const simpleSubtype = subtype.split("+")[0];

  if (normalized.startsWith("image/") || normalized.startsWith("audio/") || normalized.startsWith("video/")) {
    return `.${simpleSubtype}`;
  }

  if (normalized === "application/pdf") return ".pdf";
  if (normalized === "text/plain") return ".txt";
  if (normalized === "application/json") return ".json";

  return "";
}

export function inferExtensionFromBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ".jpg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (buffer.length >= 6) {
    const gifHeader = buffer.subarray(0, 6).toString("ascii");
    if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return ".gif";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "BM") return ".bmp";
  if (buffer.length >= 4 && (buffer.subarray(0, 4).toString("ascii") === "II*\0" || buffer.subarray(0, 4).toString("ascii") === "MM\0*")) return ".tif";
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF") return ".pdf";
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "OggS") return ".ogg";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") return ".mp4";
  return "";
}

export function createMediaTargetPath(extension: string, basenameHint?: string): string {
  const safeExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const safeBasename = basenameHint ? sanitizeName(basenameHint) : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existingExtension = extname(safeBasename);
  const filename = existingExtension ? safeBasename : `${safeBasename}${safeExtension}`;
  return join(IMAGE_DIR, filename);
}

export async function saveBufferMedia(
  buffer: Buffer,
  extension: string,
  basenameHint?: string,
): Promise<string> {
  await mkdir(IMAGE_DIR, { recursive: true });
  const path = createMediaTargetPath(extension, basenameHint);
  await writeFile(path, buffer);
  return path;
}

function decodeAesKey(aesKey: string): Buffer {
  const normalized = aesKey.trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = normalized.length % 4 === 0 ? normalized : normalized.padEnd(normalized.length + (4 - (normalized.length % 4)), "=");
  const decoded = Buffer.from(withPadding, "base64");
  if (decoded.length === 32) return decoded;

  const utf8 = Buffer.from(aesKey, "utf8");
  if (utf8.length === 32) return utf8;

  throw new Error(`Invalid AES key length: expected 32 bytes, got ${decoded.length || utf8.length}`);
}

export function decryptAes256CbcMedia(buffer: Buffer, aesKey: string): Buffer {
  const key = decodeAesKey(aesKey);
  const iv = key.subarray(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

export async function saveBase64Media(
  base64: string,
  extension: string,
  basenameHint?: string,
): Promise<string> {
  return saveBufferMedia(Buffer.from(base64, "base64"), extension, basenameHint);
}

export async function downloadMediaFromUrl(
  url: string,
  options?: { basenameHint?: string; fallbackExtension?: string },
): Promise<string> {
  await mkdir(IMAGE_DIR, { recursive: true });
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    throw new Error(`Failed to download media: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const contentDisposition = response.headers.get("content-disposition") ?? "";
  const dispositionMatch = /filename="?([^";]+)"?/i.exec(contentDisposition);
  const filenameFromHeader = dispositionMatch?.[1];
  const extensionFromUrl = extname(new URL(url).pathname);
  const extension =
    extensionFromUrl ||
    extname(filenameFromHeader ?? "") ||
    inferExtensionFromContentType(contentType) ||
    `.${options?.fallbackExtension ?? "bin"}`;

  const basenameHint = options?.basenameHint ?? filenameFromHeader ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = createMediaTargetPath(extension, basenameHint);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(path, buffer);
  return path;
}
