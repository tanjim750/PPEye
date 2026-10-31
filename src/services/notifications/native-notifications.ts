/**
 * Base / test fallback for native notification helpers.
 */

export function initNativeNotifications(): void {
  // No-op in test/fallback
}

export async function setupAndroidChannel(_channelId: string): Promise<void> {
  // No-op in test/fallback
}

export async function requestNativeNotificationPermission(): Promise<boolean> {
  return true;
}

export async function scheduleNativeNotification(
  _title: string,
  _body: string,
  _channelId: string
): Promise<void> {
  // No-op in test/fallback
}
