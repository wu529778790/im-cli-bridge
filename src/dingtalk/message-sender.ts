import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import {
  sendText,
  sendProactiveText,
  prepareStreamingCard,
  updateStreamingCard,
  finishStreamingCard,
  createAndDeliverCard,
  updateCardInstance,
  sendRobotInteractiveCard,
  updateRobotInteractiveCard,
} from './client.js';
import type { DingTalkStreamingTarget } from './client.js';
import { createLogger } from '../logger.js';
import { splitLongContent, getAIToolDisplayName } from '../shared/utils.js';
import { listDirectories, buildDirectoryKeyboard } from '../commands/handler.js';
import { MAX_DINGTALK_MESSAGE_LENGTH } from '../constants.js';
import type { ThreadContext } from '../shared/types.js';
import type { DingTalkActiveTarget } from '../shared/active-chats.js';
import { buildImageFallbackMessage } from '../channels/capabilities.js';
import { buildMessageTitle, OPEN_IM_SYSTEM_TITLE } from '../shared/message-title.js';
import { buildTextNote } from '../shared/message-note.js';
import {
  buildDirectoryMessage,
  buildModeMessage,
  buildPermissionRequestMessage,
} from '../shared/system-messages.js';

const log = createLogger('DingTalkSender');

export type MessageStatus = 'thinking' | 'streaming' | 'done' | 'error';

const STATUS_ICONS: Record<MessageStatus, string> = {
  thinking: '🔵',
  streaming: '🔄',
  done: '✅',
  error: '❌',
};

const FLOW_STATUS: Record<MessageStatus, number> = {
  thinking: 1,
  streaming: 2,
  done: 3,
  error: 5,
};

interface SenderSettings {
  cardTemplateId?: string;
  robotCodeFallback?: string;
}

interface StreamState {
  chatId: string;
  mode: 'card' | 'cardInstance' | 'interactiveCard' | 'text';
  conversationToken?: string;
  outTrackId?: string;
  cardBizId?: string;
  toolId: string;
  target?: DingTalkStreamingTarget;
}

let senderSettings: SenderSettings = {};
const streamStates = new Map<string, StreamState>();

function generateMessageId(): string {
  return `${Date.now()}-${randomBytes(6).toString('hex')}`;
}

export function configureDingTalkMessageSender(settings: SenderSettings): void {
  senderSettings = {
    cardTemplateId: settings.cardTemplateId?.trim(),
    robotCodeFallback: settings.robotCodeFallback?.trim(),
  };
}

function getCardTemplateId(): string | undefined {
  return senderSettings.cardTemplateId?.trim() || undefined;
}

function formatMessage(
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = 'claude',
): string {
  const icon = STATUS_ICONS[status];
  const toolName = getAIToolDisplayName(toolId);
  const title =
    status === 'thinking'
      ? `${toolName} - 思考中`
      : status === 'streaming'
        ? `${toolName} - 执行中`
        : status === 'error'
          ? `${toolName} - 错误`
          : toolName;

  let text = `${icon} ${title}\n\n${content}`;
  if (note) text += `\n\n${buildTextNote(note)}`;
  return text;
}

function getToolTitle(toolId: string, status: MessageStatus): string {
  return buildMessageTitle(toolId, status);
}

/**
 * 适配钉钉官方「搜索结果卡片」模板变量结构
 * 变量：lastMessage, content, resources, users, flowStatus
 */
function buildCardData(
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = 'claude',
): Record<string, unknown> {
  const toolName = getAIToolDisplayName(toolId);
  const safeContent =
    content.trim() || (status === 'thinking' ? '正在思考，请稍候...' : status === 'error' ? '执行失败' : '...');
  const safeNote = note?.trim() || '';

  // lastMessage: 卡片摘要，用于会话列表预览
  const lastMessage =
    safeContent.length > 50 ? `${safeContent.slice(0, 47)}...` : safeContent || getToolTitle(toolId, status);

  // resources: 对象数组，note 作为来源列表（如 "1. xxx\n2. yyy" 按行解析）
  const resources: Array<{ title: string }> = [];
  if (safeNote) {
    for (const line of safeNote.split('\n')) {
      const t = line.replace(/^\d+\.\s*/, '').trim();
      if (t) resources.push({ title: t });
    }
    if (resources.length === 0) resources.push({ title: safeNote });
  }

  return {
    lastMessage,
    content: safeContent,
    resources,
    users: [] as unknown[],
    flowStatus: FLOW_STATUS[status],
    // 保留兼容字段
    note: safeNote,
    status,
    toolName,
    title: getToolTitle(toolId, status),
    displayText: formatMessage(safeContent, status, safeNote, toolId),
  };
}

