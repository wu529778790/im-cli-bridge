import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream';
import type { Config } from '../config.js';
import { createLogger } from '../logger.js';
import type { DingTalkActiveTarget } from '../shared/active-chats.js';

const log = createLogger('DingTalk');
const DINGTALK_OPENAPI_BASE = 'https://api.dingtalk.com';
const DINGTALK_OAPI_BASE = 'https://oapi.dingtalk.com';
const TEXT_MSG_KEY = 'sampleText';

let client: DWClient | null = null;
let messageHandler: ((data: DWClientDownStream) => Promise<void>) | null = null;
const sessionWebhookByChat = new Map<string, string>();
const unionIdByUserId = new Map<string, string>();

export interface DingTalkStreamingTarget {
  chatId: string;
  conversationType?: string;
  senderStaffId?: string;
  senderId?: string;
  robotCode?: string;
}

function getClient(): DWClient {
  if (!client) {
    throw new Error('DingTalk client not initialized');
  }
  return client;
}

export function registerSessionWebhook(chatId: string, sessionWebhook: string): void {
  if (!chatId || !sessionWebhook) return;
  sessionWebhookByChat.set(chatId, sessionWebhook);
}

async function sendByWebhook(chatId: string, body: Record<string, unknown>): Promise<unknown> {
  const sessionWebhook = sessionWebhookByChat.get(chatId);
  if (!sessionWebhook) {
    throw new Error(`DingTalk sessionWebhook unavailable for chat ${chatId}`);
  }

  const accessToken = await getClient().getAccessToken();
  const res = await fetch(sessionWebhook, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-acs-dingtalk-access-token': String(accessToken),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DingTalk reply failed: ${res.status} ${text}`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function sendText(chatId: string, content: string): Promise<unknown> {
  return sendByWebhook(chatId, {
    msgtype: 'text',
    text: { content },
  });
}

export async function sendMarkdown(chatId: string, title: string, text: string): Promise<unknown> {
  return sendByWebhook(chatId, {
    msgtype: 'markdown',
    markdown: {
      title,
      text,
    },
  });
}

function buildAiCardContent(templateId: string, cardData: Record<string, unknown>): string {
  return JSON.stringify({
    templateId,
    cardData,
  });
}

function getRobotCode(target: DingTalkActiveTarget): string {
  if (!target.robotCode) {
    throw new Error('DingTalk proactive target is missing robotCode');
  }
  return target.robotCode;
}

function buildTextPayload(content: string): Record<string, unknown> {
  return {
    msgKey: TEXT_MSG_KEY,
    msgParam: JSON.stringify({ content }),
  };
}

async function callOpenApi(path: string, body: Record<string, unknown>): Promise<unknown> {
  const accessToken = await getClient().getAccessToken();
  const res = await fetch(`${DINGTALK_OPENAPI_BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-acs-dingtalk-access-token': String(accessToken),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DingTalk OpenAPI failed: ${res.status} ${text}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }

  const errorCode = parsed.errorcode ?? parsed.errcode;
  const success = parsed.success;
  if (
    errorCode === 0 ||
    errorCode === '0' ||
    success === true ||
    (errorCode === undefined && success === undefined)
  ) {
    return parsed;
  }

  const errorMessage =
    typeof parsed.errmsg === 'string'
      ? parsed.errmsg
      : typeof parsed.errormsg === 'string'
        ? parsed.errormsg
        : typeof parsed.message === 'string'
          ? parsed.message
          : text;
  throw new Error(`DingTalk OpenAPI business error: ${String(errorCode)} ${errorMessage}`);
}

async function callOapi(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const accessToken = await getClient().getAccessToken();
  const res = await fetch(
    `${DINGTALK_OAPI_BASE}${path}?access_token=${encodeURIComponent(String(accessToken))}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    },
  );

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DingTalk OAPI failed: ${res.status} ${text}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`DingTalk OAPI returned non-JSON response: ${text}`);
  }

  const errorCode = parsed.errcode;
  if (errorCode === 0 || errorCode === '0' || errorCode === undefined) {
    return parsed;
  }

  const errorMessage =
    typeof parsed.errmsg === 'string'
      ? parsed.errmsg
      : typeof parsed.message === 'string'
        ? parsed.message
        : text;
  throw new Error(`DingTalk OAPI business error: ${String(errorCode)} ${errorMessage}`);
}

function normalizeConversationType(type?: string): string | undefined {
  return type?.trim().toLowerCase();
}

function isSingleConversation(type?: string): boolean {
  const normalizedType = normalizeConversationType(type);
  return (
    normalizedType === '0' ||
    normalizedType === 'single' ||
    normalizedType === 'singlechat' ||
    normalizedType === 'oto'
  );
}

