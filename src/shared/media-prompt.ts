export interface MediaPromptOptions {
  source: string;
  kind: string;
  text?: string;
  metadata: unknown;
  guidance?: string;
}

const DEFAULT_GUIDANCE =
  "If the media body is not directly accessible, explain that limitation and ask the user for a text summary, transcript, or a resend via Telegram/Feishu/WeWork.";

export function buildMediaMetadataPrompt(options: MediaPromptOptions): string {
  return [
    `The user sent a ${options.source} ${options.kind} message.`,
    options.text ? `Accompanying text:\n${options.text}` : "",
    "Available metadata:",
    JSON.stringify(options.metadata, null, 2),
    options.guidance ?? DEFAULT_GUIDANCE,
  ].filter(Boolean).join("\n\n");
}
