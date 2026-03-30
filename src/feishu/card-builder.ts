/**
 * CardKit 2.0 卡片构建 - 支持打字机流式效果
 * 参考 cc-im: https://github.com/congqiu/cc-im
 */

import { MAX_STREAMING_CONTENT_LENGTH, MAX_FEISHU_MESSAGE_LENGTH } from '../constants.js';
import { splitLongContent as sharedSplitLongContent, truncateText, getAIToolDisplayName, OPEN_IM_BRAND_SUFFIX } from '../shared/utils.js';

export type CardStatus = 'processing' | 'thinking' | 'streaming' | 'done' | 'error';

interface CardOptions {
  content: string;
  status: CardStatus;
  note?: string;
  thinking?: string;
  /** AI 工具标识（claude/codex/codebuddy），用于生成标题 */
  toolName?: string;
}

const HEADER_TEMPLATES: Record<CardStatus, string> = {
  processing: 'blue',
  thinking: 'blue',
  streaming: 'blue',
  done: 'green',
  error: 'red',
};

function getHeaderTitle(status: CardStatus, toolName: string): string {
  const base = (() => {
    switch (status) {
      case 'processing': return `${toolName} - 处理中...`;
      case 'thinking':   return `${toolName} - 思考中...`;
      case 'streaming':  return toolName;
      case 'done':       return toolName;
      case 'error':      return `${toolName} - 错误`;
    }
  })();
  return `${base}${OPEN_IM_BRAND_SUFFIX}`;
}

export function truncateForStreaming(text: string): string {
  return truncateText(text, MAX_STREAMING_CONTENT_LENGTH);
}

/** CardKit 2.0 格式，含 element_id 供 cardElement.content 流式更新 */
function buildCardV2Object(
  options: CardOptions,
  cardId?: string
): Record<string, unknown> {
  const { content, status, note, thinking, toolName: rawToolName } = options;
  const toolName = getAIToolDisplayName(rawToolName ?? 'claude');

  const elements: unknown[] = [];

  // 完成状态下，如果有思考过程，添加折叠面板
  if (status === 'done' && thinking) {
    elements.push({
      tag: 'collapsible_panel',
      expanded: false,
      header: {
        title: { tag: 'markdown', content: '💭 **思考过程**' },
      },
      border: { color: 'grey' },
      elements: [{ tag: 'markdown', content: thinking }],
    });
  }

  elements.push({
    tag: 'markdown',
    content: truncateForStreaming(content) || '...',
    element_id: 'main_content',
  });

  elements.push({
    tag: 'markdown',
    content: note || '',
    text_size: 'notation',
    element_id: 'note_area',
  });

  // 在处理中、思考中和流式输出状态时添加停止按钮
  if (
    (status === 'processing' || status === 'thinking' || status === 'streaming') &&
    cardId
  ) {
    elements.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '⏹️ 停止' },
      type: 'danger',
      value: { action: 'stop', card_id: cardId },
      element_id: 'action_stop',
    });
  }

  const isActive = status === 'processing' || status === 'thinking' || status === 'streaming';

  return {
    schema: '2.0',
    config: {
      update_multi: true,
      ...(isActive ? { streaming_mode: true } : {}),
    },
    header: {
      template: HEADER_TEMPLATES[status],
      title: { tag: 'plain_text', content: getHeaderTitle(status, toolName) },
    },
    body: {
      direction: 'vertical',
      elements,
    },
  };
}

export function buildCardV2(options: CardOptions, cardId?: string): string {
  return JSON.stringify(buildCardV2Object(options, cardId));
}

export function splitLongContent(text: string, maxLen = MAX_FEISHU_MESSAGE_LENGTH): string[] {
  return sharedSplitLongContent(text, maxLen);
}
