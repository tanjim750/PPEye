/**
 * Web implementation of native notification helpers.
 * In browsers, web notifications are handled via window.Notification API.
 * expo-notifications is completely omitted from the web bundle.
 */

export function initNativeNotifications(): void {
  // No-op on web
}

export async function setupAndroidChannel(_channelId: string): Promise<void> {
  // No-op on web
}

export async function requestNativeNotificationPermission(): Promise<boolean> {
  // On web, browser Notification API handles permissions
  return false;
}

export async function scheduleNativeNotification(
  _title: string,
  _body: string,
  _channelId: string
): Promise<void> {
  // No-op on web (browser Notification API is used in notification.service.ts)
}
