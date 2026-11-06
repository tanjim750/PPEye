import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

// Expo Go lacks remote push native modules in SDK 52+; avoid requiring it there
const isExpoGo =
  Constants?.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Constants as any)?.appOwnership === 'expo';

let Notifications: any = null;
if (!isExpoGo) {
  try {
    Notifications = require('expo-notifications');
  } catch {}
}

let foregroundPushDeduplicator: ((notification: any) => boolean) | null = null;

export function registerForegroundPushDeduplicator(
  fn: ((notification: any) => boolean) | null
): void {
  foregroundPushDeduplicator = fn;
}

export function initNativeNotifications(): void {
  try {
    if (Notifications?.setNotificationHandler) {
      Notifications.setNotificationHandler({
        handleNotification: async (notification: any) => {
          const triggerType = notification?.request?.trigger?.type;
          const isDuplicateRemotePush =
            triggerType === 'push' &&
            typeof foregroundPushDeduplicator === 'function' &&
            foregroundPushDeduplicator(notification);

          if (isDuplicateRemotePush) {
            return {
              shouldShowAlert: false,
              shouldShowBanner: false,
              shouldShowList: false,
              shouldPlaySound: false,
              shouldSetBadge: false,
            };
          }

          return {
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
            priority: Notifications.AndroidNotificationPriority?.MAX ?? 'max',
          };
        },
      });
    }
    // Eagerly initialize Android MAX priority channels on startup (Android 8.0+)
    void setupAndroidChannel('default').catch(() => {});
  } catch {}
}

export async function setupAndroidChannel(channelId = 'default'): Promise<void> {
  try {
    if (Platform.OS === 'android' && Notifications?.setNotificationChannelAsync) {
      const channelConfig = {
        name: 'PPEye Safety Alerts',
        importance: Notifications.AndroidImportance?.MAX ?? 5,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1E40AF',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PUBLIC ?? 1,
        bypassDnd: false,
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      };

      await Notifications.setNotificationChannelAsync('default', channelConfig);

      if (channelId && channelId !== 'default') {
        await Notifications.setNotificationChannelAsync(channelId, channelConfig);
      } else {
        await Notifications.setNotificationChannelAsync('ppeye_alerts', channelConfig);
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
  channelId = 'default',
  data?: Record<string, any>
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
          data: data ?? {},
          sound: 'default',
          channelId,
          priority: Notifications.AndroidNotificationPriority?.MAX ?? 'max',
          vibrate: [0, 250, 250, 250],
        },
        trigger: null,
      });
    }
  } catch (err) {
    console.warn('[native-notifications] Failed to schedule notification:', err);
  }
}
