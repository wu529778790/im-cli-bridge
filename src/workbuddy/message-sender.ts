/**
 * WorkBuddy Message Sender - Send responses to WeChat KF
 */

import { createLogger } from '../logger.js';
import { getCentrifugeClient } from './client.js';
import type { WorkBuddyCentrifugeClient } from './centrifuge-client.js';

const log = createLogger('WorkBuddySender');

/**
 * Send text reply to WeChat KF
 */
export async function sendTextReply(
  _client: WorkBuddyCentrifugeClient | null,
  chatId: string,
  text: string,
  msgId: string,
): Promise<void> {
  const client = _client ?? getCentrifugeClient();
  if (!client) {
    log.warn('WorkBuddy client not available, cannot send reply');
    return;
  }

  log.info(`Sending WorkBuddy reply to chatId=${chatId}, msgId=${msgId}`);

  await client.sendPromptResponse({
    session_id: chatId,
    prompt_id: msgId,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
  });
}

/**
 * Send error response to WeChat KF
 */
export async function sendErrorReply(
  _client: WorkBuddyCentrifugeClient | null,
  chatId: string,
  error: string,
  msgId: string,
): Promise<void> {
  const client = _client ?? getCentrifugeClient();
  if (!client) {
    log.warn('WorkBuddy client not available, cannot send error');
    return;
  }

  log.info(`Sending WorkBuddy error to chatId=${chatId}, msgId=${msgId}`);

  await client.sendPromptResponse({
    session_id: chatId,
    prompt_id: msgId,
    error,
    stop_reason: 'error',
  });
}

/**
 * Send streaming chunk to WeChat KF
 */
export function sendStreamingChunk(
  _client: WorkBuddyCentrifugeClient | null,
  chatId: string,
  text: string,
  msgId: string,
): void {
  const client = _client ?? getCentrifugeClient();
  if (!client) {
    log.warn('WorkBuddy client not available, cannot send chunk');
    return;
  }

  client.sendMessageChunk(chatId, msgId, { type: 'text', text });
}

/**
 * Send streaming reply to WeChat KF via HTTP COPILOT_RESPONSE.
 * Used for intermediate progress updates during AI task execution.
 */
export async function sendStreamingReply(
  _client: WorkBuddyCentrifugeClient | null,
  chatId: string,
  text: string,
  msgId: string,
): Promise<void> {
  const client = _client ?? getCentrifugeClient();
  if (!client) {
    log.debug('WorkBuddy client not available, skipping streaming reply');
    return;
  }

  await client.sendPromptResponse({
    session_id: chatId,
    prompt_id: msgId,
    content: [{ type: 'text', text }],
    stop_reason: 'streaming',
  });
}
