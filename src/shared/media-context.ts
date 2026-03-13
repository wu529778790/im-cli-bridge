export function buildMediaContext(
  details: Record<string, string | number | undefined>,
  leadingText?: string,
): string | undefined {
  const lines: string[] = [];
  if (leadingText) {
    lines.push(leadingText);
  }

  for (const [label, value] of Object.entries(details)) {
    if (value === undefined || value === "") continue;
    lines.push(`${label}: ${value}`);
  }

  return lines.length > 0 ? lines.join("\n") : undefined;
}
