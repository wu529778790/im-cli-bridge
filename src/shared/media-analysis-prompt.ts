export interface SavedMediaPromptOptions {
  source: string;
  kind: string;
  localPath: string;
  text?: string;
}

export interface SavedMediaBatchItem {
  kind: string;
  localPath: string;
  label?: string;
}

export interface SavedMediaBatchPromptOptions {
  source: string;
  items: SavedMediaBatchItem[];
  text?: string;
}

function buildSavedMediaGuidance(kind: string): string {
  if (kind === "audio" || kind === "voice") {
    return "Use the Read tool to inspect the saved file, transcribe any speech, and respond based on the audio contents.";
  }
  if (kind === "video" || kind === "media") {
    return "Use the Read tool to inspect the saved file, summarize the visible content and any audible speech, and respond based on the video contents.";
  }
  if (kind === "image") {
    return "Use the Read tool to inspect the saved file and describe the relevant visual contents before answering.";
  }
  return "Use the Read tool to inspect the saved file and respond based on its contents.";
}

export function buildSavedMediaPrompt(options: SavedMediaPromptOptions): string {
  return [
    `The user sent a ${options.source} ${options.kind} message.`,
    options.text ? `Accompanying text:\n${options.text}` : "",
    `Saved local file path: ${options.localPath}`,
    buildSavedMediaGuidance(options.kind),
  ].filter(Boolean).join("\n\n");
}

export function buildSavedMediaBatchPrompt(options: SavedMediaBatchPromptOptions): string {
  const kinds = Array.from(new Set(options.items.map((item) => item.kind))).join(", ");
  const fileList = options.items
    .map((item, index) => {
      const label = item.label?.trim();
      const prefix = label ? `${label}: ` : "";
      return `${index + 1}. ${prefix}${item.localPath} (${item.kind})`;
    })
    .join("\n");

  return [
    `The user sent ${options.items.length} ${options.source} media attachments${kinds ? ` (${kinds})` : ""}.`,
    options.text ? `Accompanying text:\n${options.text}` : "",
    "Saved local file paths:",
    fileList,
    "Use the Read tool to inspect each saved file and respond based on the combined contents.",
  ].filter(Boolean).join("\n\n");
}
