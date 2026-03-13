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

export function createMediaTargetPath(extension: string, basenameHint?: string): string {
  const safeExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const safeBasename = basenameHint ? sanitizeName(basenameHint) : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existingExtension = extname(safeBasename);
  const filename = existingExtension ? safeBasename : `${safeBasename}${safeExtension}`;
  return join(IMAGE_DIR, filename);
}

export async function saveBase64Media(
  base64: string,
  extension: string,
  basenameHint?: string,
): Promise<string> {
  await mkdir(IMAGE_DIR, { recursive: true });
  const path = createMediaTargetPath(extension, basenameHint);
  await writeFile(path, Buffer.from(base64, "base64"));
  return path;
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