function isGroupConversation(type?: string): boolean {
  const normalizedType = normalizeConversationType(type);
  return (
    normalizedType === '1' ||
    normalizedType === '2' ||
    normalizedType === 'group' ||
    normalizedType === 'groupchat'
  );
}

async function resolveUnionIdByUserId(userId?: string): Promise<string | undefined> {
  if (!userId) return undefined;
  const cached = unionIdByUserId.get(userId);
  if (cached) return cached;

  const result = await callOapi('/topapi/v2/user/get', {
    userid: userId,
    language: 'zh_CN',
  });
  const unionId = (result.result as Record<string, unknown> | undefined)?.unionid;
  if (typeof unionId === 'string' && unionId.length > 0) {
    unionIdByUserId.set(userId, unionId);
    return unionId;
  }
  return undefined;
}

function buildProactiveAttempts(
  target: DingTalkActiveTarget,
  content: string,
): Array<{ label: string; path: string; body: Record<string, unknown> }> {
  const robotCode = getRobotCode(target);
  const payload = buildTextPayload(content);
  const normalizedType = normalizeConversationType(target.conversationType);
  const attempts: Array<{ label: string; path: string; body: Record<string, unknown> }> = [];

  const pushSingle = () => {
    if (!target.userId) return;
    attempts.push({
      label: 'single',
      path: '/v1.0/robot/oToMessages/batchSend',
      body: {
        robotCode,
        userIds: [target.userId],
        ...payload,
      },
    });
  };

  const pushGroup = () => {
    if (!target.chatId) return;
    attempts.push({
      label: 'group',
      path: '/v1.0/robot/groupMessages/send',
      body: {
        robotCode,
        openConversationId: target.chatId,
        ...payload,
      },
    });
  };

  if (
    normalizedType === '1' ||
    normalizedType === '2' ||
    normalizedType === 'group' ||
    normalizedType === 'groupchat'
  ) {
    pushGroup();
    return attempts;
  }

  if (
    normalizedType === '0' ||
    normalizedType === 'single' ||
    normalizedType === 'singlechat' ||
    normalizedType === 'oto'
  ) {
    pushSingle();
    if (attempts.length === 0) pushGroup();
    return attempts;
  }

  // 文档里 conversationType 的取值描述并不完全统一；未知时优先按原会话发群，避免误私发给个人。
  pushGroup();
  pushSingle();
  return attempts;
}

export function ackMessage(messageId: string, result: unknown = { ok: true }): void {
  if (!client || !messageId) return;
  try {
    client.socketCallBackResponse(messageId, result);
  } catch (err) {
    log.debug('Failed to ack DingTalk callback:', err);
  }
}

export async function initDingTalk(
  cfg: Config,
  eventHandler: (data: DWClientDownStream) => Promise<void>,
): Promise<void> {
  if (!cfg.dingtalkClientId || !cfg.dingtalkClientSecret) {
    throw new Error('DingTalk clientId and clientSecret are required');
  }

  messageHandler = eventHandler;
  client = new DWClient({
    clientId: cfg.dingtalkClientId,
    clientSecret: cfg.dingtalkClientSecret,
    keepAlive: true,
    debug: false,
  });

  client.registerCallbackListener(TOPIC_ROBOT, async (data: DWClientDownStream) => {
    if (!messageHandler) return;
    try {
      await messageHandler(data);
    } catch (err) {
      log.error('Unhandled DingTalk callback error:', err);
      ackMessage(data.headers.messageId, { error: String(err) });
    }
  });

  await client.connect();
  log.info('DingTalk stream client connected');
}

export function stopDingTalk(): void {
  try {
    client?.disconnect();
  } catch (err) {
    log.debug('Failed to disconnect DingTalk client:', err);
  } finally {
    sessionWebhookByChat.clear();
    unionIdByUserId.clear();
    client = null;
    messageHandler = null;
    log.info('DingTalk client stopped');
  }
}

export async function sendProactiveText(
  target: string | DingTalkActiveTarget,
  content: string,
): Promise<void> {
  if (typeof target === 'string') {
    await sendText(target, content);
    return;
  }

  const attempts = buildProactiveAttempts(target, content);
  if (attempts.length === 0) {
    throw new Error('DingTalk proactive target is incomplete');
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      await callOpenApi(attempt.path, attempt.body);
      return;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('robot') || msg.includes('resource.not.found')) {
        log.debug(`DingTalk proactive ${attempt.label} send failed:`, err);
      } else {
        log.warn(`DingTalk proactive ${attempt.label} send failed:`, err);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`DingTalk proactive send failed for chat ${target.chatId}`);
}

