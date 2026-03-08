/**
 * 首次运行时的交互式配置引导
 * 使用 prompts 库，兼容 tsx watch、IDE 终端等环境
 */

import prompts from 'prompts';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { APP_HOME } from './constants.js';

function printManualInstructions(configPath: string): void {
  console.log('\n━━━ open-im 首次配置 ━━━\n');
  console.log('当前环境不支持交互输入，请手动创建配置文件：');
  console.log('');
  console.log('  1. 创建目录:', dirname(configPath));
  console.log('  2. 创建文件:', configPath);
  console.log('  3. 填入以下内容（替换为你的 Token 和用户 ID）：');
  console.log('');
  console.log(`{
  "telegramBotToken": "你的Bot Token",
  "allowedUserIds": ["你的Telegram用户ID"],
  "claudeWorkDir": "${process.cwd().replace(/\\/g, '/')}",
  "claudeSkipPermissions": true,
  "aiCommand": "claude"
}`);
  console.log('');
  console.log('或设置环境变量: TELEGRAM_BOT_TOKEN=xxx 后再运行');
  console.log('');
}

export async function runInteractiveSetup(): Promise<boolean> {
  const configPath = join(APP_HOME, 'config.json');
  const forceManual = process.argv.includes('--manual') || process.argv.includes('-m');

  if (forceManual || !process.stdin.isTTY) {
    printManualInstructions(configPath);
    return false;
  }

  console.log('\n━━━ open-im 首次配置 ━━━\n');
  console.log('配置将保存到:', configPath);
  console.log('');

  const onCancel = () => {
    console.log('\n已取消配置。');
    process.exit(0);
  };

  const response = await prompts(
    [
      {
        type: 'text',
        name: 'telegramBotToken',
        message: 'Telegram Bot Token（必填，从 @BotFather 获取）',
        validate: (v: string) => (v.trim() ? true : 'Token 不能为空'),
      },
      {
        type: 'text',
        name: 'allowedUserIds',
        message: '白名单用户 ID（可选，逗号分隔，留空=所有人可访问）',
        initial: '',
      },
      {
        type: 'select',
        name: 'aiCommand',
        message: 'AI 工具（↑↓ 选择）',
        choices: [
          { title: 'claude-code', value: 'claude' },
          { title: 'codex', value: 'codex' },
          { title: 'cursor', value: 'cursor' },
        ],
        initial: 0,
      },
      {
        type: 'text',
        name: 'workDir',
        message: '工作目录',
        initial: process.cwd(),
      },
    ],
    { onCancel }
  );

  if (!response.telegramBotToken) {
    console.log('\n未输入 Token，取消配置。');
    return false;
  }

  const config = {
    telegramBotToken: response.telegramBotToken.trim(),
    allowedUserIds: response.allowedUserIds
      ? response.allowedUserIds
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [],
    claudeWorkDir: (response.workDir || process.cwd()).trim(),
    claudeSkipPermissions: true,
    aiCommand: response.aiCommand ?? 'claude',
  };

  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  console.log('\n✅ 配置已保存到', configPath);
  console.log('');
  return true;
}
