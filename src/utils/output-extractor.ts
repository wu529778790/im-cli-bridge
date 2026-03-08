/**
 * 从 Claude / Codex 等 CLI 输出中提取可发送的纯文本
 */

/**
 * 从 stdout 中提取应发送给用户的消息文本
 */
export function extractDisplayText(stdout: string, stderr?: string): string {
  if (!stdout && !stderr) return '';
  const output = (stdout || '') + (stderr ? '\n' + stderr : '');
  let result = extractDisplayTextFromOutput(output);
  return unescapeMarkdown(result);
}

/**
 * 从输出中提取展示文本（未做 markdown 反转义）
 */
function extractDisplayTextFromOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return '';

  // Codex: 仅保留 "codex" 行之后的 AI 回复
  if (trimmed.includes('OpenAI Codex') || /session id:/i.test(trimmed)) {
    const codex = extractCodexResponse(trimmed);
    if (codex) return codex;
  }

  // stream-json 格式
  const firstLine = trimmed.split('\n')[0]?.trim() || '';
  if (firstLine.startsWith('{') && firstLine.includes('"type"')) {
    const extracted = extractFromStreamJson(trimmed);
    if (extracted) return extracted;
  }

  return trimmed;
}

/**
 * 从 Codex 输出中提取 AI 回复（去掉 header、user、mcp 等）
 */
function extractCodexResponse(output: string): string {
  const marker = '\ncodex\n';
  const idx = output.indexOf(marker);
  if (idx >= 0) {
    return output.slice(idx + marker.length).trim();
  }
  if (output.startsWith('codex\n')) {
    return output.slice(6).trim();
  }
  return '';
}

/**
 * 去掉 Telegram 等对 markdown 的转义（如 \. \-）
 */
function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\_.*[\]()~`>#+=|-])/g, '$1');
}

/**
 * 流式场景：从已累积的输出中提取应展示的部分（Codex 仅取 codex 之后）
 */
export function filterStreamOutput(accumulated: string): string {
  const raw = extractDisplayTextFromOutput(accumulated);
  return unescapeMarkdown(raw);
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