export async function prepareStreamingCard(
  target: string | DingTalkStreamingTarget,
  templateId: string,
  cardData: Record<string, unknown>,
): Promise<string> {
  const normalizedTarget: DingTalkStreamingTarget =
    typeof target === 'string' ? { chatId: target } : target;
  const contentType = 'ai_card';
  const content = buildAiCardContent(templateId, cardData);
  const attempts: Array<{ label: string; body: Record<string, unknown> }> = [];

  log.debug(
    `DingTalk prepare: conversationType=${normalizedTarget.conversationType ?? 'undefined'}, senderStaffId=${normalizedTarget.senderStaffId ?? 'undefined'}`,
  );

  if (isSingleConversation(normalizedTarget.conversationType)) {
    let unionId: string | undefined;
    try {
      unionId = await resolveUnionIdByUserId(normalizedTarget.senderStaffId);
    } catch (err) {
      log.debug('Failed to resolve DingTalk unionId from senderStaffId:', err);
    }

    if (unionId) {
      attempts.push({
        label: 'single-unionid',
        body: { unionId, contentType, content },
      });
    }
    if (normalizedTarget.chatId) {
      attempts.push({
        label: 'single-chatid',
        body: { openConversationId: normalizedTarget.chatId, contentType, content },
      });
    }
  } else if (isGroupConversation(normalizedTarget.conversationType)) {
    // 群聊时也优先尝试 unionId：部分场景下 conversationType 可能误报，或单聊被识别为群聊
    let unionId: string | undefined;
    try {
      unionId = await resolveUnionIdByUserId(normalizedTarget.senderStaffId);
    } catch (err) {
      log.debug('Failed to resolve DingTalk unionId for group (fallback):', err);
    }
    if (unionId) {
      attempts.push({
        label: 'group-unionid',
        body: { unionId, contentType, content },
      });
    }
    if (normalizedTarget.chatId) {
      attempts.push({
        label: 'group-chatid',
        body: { openConversationId: normalizedTarget.chatId, contentType, content },
      });
    }
  } else {
    let unionId: string | undefined;
    try {
      unionId = await resolveUnionIdByUserId(normalizedTarget.senderStaffId);
    } catch (err) {
      log.debug('Failed to resolve DingTalk unionId for unknown conversation type:', err);
    }

    if (unionId) {
      attempts.push({
        label: 'unknown-unionid',
        body: { unionId, contentType, content },
      });
    }
    if (normalizedTarget.chatId) {
      attempts.push({
        label: 'unknown-chatid',
        body: { openConversationId: normalizedTarget.chatId, contentType, content },
      });
    }
  }

  if (attempts.length === 0) {
    throw new Error('DingTalk prepare target is incomplete');
  }

  let result: Record<string, unknown> | undefined;
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      result = await callOpenApi('/v1.0/aiInteraction/prepare', attempt.body) as Record<string, unknown>;
      break;
    } catch (err) {
      lastError = err;
      log.debug(`DingTalk prepare attempt failed (${attempt.label}):`, err);
    }
  }

  if (!result) {
    throw lastError instanceof Error ? lastError : new Error('DingTalk prepare failed');
  }

  const token = (result.result as Record<string, unknown> | undefined)?.conversationToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`DingTalk prepare did not return conversationToken: ${JSON.stringify(result)}`);
  }
  return token;
}

export async function updateStreamingCard(
  conversationToken: string,
  templateId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  const result = await callOpenApi('/v1.0/aiInteraction/update', {
    conversationToken,
    contentType: 'ai_card',
    content: buildAiCardContent(templateId, cardData),
  }) as Record<string, unknown>;

  const success = (result.result as Record<string, unknown> | undefined)?.success;
  if (success === false) {
    throw new Error(`DingTalk update returned success=false: ${JSON.stringify(result)}`);
  }
}

export async function finishStreamingCard(conversationToken: string): Promise<void> {
  const result = await callOpenApi('/v1.0/aiInteraction/finish', {
    conversationToken,
  }) as Record<string, unknown>;

  const success = (result.result as Record<string, unknown> | undefined)?.success;
  if (success === false) {
    throw new Error(`DingTalk finish returned success=false: ${JSON.stringify(result)}`);
  }
}

