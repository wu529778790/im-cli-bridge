import { existsSync, accessSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import type { FileConfig, FilePlatformWechat } from './types.js';

/**
 * Resolves a single credential value using the standard priority chain:
 * environment variable → platform file config → legacy file config.
 */
export function resolveCredential(
  envKey: string,
  fileValue?: string,
  legacyFileValue?: string,
): string | undefined {
  return process.env[envKey] ?? fileValue ?? legacyFileValue;
}

/**
 * Generic per-platform credential resolution.
 * Returns all resolved credentials and whether the platform should be enabled.
 */
export interface ResolvedPlatform {
  enabled: boolean;
  credentials: Record<string, string | undefined>;
}

export function resolvePlatformCredentials(
  envKeys: Record<string, string>,
  fileValues: Record<string, string | undefined>,
  legacyValues: Record<string, string | undefined>,
  requiredKeys: string[],
  enabledFlag?: boolean,
): ResolvedPlatform {
  const credentials: Record<string, string | undefined> = {};

  for (const [name, envKey] of Object.entries(envKeys)) {
    credentials[name] = resolveCredential(envKey, fileValues[name], legacyValues[name]);
  }

  const hasRequired = requiredKeys.every(
    (key) => credentials[key] !== undefined && credentials[key] !== '',
  );

  return {
    enabled: hasRequired && enabledFlag !== false,
    credentials,
  };
}

/**
 * Extract WorkBuddy credentials, with legacy platforms.wechat migration support.
 */
export function resolveWorkBuddyFileConfig(
  fileConfig: FileConfig,
): NonNullable<FileConfig['platforms']>['workbuddy'] | undefined {
  const direct = fileConfig.platforms?.workbuddy;
  if (direct) return direct;

  const legacyWechat = (fileConfig.platforms as Record<string, unknown> | undefined)?.wechat as FilePlatformWechat | undefined;
  if (legacyWechat?.workbuddyAccessToken && legacyWechat?.workbuddyRefreshToken) {
    return {
      accessToken: legacyWechat.workbuddyAccessToken,
      refreshToken: legacyWechat.workbuddyRefreshToken,
      userId: legacyWechat.userId,
      baseUrl: legacyWechat.workbuddyBaseUrl,
    };
  }
  return undefined;
}

/**
 * Check if a CLI tool is available at the given path or on PATH.
 */
export function checkCliAvailable(cliPath: string, toolName: string): void {
  if (isAbsolute(cliPath) || cliPath.includes('/') || cliPath.includes('\\')) {
    try {
      accessSync(cliPath, constants.F_OK);
    } catch {
      throw new Error(`${toolName} CLI not found at: ${cliPath}`);
    }
  } else {
    const checkCommand = process.platform === 'win32' ? 'where' : 'which';
    try {
      execFileSync(checkCommand, [cliPath], {
        stdio: 'pipe',
        windowsHide: process.platform === 'win32',
      });
    } catch {
      throw new Error(`${toolName} CLI not found on PATH: ${cliPath}`);
    }
  }
}

/**
 * Resolve Windows-specific CLI path for npm global installs.
 */
export function resolveWindowsCliPath(cliName: string, configuredPath: string): string {
  if (process.platform !== 'win32' || configuredPath !== cliName) return configuredPath;

  const npmPaths = [
    join(process.env.APPDATA || '', 'npm', `${cliName}.cmd`),
    join(process.env.LOCALAPPDATA || '', 'npm', `${cliName}.cmd`),
  ];
  for (const p of npmPaths) {
    try {
      accessSync(p, constants.F_OK);
      return p;
    } catch {
      /* try next */
    }
  }
  return configuredPath;
}
