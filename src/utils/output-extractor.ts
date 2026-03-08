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

  // Codex: 仅保留 "codex" 行之后的 AI 回复；若无 codex 标记则尝试去掉 header 取正文
  if (trimmed.includes('OpenAI Codex') || /session id:/i.test(trimmed)) {
    const codex = extractCodexResponse(trimmed);
    if (codex) return codex;
    // 无 codex 时去掉 header（OpenAI Codex...user\nxxx\nmcp startup 等），只保留 AI 回复
    const afterMcp = trimmed.replace(/^[\s\S]*?mcp startup[^\n]*\n?/i, '');
    if (afterMcp && afterMcp !== trimmed) {
      const stripped = stripCodexNoise(afterMcp.trim());
      if (stripped) return stripped;
    }
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
 * 从 Codex 输出中提取 AI 回复（去掉 header、user、mcp、exec、thinking 等）
 * 只保留有用的人类可读回复
 */
function extractCodexResponse(output: string): string {
  const marker = '\ncodex\n';
  const idx = output.lastIndexOf(marker);
  let extracted = '';
  if (idx >= 0) {
    extracted = output.slice(idx + marker.length).trim();
  } else if (output.startsWith('codex\n')) {
    extracted = output.slice(6).trim();
  } else {
    return '';
  }
  return stripCodexNoise(extracted);
}

/**
 * 移除 Codex 输出中的噪音块：exec、thinking、命令输出等
 */
function stripCodexNoise(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inExec = false;
  let inThinking = false;
  let inExecOutput = false;
  let skipNextTokenCount = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    // 进入 exec 块
    if (lower === 'exec' || /^exec\s+/.test(lower) || trimmed.startsWith('exec "') || trimmed.startsWith('exec \'')) {
      inExec = true;
      inExecOutput = false;
      inThinking = false;
      continue;
    }
    // 进入 thinking 块
    if (lower === 'thinking') {
      inThinking = true;
      inExec = false;
      inExecOutput = false;
      continue;
    }
    // exec 输出标记
    if (/^succeeded in \d+ms/i.test(trimmed) || /^failed in \d+ms/i.test(trimmed)) {
      inExecOutput = true;
      inExec = false;
      continue;
    }
    // 新的 codex 段，重置
    if (lower === 'codex') {
      inExec = inThinking = inExecOutput = false;
      continue;
    }
    // 跳过 exec 命令行（带 "in D:\path" 等）
    if (inExec && (trimmed.includes(' in ') && /[a-z]:[\\\/]?/i.test(trimmed) || trimmed.includes('powershell') || trimmed.includes('.exe'))) {
      continue;
    }
    // 跳过 exec/thinking 块内的内容
    if (inExec || inThinking || inExecOutput) {
      continue;
    }
    // 跳过占位符行（如 __INLINE_CODE_0__）
    if (/^__[A-Z_]+_\d+__$/i.test(trimmed)) {
      continue;
    }
    // 跳过 tokens used 行（如 "tokens used" "tokens used 1,186" 或下一行的 "1,186"）
    if (/^tokens used\b/i.test(trimmed)) {
      skipNextTokenCount = true;
      continue;
    }
    if (skipNextTokenCount && /^[\d,]+$/.test(trimmed)) {
      skipNextTokenCount = false;
      continue;
    }
    skipNextTokenCount = false;
    result.push(line);
  }

  return deduplicateTail(result.join('\n').trim());
}

/**
 * 移除末尾重复内容（Codex 有时会重复输出同一段回复）
 */
function deduplicateTail(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const half = Math.floor(t.length / 2);
  // 检查是否后半段与前半段相同
  if (half > 10 && t.slice(0, half).trim() === t.slice(half).trim()) {
    return t.slice(0, half).trim();
  }
  // 检查末尾是否有重复段落（按双换行分割）
  const blocks = t.split(/\n\s*\n/).filter(Boolean);
  if (blocks.length >= 2 && blocks[blocks.length - 1] === blocks[blocks.length - 2]) {
    return blocks.slice(0, -1).join('\n\n').trim();
  }
  return t;
}

/**
 * 去掉 Markdown 转义：\\. \\- \\* 等还原为 . - *
 * 覆盖 Telegram MarkdownV2 及常见转义字符
 */
function unescapeMarkdown(text: string): string {
  return text.replace(/\\(.)/g, (_, c) => c);
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