async function tryFinishCard(conversationToken?: string): Promise<void> {
  if (!conversationToken) return;
  try {
    await finishStreamingCard(conversationToken);
  } catch (err) {
    log.warn('Failed to finish DingTalk streaming card:', err);
  }
}

async function sendTextWithRetry(chatId: string, text: string, retries = 1): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await sendText(chatId, text);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        log.warn(`DingTalk send failed, retrying (${attempt + 1}/${retries}):`, err);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }
  throw lastError;
}

export async function sendThinkingMessage(
  chatId: string,
  _replyToMessageId?: string,
  toolId = 'claude',
  target?: DingTalkStreamingTarget,
): Promise<string> {
  const messageId = generateMessageId();
  const templateId = getCardTemplateId();
  const robotCode = target?.robotCode || senderSettings.robotCodeFallback;

  // 1. 优先尝试互动卡片普通版（机器人适用，无需 AI 助理权限）
  if (robotCode) {
    try {
      const effectiveTarget: DingTalkStreamingTarget = target
        ? { ...target, robotCode }
        : { chatId, robotCode };
      const cardBizId = messageId;
      await sendRobotInteractiveCard(
        effectiveTarget,
        cardBizId,
        buildCardData('', 'thinking', '请稍候', toolId),
      );
      streamStates.set(messageId, {
        chatId,
        mode: 'interactiveCard',
        cardBizId,
        toolId,
        target,
      });
      return messageId;
    } catch (err) {
      log.debug('DingTalk 互动卡片普通版失败，尝试其他方式:', err);
    }
  }

  // 2. 尝试 AI 助理 prepare（需 AI 助理会话）或 createAndDeliver（高级版）
  if (templateId) {
    try {
      const conversationToken = await prepareStreamingCard(
        target ?? chatId,
        templateId,
        buildCardData('', 'thinking', '请稍候', toolId),
      );
      streamStates.set(messageId, { chatId, mode: 'card', conversationToken, toolId, target });
      return messageId;
    } catch (prepareErr) {
      log.debug('DingTalk prepare failed, trying createAndDeliver:', prepareErr);
      if (robotCode) {
        try {
          const effectiveTarget: DingTalkStreamingTarget = target
            ? { ...target, robotCode }
            : { chatId, robotCode };
          await createAndDeliverCard(
            effectiveTarget,
            templateId,
            messageId,
            buildCardData('', 'thinking', '请稍候', toolId),
          );
          streamStates.set(messageId, {
            chatId,
            mode: 'cardInstance',
            outTrackId: messageId,
            toolId,
            target,
          });
          return messageId;
        } catch (cardErr) {
          log.debug('DingTalk createAndDeliver failed:', cardErr);
        }
      }
    }
  }

  streamStates.set(messageId, { chatId, mode: 'text', toolId, target });
  log.info('DingTalk 流式卡片不可用，将使用普通文本回复');

  return messageId;
}

export async function updateMessage(
  chatId: string,
  messageId: string,
  content: string,
  status: MessageStatus,
  note?: string,
  toolId = 'claude',
): Promise<void> {
  void chatId;
  const state = streamStates.get(messageId);
  if (!state) return;

  if (state.mode === 'card' && state.conversationToken) {
    const templateId = getCardTemplateId();
    if (!templateId) return;
    try {
      await updateStreamingCard(
        state.conversationToken,
        templateId,
        buildCardData(content, status, note, toolId),
      );
    } catch (err) {
      log.warn('Failed to update DingTalk streaming card:', err);
    }
    return;
  }

  if (state.mode === 'cardInstance' && state.outTrackId) {
    try {
      await updateCardInstance(
        state.outTrackId,
        buildCardData(content, status, note, toolId),
      );
    } catch (err) {
      log.warn('Failed to update DingTalk card instance:', err);
    }
    return;
  }

  if (state.mode === 'interactiveCard' && state.cardBizId) {
    try {
      await updateRobotInteractiveCard(
        state.cardBizId,
        buildCardData(content, status, note, toolId),
      );
    } catch (err) {
      log.warn('Failed to update DingTalk interactive card:', err);
    }
    return;
  }
}

