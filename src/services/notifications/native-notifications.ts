/**
 * Base / test fallback for native notification helpers.
 */

export function registerForegroundPushDeduplicator(
  _fn: ((notification: any) => boolean) | null
): void {
  // No-op in test/fallback
}

export function initNativeNotifications(): void {
  // No-op in test/fallback
}

export async function setupAndroidChannel(_channelId?: string): Promise<void> {
  // No-op in test/fallback
}

export async function requestNativeNotificationPermission(): Promise<boolean> {
  return true;
}

export async function scheduleNativeNotification(
  _title: string,
  _body: string,
  _channelId?: string,
  _data?: Record<string, any>
): Promise<void> {
  // No-op in test/fallback
}
