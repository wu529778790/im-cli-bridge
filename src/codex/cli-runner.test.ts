import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCodexArgs, extractPromptImagePaths } from './cli-runner.js';

const tempDirs: string[] = [];

function createTempImage(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'open-im-codex-test-'));
  tempDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return path;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('extractPromptImagePaths', () => {
  it('extracts a single saved image path from a media prompt', () => {
    const imagePath = createTempImage('single.png');
    const prompt = [
      'The user sent a DingTalk image message.',
      `Saved local file path: ${imagePath}`,
      'Use the Read tool to inspect the saved file and describe the relevant visual contents before answering.',
    ].join('\n\n');

    expect(extractPromptImagePaths(prompt)).toEqual([imagePath]);
  });

  it('extracts image items from batch media prompts and ignores non-images', () => {
    const imagePath = createTempImage('batch.png');
    const prompt = [
      'Saved local file paths:',
      `1. photo: ${imagePath} (image)`,
      '2. notes.txt (file)',
    ].join('\n');

    expect(extractPromptImagePaths(prompt)).toEqual([imagePath]);
  });
});

describe('buildCodexArgs', () => {
  it('adds image attachments for new sessions', () => {
    const imagePath = createTempImage('new-session.png');
    const args = buildCodexArgs(
      `Saved local file path: ${imagePath}`,
      undefined,
      'D:\\coding\\open-im',
      {},
    );

    expect(args).toContain('--image');
    expect(args).toContain(imagePath);
  });

  it('adds image attachments for resumed sessions', () => {
    const imagePath = createTempImage('resume-session.png');
    const args = buildCodexArgs(
      `Saved local file path: ${imagePath}`,
      'session-123',
      'D:\\coding\\open-im',
      {},
    );

    expect(args.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(args).toContain('--image');
    expect(args).toContain(imagePath);
  });
});