export async function sendFinalMessages(
  chatId: string,
  messageId: string,
  fullContent: string,
  note: string,
  toolId = 'claude',
): Promise<void> {
  const parts = splitLongContent(fullContent, MAX_DINGTALK_MESSAGE_LENGTH);
  const templateId = getCardTemplateId();
  const state = streamStates.get(messageId);

  if (templateId && state?.mode === 'card' && state.conversationToken) {
    let updatedCard = false;
    try {
      const cardNote =
        parts.length > 1 ? `内容较长，后续将继续发送 (${1}/${parts.length})` : note;
      await updateStreamingCard(
        state.conversationToken,
        templateId,
        buildCardData(parts[0], 'done', cardNote, toolId),
      );
      updatedCard = true;
      try {
        await finishStreamingCard(state.conversationToken);
      } catch (err) {
        log.warn('Failed to finish DingTalk streaming card after final update:', err);
      }
      streamStates.delete(messageId);

      for (let i = 1; i < parts.length; i++) {
        const partNote =
          i === parts.length - 1 ? note : `继续输出 (${i + 1}/${parts.length})`;
        await sendTextWithRetry(chatId, formatMessage(parts[i], 'done', partNote, toolId));
      }
      return;
    } catch (err) {
      if (updatedCard) {
        log.warn('Final DingTalk card update already succeeded; skip text fallback:', err);
        streamStates.delete(messageId);
        return;
      }
      log.warn('Failed to finalize DingTalk streaming card, falling back to text:', err);
      await tryFinishCard(state.conversationToken);
    }
  }

  if (templateId && state?.mode === 'cardInstance' && state.outTrackId) {
    try {
      const cardNote =
        parts.length > 1 ? `内容较长，后续将继续发送 (${1}/${parts.length})` : note;
      await updateCardInstance(
        state.outTrackId,
        buildCardData(parts[0], 'done', cardNote, toolId),
      );
      streamStates.delete(messageId);

      for (let i = 1; i < parts.length; i++) {
        const partNote =
          i === parts.length - 1 ? note : `继续输出 (${i + 1}/${parts.length})`;
        await sendTextWithRetry(chatId, formatMessage(parts[i], 'done', partNote, toolId));
      }
      return;
    } catch (err) {
      log.warn('Failed to finalize DingTalk card instance, falling back to text:', err);
    }
  }

  if (state?.mode === 'interactiveCard' && state.cardBizId) {
    try {
      const cardNote =
        parts.length > 1 ? `内容较长，后续将继续发送 (${1}/${parts.length})` : note;
      await updateRobotInteractiveCard(
        state.cardBizId,
        buildCardData(parts[0], 'done', cardNote, toolId),
      );
      streamStates.delete(messageId);

      for (let i = 1; i < parts.length; i++) {
        const partNote =
          i === parts.length - 1 ? note : `继续输出 (${i + 1}/${parts.length})`;
        await sendTextWithRetry(chatId, formatMessage(parts[i], 'done', partNote, toolId));
      }
      return;
    } catch (err) {
      log.warn('Failed to finalize DingTalk interactive card, falling back to text:', err);
    }
  }

  streamStates.delete(messageId);
  for (let i = 0; i < parts.length; i++) {
    const partNote =
      parts.length > 1
        ? `${i === parts.length - 1 ? note + '\n' : ''}(续 ${i + 1}/${parts.length})`.trim()
        : note;
    await sendTextWithRetry(chatId, formatMessage(parts[i], 'done', partNote, toolId));
  }
}

