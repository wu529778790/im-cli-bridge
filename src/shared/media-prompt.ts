export interface MediaPromptOptions {
  source: string;
  kind: string;
  text?: string;
  metadata: unknown;
  guidance?: string;
}

function buildDefaultGuidance(kind: string): string {
  if (kind === "image") {
    return "If the image bytes are not directly accessible, explain that limitation and ask the user to resend the image through a channel with native media support or describe the key visual details.";
  }
  if (kind === "audio" || kind === "voice") {
    return "If the audio is not directly accessible, explain that limitation and ask the user for a transcript, summary, or a resend via Telegram/Feishu/WeWork.";
  }
  if (kind === "video" || kind === "media") {
    return "If the video is not directly accessible, explain that limitation and ask the user for a transcript, summary of the visuals, or a resend via Telegram/Feishu/WeWork.";
  }
  return "If the media body is not directly accessible, explain that limitation and ask the user for a text summary, transcript, or a resend via Telegram/Feishu/WeWork.";
}

export function buildMediaMetadataPrompt(options: MediaPromptOptions): string {
  return [
    `The user sent a ${options.source} ${options.kind} message.`,
    options.text ? `Accompanying text:\n${options.text}` : "",
    "Available metadata:",
    JSON.stringify(options.metadata, null, 2),
    options.guidance ?? buildDefaultGuidance(options.kind),
  ].filter(Boolean).join("\n\n");
}
