/**
 * Permission Server - Handles tool permission requests from Claude CLI
 *
 * When claudeSkipPermissions is false and not in yolo mode, Claude CLI will make
 * HTTP requests to this server. We forward all requests to the user for approval;
 * permission mode logic (ask/accept-edits/plan) is handled by Claude via --permission-mode.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createLogger } from '../logger.js';
import { getPlatformByChatId } from '../shared/chat-user-map.js';

const log = createLogger('PermissionServer');

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes default timeout
const DEFAULT_PORT = 35801;

interface PermissionRequest {
  requestId: string;
  chatId: string;
  toolName: string;
  toolInput: string;
  timestamp: number;
  resolve: (allowed: boolean) => void;
  timeout: NodeJS.Timeout;
}

interface MessageSender {
  sendTextReply(chatId: string, text: string): Promise<void>;
  sendPermissionCard?(chatId: string, requestId: string, toolName: string, toolInput: string): Promise<void>;
}

export function resolvePermissionChatId(data: Record<string, unknown>): string | undefined {
  if (typeof data.chatId === 'string' && data.chatId.trim()) {
    return data.chatId;
  }
  if (typeof data.chat_id === 'string' && data.chat_id.trim()) {
    return data.chat_id;
  }
  return undefined;
}

// Global state
let server: Server | null = null;
let serverPort = DEFAULT_PORT;
const pendingRequests = new Map<string, PermissionRequest>();
const requestsByChat = new Map<string, PermissionRequest[]>();
const messageSenders = new Map<string, MessageSender>();

/**
 * Start the permission HTTP server
 */
export function startPermissionServer(port: number = DEFAULT_PORT): number {
  if (server) {
    log.warn('Permission server already running');
    return serverPort;
  }

  serverPort = port;

  server = createServer(handleRequest);

  server.listen(port, () => {
    log.info(`Permission server listening on port ${port}`);
  });

  server.on('error', (err) => {
    log.error('Permission server error:', err);
  });

  // Cleanup expired permissions every minute
  setInterval(() => {
    cleanupExpiredPermissions();
  }, 60 * 1000).unref();

  return port;
}

/**
 * Stop the permission HTTP server
 */
export function stopPermissionServer(): void {
  if (server) {
    server.close(() => {
      log.info('Permission server stopped');
    });
    server = null;

    // Reject all pending requests
    for (const req of pendingRequests.values()) {
      clearTimeout(req.timeout);
      req.resolve(false);
    }
    pendingRequests.clear();
    requestsByChat.clear();
  }
}

/**
 * Register the message sender for sending permission prompts
 */
export function registerPermissionSender(_platform: string, sender: MessageSender): void {
  messageSenders.set(_platform, sender);
  log.info(`Message sender registered for permission prompts: ${_platform}`);
}

/**
 * Get the number of pending permission requests for a chat
 */
export function getPendingCount(chatId: string): number {
  const requests = requestsByChat.get(chatId);
  return requests ? requests.length : 0;
}

/**
 * Resolve the latest pending permission request for a chat
 * Returns the requestId if found, null otherwise
 */
export function resolveLatestPermission(chatId: string, decision: 'allow' | 'deny'): string | null {
  const requests = requestsByChat.get(chatId);
  if (!requests || requests.length === 0) {
    return null;
  }

  // Get the oldest (first) pending request
  const request = requests.shift()!;
  if (requests.length === 0) {
    requestsByChat.delete(chatId);
  }

  // Remove from global map
  pendingRequests.delete(request.requestId);

  // Clear timeout and resolve
  clearTimeout(request.timeout);
  request.resolve(decision === 'allow');

  log.info(`Resolved permission ${request.requestId}: ${decision} for tool ${request.toolName}`);

  return request.requestId;
}

/**
 * Resolve a specific permission request by ID
 */
export function resolvePermissionById(requestId: string, decision: 'allow' | 'deny'): boolean {
  const request = pendingRequests.get(requestId);
  if (!request) {
    log.warn(`Permission request not found: ${requestId}`);
    return false;
  }

  // Remove from chat's list
  const chatRequests = requestsByChat.get(request.chatId);
  if (chatRequests) {
    const index = chatRequests.findIndex(r => r.requestId === requestId);
    if (index !== -1) {
      chatRequests.splice(index, 1);
    }
    if (chatRequests.length === 0) {
      requestsByChat.delete(request.chatId);
    }
  }

  // Remove from global map
  pendingRequests.delete(requestId);

  // Clear timeout and resolve
  clearTimeout(request.timeout);
  request.resolve(decision === 'allow');

  log.info(`Resolved permission ${requestId}: ${decision} for tool ${request.toolName}`);

  return true;
}