export async function sendErrorMessage(
  chatId: string,
  messageId: string,
  error: string,
  toolId = 'claude',
): Promise<void> {
  const templateId = getCardTemplateId();
  const state = streamStates.get(messageId);
  if (templateId && state?.mode === 'card' && state.conversationToken) {
    let updatedCard = false;
    try {
      await updateStreamingCard(
        state.conversationToken,
        templateId,
        buildCardData(`错误：${error}`, 'error', '执行失败', toolId),
      );
      updatedCard = true;
      try {
        await finishStreamingCard(state.conversationToken);
      } catch (err) {
        log.warn('Failed to finish DingTalk error card after update:', err);
      }
      streamStates.delete(messageId);
      return;
    } catch (err) {
      if (updatedCard) {
        log.warn('DingTalk error card update already succeeded; skip text fallback:', err);
        streamStates.delete(messageId);
        return;
      }
      log.warn('Failed to send DingTalk error card, falling back to text:', err);
      await tryFinishCard(state.conversationToken);
    }
  }

  if (templateId && state?.mode === 'cardInstance' && state.outTrackId) {
    try {
      await updateCardInstance(
        state.outTrackId,
        buildCardData(`错误：${error}`, 'error', '执行失败', toolId),
      );
      streamStates.delete(messageId);
      return;
    } catch (err) {
      log.warn('Failed to update DingTalk error card instance, falling back to text:', err);
    }
  }

  if (state?.mode === 'interactiveCard' && state.cardBizId) {
    try {
      await updateRobotInteractiveCard(
        state.cardBizId,
        buildCardData(`错误：${error}`, 'error', '执行失败', toolId),
      );
      streamStates.delete(messageId);
      return;
    } catch (err) {
      log.warn('Failed to update DingTalk error interactive card, falling back to text:', err);
    }
  }

  streamStates.delete(messageId);
  await sendTextWithRetry(chatId, formatMessage(`错误：${error}`, 'error', '执行失败', toolId));
}

export async function sendTextReply(
  chatId: string,
  text: string,
  _threadCtx?: ThreadContext | string,
): Promise<void> {
  await sendTextWithRetry(chatId, formatMessage(text, 'done', undefined, OPEN_IM_SYSTEM_TITLE));
  log.info(`Text reply sent to DingTalk chat ${chatId}`);
}

export async function sendImageReply(chatId: string, imagePath: string): Promise<void> {
  await sendTextReply(chatId, buildImageFallbackMessage('dingtalk', imagePath));
}

export async function sendProactiveTextReply(
  target: string | DingTalkActiveTarget,
  text: string,
): Promise<void> {
  await sendProactiveText(target, formatMessage(text, 'done', undefined, OPEN_IM_SYSTEM_TITLE));
  const targetId = typeof target === 'string' ? target : target.chatId;
  log.info(`Proactive text sent to DingTalk chat ${targetId}`);
}

export async function sendPermissionCard(
  chatId: string,
  requestId: string,
  toolName: string,
  toolInput: string,
): Promise<void> {
  const message = buildPermissionRequestMessage(toolName, toolInput, requestId);
  await sendTextWithRetry(chatId, message);
}

export async function sendModeCard(
  chatId: string,
  _userId: string,
  currentMode: string,
): Promise<void> {
  const { MODE_LABELS } = await import('../permission-mode/types.js');
  const message = buildModeMessage(
    MODE_LABELS[currentMode as keyof typeof MODE_LABELS] || currentMode,
  );
  await sendTextWithRetry(chatId, message);
}

export async function sendDirectorySelection(
  chatId: string,
  currentDir: string,
  userId: string,
): Promise<void> {
  const directories = listDirectories(currentDir);
  const dirName = basename(currentDir) || currentDir;
  if (directories.length === 0) {
    await sendTextWithRetry(chatId, buildDirectoryMessage(dirName));
    return;
  }
  const keyboard = buildDirectoryKeyboard(directories, userId);
  const entries = keyboard.inline_keyboard
    .flat()
    .map((item) => item.text)
    .map((item) => `- ${item}`);
  await sendTextWithRetry(chatId, buildDirectoryMessage(dirName, entries));
}

export function startTypingLoop(_chatId: string): () => void {
  return () => {};
}
