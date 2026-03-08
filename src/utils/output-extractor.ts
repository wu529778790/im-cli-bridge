/**
 * 从 Claude CLI 输出中提取可发送的纯文本
 * 代理模式：优先原样透传；若检测到 stream-json 则提取文本
 */

/**
 * 从 stdout 中提取应发送给用户的消息文本
 * - 若输出像 stream-json（多行 JSON），则解析提取 AI 文本
 * - 否则原样透传（代理模式，直接和 claudecode 对话）
 */
export function extractDisplayText(stdout: string, stderr?: string): string {
  if (!stdout && !stderr) return '';
  const output = (stdout || '') + (stderr ? '\n' + stderr : '');
  const trimmed = output.trim();
  if (!trimmed) return '';

  // 仅当输出明显为 stream-json（首行是合法 JSON 且包含 type）时才解析
  const firstLine = trimmed.split('\n')[0]?.trim() || '';
  if (firstLine.startsWith('{') && firstLine.includes('"type"')) {
    const extracted = extractFromStreamJson(trimmed);
    if (extracted) return extracted;
  }

  return trimmed;
}

/**
 * 尝试从 stream-json (JSONL) 格式中提取文本
 */
function extractFromStreamJson(output: string): string | null {
  const lines = output.split('\n').filter((l) => l.trim());
  const texts: string[] = [];
  let hasJsonLines = false;

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      hasJsonLines = true;

      // claudecode 格式: type "result" 带有 result 字段
      if (event.type === 'result' && typeof event.result === 'string' && event.result) {
        texts.push(event.result);
        continue;
      }

      // claudecode 格式: type "assistant" 或 "user"，从 message.content 提取
      if ((event.type === 'assistant' || event.type === 'user') && event.message) {
        const msg = event.message as { content?: Array<{ type?: string; text?: string }> };
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block?.type === 'text' && typeof block.text === 'string') {
              texts.push(block.text);
            }
          }
        }
        continue;
      }

      // Anthropic API 格式: content_block_delta 带 delta.text
      if (event.type === 'content_block_delta' && event.delta) {
        const delta = event.delta as { type?: string; text?: string };
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          texts.push(delta.text);
        }
      }

    } catch {
      // 非 JSON 行，若已确认为 stream-json 则跳过（避免混入垃圾）
      if (hasJsonLines) continue;
      return null;
    }
  }

  if (!hasJsonLines || texts.length === 0) return null;
  return texts.join('').trim();
}
