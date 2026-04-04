const PATTERNS: Array<[RegExp, (m: string) => string]> = [
  [/\b(sk|pk|bot)[-_][a-zA-Z0-9_-]{8,}/gi, (m) => (m.match(/^[a-zA-Z]+/)?.[0] || m.slice(0, 2)) + '_****'],
  [/\b(AIza|AKIA)[a-zA-Z0-9]{12,}/g, (m) => m.slice(0, 4) + '****'],
  [/\b[a-zA-Z0-9]{40,}\b/g, (m) => m.slice(0, 6) + '****'],
];

export function sanitize(text: string): string {
  let result = text;
  for (const [re, replacer] of PATTERNS) {
    result = result.replace(re, replacer);
  }
  return result;
}