/** 创建并投放卡片（卡片平台 API，支持普通群流式更新） */
export async function createAndDeliverCard(
  target: DingTalkStreamingTarget,
  templateId: string,
  outTrackId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  const { chatId, robotCode, conversationType, senderStaffId } = target;
  if (!robotCode) {
    throw new Error('DingTalk robotCode required for createAndDeliver');
  }

  const isSingle = isSingleConversation(conversationType);
  const cardParamMap = buildCardParamMap(cardData);
  if (!cardParamMap.content && !cardParamMap.lastMessage) cardParamMap.content = '...';

  const lastMsg = String(cardData.lastMessage ?? cardData.displayText ?? cardData.content ?? cardData.title ?? 'AI').slice(0, 50);

  const body: Record<string, unknown> = {
    userId: senderStaffId ?? 'system',
    cardTemplateId: templateId,
    outTrackId,
    cardData: { cardParamMap },
  };

  if (isSingle && senderStaffId) {
    body.openSpaceId = `dtv1.card//im_robot.${senderStaffId}`;
    body.imRobotOpenSpaceModel = {
      lastMessageI18n: { zh_CN: lastMsg },
      searchSupport: { searchIcon: '', searchTypeName: '消息', searchDesc: '' },
      notification: { alertContent: lastMsg },
    };
    body.imRobotOpenDeliverModel = { spaceType: 'IM_ROBOT' };
  } else {
    body.openSpaceId = `dtv1.card//im_group.${chatId}`;
    body.imGroupOpenSpaceModel = {
      lastMessageI18n: { zh_CN: lastMsg },
      searchSupport: { searchIcon: '', searchTypeName: '消息', searchDesc: '' },
      notification: { alertContent: lastMsg },
    };
    body.imGroupOpenDeliverModel = {
      robotCode,
      atUserIds: {},
      recipients: [],
    };
  }

  await callOpenApiWithMethod('POST', '/v1.0/card/instances/createAndDeliver', body);
}

/** 将 cardData 转为 cardParamMap（对象/数组需 JSON 序列化） */
function buildCardParamMap(cardData: Record<string, unknown>): Record<string, string> {
  const cardParamMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(cardData)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') {
      cardParamMap[k] = JSON.stringify(v);
    } else {
      cardParamMap[k] = String(v);
    }
  }
  return cardParamMap;
}

/** 更新卡片实例（用于流式更新） */
export async function updateCardInstance(
  outTrackId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  const cardParamMap = buildCardParamMap(cardData);
  await callOpenApiWithMethod('PUT', '/v1.0/card/instances', {
    outTrackId,
    cardData: { cardParamMap },
  });
}

/** 互动卡片普通版：发送（用于 prepare 失败时的 fallback 流式） */
export async function sendRobotInteractiveCard(
  target: DingTalkStreamingTarget,
  cardBizId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  const { chatId, robotCode, conversationType } = target;
  if (!robotCode) {
    throw new Error('DingTalk robotCode required for interactive card');
  }

  const content = String(cardData.content ?? cardData.displayText ?? '').trim() || '...';
  const title = String(cardData.title ?? 'AI');
  const cardDataStr = JSON.stringify({
    cardParamMap: {
      title,
      text: content,
    },
  });

  const isSingle = isSingleConversation(conversationType);
  const body: Record<string, unknown> = {
    cardTemplateId: 'StandardCard',
    cardBizId,
    outTrackId: cardBizId,
    robotCode,
    cardData: cardDataStr,
  };

  if (isSingle && target.senderStaffId) {
    body.singleChatReceiver = JSON.stringify({ userid: target.senderStaffId });
  } else {
    body.openConversationId = chatId;
  }

  log.debug(
    `DingTalk sendRobotInteractiveCard: isSingle=${isSingle}, robotCode=${robotCode?.slice(0, 8)}..., chatIdLen=${chatId?.length}`,
  );

  try {
    await callOpenApiWithMethod('POST', '/v1.0/im/v1.0/robot/interactiveCards/send', body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('param.error') || msg.includes('参数无效')) {
      log.warn(
        'DingTalk robot interactive card param.error - request body (no secrets):',
        JSON.stringify(
          { ...body, robotCode: body.robotCode ? '[REDACTED]' : undefined },
          null,
          2,
        ),
      );
    }
    throw err;
  }
}

/** 互动卡片普通版：更新（单条消息流式更新） */
export async function updateRobotInteractiveCard(
  cardBizId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  const body = {
    cardBizId,
    cardData: JSON.stringify({
      cardParamMap: {
        title: cardData.title ?? 'AI',
        text: cardData.content ?? cardData.displayText ?? '',
      },
    }),
  };
  await callOpenApiWithMethod('PUT', '/v1.0/im/robots/interactiveCards', body);
}

async function callOpenApiWithMethod(
  method: string,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const accessToken = await getClient().getAccessToken();
  const res = await fetch(`${DINGTALK_OPENAPI_BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-acs-dingtalk-access-token': String(accessToken),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DingTalk OpenAPI failed: ${res.status} ${text}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }

  const errorCode = parsed.errorcode ?? parsed.errcode;
  const success = parsed.success;
  if (
    errorCode === 0 ||
    errorCode === '0' ||
    success === true ||
    (errorCode === undefined && success === undefined)
  ) {
    return parsed;
  }

  const errorMessage =
    typeof parsed.errmsg === 'string'
      ? parsed.errmsg
      : typeof parsed.errormsg === 'string'
        ? parsed.errormsg
        : typeof parsed.message === 'string'
          ? parsed.message
          : text;
  throw new Error(`DingTalk OpenAPI business error: ${String(errorCode)} ${errorMessage}`);
}
