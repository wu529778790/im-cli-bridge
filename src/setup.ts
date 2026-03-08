/**
 * 首次运行时的交互式配置引导
 */

import * as readline from 'node:readline';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { APP_HOME } from './constants.js';

function createReadline() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function question(rl: readline.Interface, prompt: string, defaultValue = ''): Promise<string> {
  const fullPrompt = defaultValue ? `${prompt} [${defaultValue}]: ` : `${prompt}: `;
  return new Promise((resolve) => {
    rl.question(fullPrompt, (answer) => resolve((answer.trim() || defaultValue).trim()));
  });
}

export async function runInteractiveSetup(): Promise<boolean> {
  const configPath = join(APP_HOME, 'config.json');

  console.log('\n━━━ open-im 首次配置 ━━━\n');
  console.log('请依次输入以下配置，完成后将保存到:', configPath);
  console.log('');

  const rl = createReadline();

  try {
    const token = await question(
      rl,
      '1. Telegram Bot Token（必填，从 @BotFather 获取）'
    );
    if (!token) {
      console.log('\n未输入 Token，取消配置。');
      return false;
    }

    const allowedIds = await question(
      rl,
      '2. 白名单用户 ID（可选，逗号分隔，留空=所有人可访问）'
    );

    const workDir = await question(
      rl,
      '3. 工作目录（可选，留空为当前目录）',
      process.cwd()
    );

    const config = {
      telegramBotToken: token,
      allowedUserIds: allowedIds ? allowedIds.split(',').map((s) => s.trim()).filter(Boolean) : [],
      claudeWorkDir: workDir || process.cwd(),
      claudeSkipPermissions: true,
      aiCommand: 'claude',
    };

    const dir = dirname(configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    console.log('\n✅ 配置已保存到', configPath);
    console.log('');
    return true;
  } finally {
    rl.close();
  }
}
