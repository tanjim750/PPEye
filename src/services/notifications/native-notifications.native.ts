import { Platform } from 'react-native';

let Notifications: any = null;
try {
  Notifications = require('expo-notifications');
} catch {}

export function initNativeNotifications(): void {
  try {
    if (Notifications?.setNotificationHandler) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          priority: Notifications.AndroidNotificationPriority?.MAX ?? 'max',
        }),
      });
    }
    // Eagerly initialize Android MAX priority channels on startup (Android 8.0+)
    void setupAndroidChannel('ppeye_alerts');
  } catch {}
}

export async function setupAndroidChannel(channelId: string): Promise<void> {
  try {
    if (Platform.OS === 'android' && Notifications?.setNotificationChannelAsync) {
      const channelConfig = {
        name: 'PPEye Alerts',
        importance: Notifications.AndroidImportance?.MAX ?? 5,
        vibrationPattern: [0, 250, 150, 250],
        lightColor: '#208AEF',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PUBLIC ?? 1,
      };

      // Set up primary alert channel (Android 8.0+)
      await Notifications.setNotificationChannelAsync(channelId, channelConfig);

      // Also set up default fallback channel
      if (channelId !== 'default') {
        await Notifications.setNotificationChannelAsync('default', {
          ...channelConfig,
          name: 'Default',
        });
      }
    }
  } catch {}
}

export async function requestNativeNotificationPermission(): Promise<boolean> {
  try {
    if (Notifications?.getPermissionsAsync && Notifications?.requestPermissionsAsync) {
      const existing = await Notifications.getPermissionsAsync();
      let status = existing?.status;
      if (status !== 'granted') {
        const res = await Notifications.requestPermissionsAsync();
        status = res?.status;
      }
      return status === 'granted';
    }
  } catch {}
  return true;
}

export async function scheduleNativeNotification(
  title: string,
  body: string,
  channelId: string
): Promise<void> {
  try {
    if (Notifications?.scheduleNotificationAsync) {
      if (Platform.OS === 'android') {
        await setupAndroidChannel(channelId);
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: 'default',
          channelId,
          priority: Notifications.AndroidNotificationPriority?.MAX ?? 'max',
          vibrate: [0, 250, 150, 250],
        },
        trigger: null,
      });
    }
  } catch (err) {
    console.warn('[native-notifications] Failed to schedule notification:', err);
  }
}
