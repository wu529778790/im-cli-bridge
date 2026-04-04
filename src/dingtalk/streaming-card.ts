import { createLogger } from '../logger.js';
import { callOpenApi, callOapi, callOpenApiWithMethod } from './api.js';
import type { DingTalkApiConfig } from './api.js';

const log = createLogger('DingTalk');

export interface DingTalkStreamingTarget {
  chatId: string;
  conversationType?: string;
  senderStaffId?: string;
  senderId?: string;
  robotCode?: string;
}

// ---------------------------------------------------------------------------
// Conversation-type helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Union ID resolution
// ---------------------------------------------------------------------------

const unionIdByUserId = new Map<string, string>();

export function clearUnionIdCache(): void {
  unionIdByUserId.clear();
}

async function resolveUnionIdByUserId(
  apiConfig: DingTalkApiConfig,
  userId?: string,
): Promise<string | undefined> {
  if (!userId) return undefined;
  const cached = unionIdByUserId.get(userId);
  if (cached) return cached;

  const result = await callOapi(apiConfig.getAccessToken, '/topapi/v2/user/get', {
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

// ---------------------------------------------------------------------------
// Card content helpers
// ---------------------------------------------------------------------------

function buildAiCardContent(templateId: string, cardData: Record<string, unknown>): string {
  return JSON.stringify({
    templateId,
    cardData,
  });
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

/** StandardCard 模板结构（与钉钉官方 Go 打字机示例完全一致：text=标题，markdown=内容） */
function buildStandardCardData(cardData: Record<string, unknown>): string {
  const title = String(cardData.title ?? 'AI');
  const content = String(cardData.content ?? cardData.displayText ?? '').trim() || '...';
  const schema = {
    config: { autoLayout: true, enableForward: true },
    header: {
      title: { type: 'text', text: title },
      logo: '@lALPDfJ6V_FPDmvNAfTNAfQ',
    },
    contents: [
      { type: 'text', text: title, id: 'text_1693929551595' },
      { type: 'divider', id: 'divider_1693929551595' },
      { type: 'markdown', text: content, id: 'markdown_1693929674245' },
    ],
  };
  return JSON.stringify(schema);
}

// ---------------------------------------------------------------------------
// AI streaming card API (prepare / update / finish)
// ---------------------------------------------------------------------------

export async function prepareStreamingCard(
  apiConfig: DingTalkApiConfig,
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
      unionId = await resolveUnionIdByUserId(apiConfig, normalizedTarget.senderStaffId);
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
      unionId = await resolveUnionIdByUserId(apiConfig, normalizedTarget.senderStaffId);
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
      unionId = await resolveUnionIdByUserId(apiConfig, normalizedTarget.senderStaffId);
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
      result = await callOpenApi(apiConfig.getAccessToken, '/v1.0/aiInteraction/prepare', attempt.body) as Record<string, unknown>;
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
  apiConfig: DingTalkApiConfig,
  conversationToken: string,
  templateId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  const result = await callOpenApi(apiConfig.getAccessToken, '/v1.0/aiInteraction/update', {
    conversationToken,
    contentType: 'ai_card',
    content: buildAiCardContent(templateId, cardData),
  }) as Record<string, unknown>;

  const success = (result.result as Record<string, unknown> | undefined)?.success;
  if (success === false) {
    throw new Error(`DingTalk update returned success=false: ${JSON.stringify(result)}`);
  }
}

export async function finishStreamingCard(
  apiConfig: DingTalkApiConfig,
  conversationToken: string,
): Promise<void> {
  const result = await callOpenApi(apiConfig.getAccessToken, '/v1.0/aiInteraction/finish', {
    conversationToken,
  }) as Record<string, unknown>;

  const success = (result.result as Record<string, unknown> | undefined)?.success;
  if (success === false) {
    throw new Error(`DingTalk finish returned success=false: ${JSON.stringify(result)}`);
  }
}

// ---------------------------------------------------------------------------
// Card platform API (createAndDeliver / updateCardInstance)
// ---------------------------------------------------------------------------

/** 创建并投放卡片（卡片平台 API，支持普通群流式更新） */
export async function createAndDeliverCard(
  apiConfig: DingTalkApiConfig,
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

  await callOpenApiWithMethod(apiConfig.getAccessToken, 'POST', '/v1.0/card/instances/createAndDeliver', body);
}

/** 更新卡片实例（用于流式更新） */
export async function updateCardInstance(
  apiConfig: DingTalkApiConfig,
  outTrackId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  const cardParamMap = buildCardParamMap(cardData);
  await callOpenApiWithMethod(apiConfig.getAccessToken, 'PUT', '/v1.0/card/instances', {
    outTrackId,
    cardData: { cardParamMap },
  });
}

// ---------------------------------------------------------------------------
// Interactive card (fallback streaming)
// ---------------------------------------------------------------------------

/** 互动卡片普通版：发送（用于 prepare 失败时的 fallback 流式） */
export async function sendRobotInteractiveCard(
  apiConfig: DingTalkApiConfig,
  target: DingTalkStreamingTarget,
  cardBizId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  const { chatId, robotCode, conversationType } = target;
  if (!robotCode) {
    throw new Error('DingTalk robotCode required for interactive card');
  }

  const cardDataStr = buildStandardCardData(cardData);

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
    await callOpenApiWithMethod(apiConfig.getAccessToken, 'POST', '/v1.0/im/v1.0/robot/interactiveCards/send', body);
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
  apiConfig: DingTalkApiConfig,
  cardBizId: string,
  cardData: Record<string, unknown>,
): Promise<void> {
  const cardDataStr = buildStandardCardData(cardData);
  const body = { cardBizId, cardData: cardDataStr };
  await callOpenApiWithMethod(apiConfig.getAccessToken, 'PUT', '/v1.0/im/robots/interactiveCards', body);
}
