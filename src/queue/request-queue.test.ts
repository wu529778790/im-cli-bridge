import { describe, it, expect, vi } from 'vitest';
import { RequestQueue } from './request-queue.js';

describe('RequestQueue', () => {
  it('returns "running" for first task and executes it', async () => {
    const queue = new RequestQueue();
    const execute = vi.fn().mockResolvedValue(undefined);

    const result = queue.enqueue('user1', 'conv1', 'hello', execute);

    expect(result).toBe('running');
    // Allow microtask queue to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(execute).toHaveBeenCalledWith('hello');
  });

  it('returns "queued" when a task is already running', () => {
    const queue = new RequestQueue();
    const execute = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves

    queue.enqueue('user1', 'conv1', 'first', execute);
    const result = queue.enqueue('user1', 'conv1', 'second', execute);

    expect(result).toBe('queued');
  });

  it('returns "rejected" when queue is full (3 queued + 1 running)', () => {
    const queue = new RequestQueue();
    const execute = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves

    queue.enqueue('user1', 'conv1', 'first', execute);   // running
    queue.enqueue('user1', 'conv1', 'second', execute);  // queued [1]
    queue.enqueue('user1', 'conv1', 'third', execute);   // queued [2]
    queue.enqueue('user1', 'conv1', 'fourth', execute);  // queued [3]
    const result = queue.enqueue('user1', 'conv1', 'fifth', execute); // rejected

    expect(result).toBe('rejected');
  });

  it('processes queued tasks after running task completes', async () => {
    const queue = new RequestQueue();
    let resolveFirst: () => void;
    const firstPromise = new Promise<void>((r) => { resolveFirst = r; });
    const execute = vi.fn()
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(undefined);

    queue.enqueue('user1', 'conv1', 'first', execute);
    queue.enqueue('user1', 'conv1', 'second', execute);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('first');

    resolveFirst!();
    await new Promise((r) => setTimeout(r, 20));

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledWith('second');
  });

  it('isolates queues per user:convId', () => {
    const queue = new RequestQueue();
    const execute = vi.fn().mockReturnValue(new Promise(() => {}));

    const r1 = queue.enqueue('user1', 'conv1', 'hello', execute);
    const r2 = queue.enqueue('user2', 'conv1', 'hello', execute);

    expect(r1).toBe('running');
    expect(r2).toBe('running');
  });

  it('clear removes queued tasks but not the running one', () => {
    const queue = new RequestQueue();
    const execute = vi.fn().mockReturnValue(new Promise(() => {}));

    queue.enqueue('user1', 'conv1', 'first', execute);
    queue.enqueue('user1', 'conv1', 'second', execute);
    queue.enqueue('user1', 'conv1', 'third', execute);

    const cleared = queue.clear('user1', 'conv1');
    expect(cleared).toBe(2); // two queued, one running

    // Can enqueue again — only 0 queued now
    const result = queue.enqueue('user1', 'conv1', 'fourth', execute);
    expect(result).toBe('queued');
  });

  it('clear returns 0 for unknown user:convId', () => {
    const queue = new RequestQueue();
    expect(queue.clear('nobody', 'noconv')).toBe(0);
  });

  it('times out long-running tasks after 10 minutes', async () => {
    vi.useFakeTimers();
    const queue = new RequestQueue();
    const execute = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves

    queue.enqueue('user1', 'conv1', 'hello', execute);
    expect(execute).toHaveBeenCalledTimes(1);

    // Advance past 10-minute timeout
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    // Let microtasks settle
    await vi.advanceTimersByTimeAsync(100);

    // The timed-out task should be done, queue should be cleared
    expect(execute).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('handles task execution error gracefully and processes next', async () => {
    const queue = new RequestQueue();
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    queue.enqueue('user1', 'conv1', 'first', execute);
    queue.enqueue('user1', 'conv1', 'second', execute);

    await new Promise((r) => setTimeout(r, 20));

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledWith('first');
    expect(execute).toHaveBeenCalledWith('second');
  });
});
