import { createLogger } from '../logger.js';

const log = createLogger('DingTalk');
export const DINGTALK_OPENAPI_BASE = 'https://api.dingtalk.com';
const DINGTALK_OAPI_BASE = 'https://oapi.dingtalk.com';
const TEXT_MSG_KEY = 'sampleText';

/**
 * Shared configuration for DingTalk API calls.
 * Consumers inject a token provider so the HTTP layer stays stateless.
 */
export interface DingTalkApiConfig {
  getAccessToken: () => Promise<string>;
}

// ---------------------------------------------------------------------------
// Base HTTP helper – consolidates callOpenApi / callOapi / callOpenApiWithMethod
// ---------------------------------------------------------------------------

type ApiResponseStyle = 'openapi' | 'oapi';

interface DingTalkFetchOptions {
  method?: string;
  baseUrl?: string;
  path: string;
  body: Record<string, unknown>;
  responseStyle: ApiResponseStyle;
  /** For OAPI-style, the token is sent as a query parameter instead of a header. */
  tokenAsQueryParam?: boolean;
  timeoutMs?: number;
}

async function dingtalkFetch(
  getAccessToken: () => Promise<string>,
  options: DingTalkFetchOptions,
): Promise<unknown> {
  const {
    method = 'POST',
    baseUrl = DINGTALK_OPENAPI_BASE,
    path,
    body,
    responseStyle,
    tokenAsQueryParam = false,
    timeoutMs = 30_000,
  } = options;

  const accessToken = await getAccessToken();

  let url: string;
  let headers: Record<string, string>;

  if (tokenAsQueryParam) {
    url = `${baseUrl}${path}?access_token=${encodeURIComponent(String(accessToken))}`;
    headers = { 'content-type': 'application/json' };
  } else {
    url = `${baseUrl}${path}`;
    headers = {
      'content-type': 'application/json',
      'x-acs-dingtalk-access-token': String(accessToken),
    };
  }

  const res = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  if (!res.ok) {
    const label = responseStyle === 'oapi' ? 'OAPI' : 'OpenAPI';
    throw new Error(`DingTalk ${label} failed: ${res.status} ${text}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    if (responseStyle === 'oapi') {
      throw new Error(`DingTalk OAPI returned non-JSON response: ${text}`);
    }
    return text;
  }

  if (responseStyle === 'oapi') {
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

  // OpenAPI-style response handling
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

// ---------------------------------------------------------------------------
// Thin public wrappers
// ---------------------------------------------------------------------------

/**
 * POST to the DingTalk OpenAPI (`api.dingtalk.com`) with auto-access-token header.
 */
export async function callOpenApi(
  getAccessToken: () => Promise<string>,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return dingtalkFetch(getAccessToken, {
    path,
    body,
    responseStyle: 'openapi',
  });
}

/**
 * POST to the DingTalk legacy OAPI (`oapi.dingtalk.com`) with token as query param.
 */
export async function callOapi(
  getAccessToken: () => Promise<string>,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return dingtalkFetch(getAccessToken, {
    baseUrl: DINGTALK_OAPI_BASE,
    path,
    body,
    responseStyle: 'oapi',
    tokenAsQueryParam: true,
  }) as Promise<Record<string, unknown>>;
}

/**
 * POST/PUT to the DingTalk OpenAPI with a configurable HTTP method.
 */
export async function callOpenApiWithMethod(
  getAccessToken: () => Promise<string>,
  method: string,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return dingtalkFetch(getAccessToken, {
    method,
    path,
    body,
    responseStyle: 'openapi',
  });
}

// ---------------------------------------------------------------------------
// Shared text-payload helper (used by proactive send)
// ---------------------------------------------------------------------------

export function buildTextPayload(content: string): Record<string, unknown> {
  return {
    msgKey: TEXT_MSG_KEY,
    msgParam: JSON.stringify({ content }),
  };
}
