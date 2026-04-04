import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger before importing the adapter under test
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the Claude Agent SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  unstable_v2_createSession: vi.fn(),
  unstable_v2_resumeSession: vi.fn(),
}));

// Import after mocks are set up
import { ClaudeSDKAdapter } from './claude-sdk-adapter.js';

describe('ClaudeSDKAdapter', () => {
  let adapter: ClaudeSDKAdapter;

  beforeEach(() => {
    adapter = new ClaudeSDKAdapter();
  });

  afterEach(() => {
    // Clean up any active sessions/timers created during tests
    ClaudeSDKAdapter.destroy();
  });

  it('implements the ToolAdapter interface', () => {
    expect(adapter).toBeDefined();
    expect(typeof adapter.toolId).toBe('string');
    expect(typeof adapter.run).toBe('function');
  });

  it('has toolId set to claude-sdk', () => {
    expect(adapter.toolId).toBe('claude-sdk');
  });

  it('has a run method that returns a RunHandle', () => {
    const callbacks = {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const handle = adapter.run('test prompt', undefined, '/tmp', callbacks);

    expect(handle).toBeDefined();
    expect(typeof handle.abort).toBe('function');

    // Abort to clean up the background promise
    handle.abort();
  });

  it('stop() (static destroy) does not throw', () => {
    expect(() => ClaudeSDKAdapter.destroy()).not.toThrow();
  });
});
