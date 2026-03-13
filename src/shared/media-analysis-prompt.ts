export interface SavedMediaPromptOptions {
  source: string;
  kind: string;
  localPath: string;
  text?: string;
}

export function buildSavedMediaPrompt(options: SavedMediaPromptOptions): string {
  return [
    `The user sent a ${options.source} ${options.kind} message.`,
    options.text ? `Accompanying text:\n${options.text}` : "",
    `Saved local file path: ${options.localPath}`,
    "Use the Read tool to inspect the saved file and respond based on its contents.",
  ].filter(Boolean).join("\n\n");
}
