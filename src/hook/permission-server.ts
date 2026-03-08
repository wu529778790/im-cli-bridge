export function resolveLatestPermission(_chatId: string, _decision: 'allow' | 'deny'): string | null {
  return null;
}

export function getPendingCount(_chatId: string): number {
  return 0;
}

export function resolvePermissionById(_requestId: string, _decision: 'allow' | 'deny'): boolean {
  return false;
}

export function registerPermissionSender(_platform: string, _sender: unknown): void {
  /* stub */
}
