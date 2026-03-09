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
  console.log('  3. 填入以下内容（替换为你的 Token/App ID 和用户 ID）：');
  console.log('');
  console.log(`{
  "telegramBotToken": "你的Bot Token（可选）",
  "feishuAppId": "你的飞书 App ID（可选）",
  "feishuAppSecret": "你的飞书 App Secret（可选）",
  "allowedUserIds": ["你的用户ID"],
  "claudeWorkDir": "${process.cwd().replace(/\\/g, '/')}",
  "claudeSkipPermissions": true,
  "aiCommand": "claude"
}`);
  console.log('');
  console.log('提示：至少需要配置 Telegram 或 Feishu 其中一个平台');
  console.log('或设置环境变量: TELEGRAM_BOT_TOKEN=xxx 或 FEISHU_APP_ID=xxx 后再运行');
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

  // 第一步：选择平台
  const platformResp = await prompts({
    type: 'select',
    name: 'platform',
    message: '选择要配置的平台（↑↓ 选择）',
    choices: [
      { title: 'Telegram - 需要 Bot Token', value: 'telegram' },
      { title: '飞书 (Feishu/Lark) - 需要 App ID 和 App Secret', value: 'feishu' },
      { title: '两者都配置', value: 'both' },
    ],
    initial: 0,
  }, { onCancel });

  if (!platformResp.platform) {
    return false;
  }

  const platform = platformResp.platform;
  const config: Record<string, unknown> = {};

  // 收集平台配置
  if (platform === 'telegram' || platform === 'both') {
    const telegramResp = await prompts({
      type: 'text',
      name: 'token',
      message: 'Telegram Bot Token（从 @BotFather 获取）',
      validate: (v: string) => (v.trim() ? true : 'Token 不能为空'),
    }, { onCancel });

    if (telegramResp.token) {
      config.telegramBotToken = telegramResp.token.trim();
    } else if (platform === 'telegram') {
      return false;
    }
  }

  if (platform === 'feishu' || platform === 'both') {
    const feishuResp = await prompts([
      {
        type: 'text',
        name: 'appId',
        message: '飞书 App ID（从飞书开放平台获取）',
        validate: (v: string) => (v.trim() ? true : 'App ID 不能为空'),
      },
      {
        type: 'text',
        name: 'appSecret',
        message: '飞书 App Secret（从飞书开放平台获取）',
        validate: (v: string) => (v.trim() ? true : 'App Secret 不能为空'),
      },
    ], { onCancel });

    if (feishuResp.appId && feishuResp.appSecret) {
      config.feishuAppId = feishuResp.appId.trim();
      config.feishuAppSecret = feishuResp.appSecret.trim();
    } else if (platform === 'feishu') {
      return false;
    }
  }

  // 通用配置
  const commonResp = await prompts([
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
  ], { onCancel });

  // 合并配置
  config.allowedUserIds = commonResp.allowedUserIds
    ? commonResp.allowedUserIds.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];
  config.claudeWorkDir = (commonResp.workDir || process.cwd()).trim();
  config.claudeSkipPermissions = true;
  config.aiCommand = commonResp.aiCommand ?? 'claude';

  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  console.log('\n✅ 配置已保存到', configPath);
  console.log('');
  return true;
}