/**
 * Handle incoming HTTP requests from Claude CLI
 */
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '', `http://${req.headers.host}`);

  log.debug(`Permission request: ${req.method} ${url.pathname}`);

  if (url.pathname === '/permission' && req.method === 'POST') {
    handlePermissionRequest(req, res);
  } else if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: serverPort }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}

/**
 * Handle a permission request from Claude CLI
 */
function handlePermissionRequest(req: IncomingMessage, res: ServerResponse): void {
  let body = '';

  req.on('data', (chunk) => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const data = JSON.parse(body) as Record<string, unknown>;
      const requestId = String(data.requestId ?? '');
      const toolName = String(data.toolName ?? '');
      const toolInput = data.toolInput;
      const chatId = resolvePermissionChatId(data);

      if (!requestId || !toolName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields' }));
        return;
      }

      if (!chatId) {
        log.warn(`Permission request ${requestId} missing chatId`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing chatId' }));
        return;
      }

      if (process.env.CC_SKIP_PERMISSIONS === 'true') {
        log.info(`Skip permissions enabled, auto-allowing ${toolName}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ allowed: true }));
        return;
      }

      if (pendingRequests.has(requestId)) {
        log.warn(`Duplicate permission request: ${requestId}`);
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Duplicate request' }));
        return;
      }

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'pending' }));

      // Create permission request
      const permissionRequest: PermissionRequest = {
        requestId,
        chatId,
        toolName,
        toolInput: formatToolInput(toolInput),
        timestamp: Date.now(),
        resolve: null as unknown as (allowed: boolean) => void, // Will set below
        timeout: null as unknown as NodeJS.Timeout,
      };

      // Create promise for waiting for user response
      const permissionPromise = new Promise<boolean>((resolve) => {
        permissionRequest.resolve = resolve;
      });

      // Set timeout
      permissionRequest.timeout = setTimeout(() => {
        log.info(`Permission request ${requestId} timed out`);
        resolvePermissionById(requestId, 'deny');
      }, PERMISSION_TIMEOUT_MS);

      // Store request
      pendingRequests.set(requestId, permissionRequest);

      // Add to chat's list
      let chatRequests = requestsByChat.get(chatId);
      if (!chatRequests) {
        chatRequests = [];
        requestsByChat.set(chatId, chatRequests);
      }
      chatRequests.push(permissionRequest);

      // Send permission prompt to user
      await sendPermissionPrompt(permissionRequest);

      // Wait for user response
      const allowed = await permissionPromise;

      log.info(`Permission ${requestId} for ${toolName}: ${allowed ? 'ALLOWED' : 'DENIED'}`);

    } catch (err) {
      log.error('Error handling permission request:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });
}

/**
 * Send permission prompt to the user
 */
async function sendPermissionPrompt(request: PermissionRequest): Promise<void> {
  const platform = getPlatformByChatId(request.chatId);
  const messageSender = platform ? messageSenders.get(platform) : null;

  if (!messageSender) {
    log.warn(`No message sender registered for chat ${request.chatId}, platform=${platform ?? 'unknown'}`);
    return;
  }

  // Try to use interactive button card if available (Feishu)
  if (messageSender.sendPermissionCard) {
    try {
      await messageSender.sendPermissionCard(request.chatId, request.requestId, request.toolName, request.toolInput);
      return;
    } catch (err) {
      log.debug('Failed to send permission card, falling back to text:', err);
    }
  }

  // Fallback to text-based prompt
  const prompt = `🔐 **权限请求**

工具: \`${request.toolName}\`

参数:
\`\`\`
${request.toolInput}
\`\`\`

回复 \`/allow\` 允许，\`/deny\` 拒绝

请求 ID: ${request.requestId}`;

  try {
    await messageSender.sendTextReply(request.chatId, prompt);
  } catch (err) {
    log.error('Failed to send permission prompt:', err);
  }
}

/**
 * Format tool input for display
 */
function formatToolInput(toolInput: unknown): string {
  if (typeof toolInput === 'string') {
    return toolInput;
  }
  if (typeof toolInput === 'object' && toolInput !== null) {
    try {
      const str = JSON.stringify(toolInput, null, 2);
      return str.length > 500 ? str.slice(0, 500) + '...' : str;
    } catch {
      return String(toolInput);
    }
  }
  return String(toolInput);
}

/**
 * Clean up expired permission requests
 */
function cleanupExpiredPermissions(): void {
  const now = Date.now();
  for (const [requestId, request] of pendingRequests.entries()) {
    if (now - request.timestamp > PERMISSION_TIMEOUT_MS) {
      log.info(`Cleaning up expired permission: ${requestId}`);
      resolvePermissionById(requestId, 'deny');
    }
  }
}
