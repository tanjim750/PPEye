import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { supabase } from '@/services/supabase/client';

// Remote push notifications require native modules not bundled inside Expo Go
const isExpoGo =
  Constants?.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Constants as any)?.appOwnership === 'expo';

function getNotificationsModule(): any {
  if (isExpoGo || Platform.OS === 'web') return null;
  try {
    return require('expo-notifications');
  } catch {
    return null;
  }
}

/**
 * Isolated helper to register the device for Expo Push Notifications
 * and retrieve a valid ExpoPushToken.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  const Notifications = getNotificationsModule();
  if (!Notifications || Platform.OS === 'web') {
    return null;
  }

  // 1. Android Notification Channel (Required for Android 8.0+)
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('ppeye_alerts', {
      name: 'PPEye Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 150, 250],
      lightColor: '#208AEF',
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  // 2. Request System Permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[useExpoPushToken] Notification permission not granted');
    return null;
  }

  // 3. Resolve Project ID from app.json / EAS
  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId;

  try {
    const pushTokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return pushTokenData.data;
  } catch (err) {
    console.warn('[useExpoPushToken] Error getting push token:', err);
    return null;
  }
}

/**
 * Saves or updates the Expo Push Token for a given user in Supabase.
 * Safe and non-destructive: only updates the `expo_push_token` column.
 */
export async function savePushTokenToSupabase(
  userId: number | string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const numId = Number(userId);
    if (isNaN(numId) || numId <= 0) return { success: false, error: 'Invalid user id' };

    const { error } = await (supabase.from('users') as any)
      .update({ expo_push_token: token, updated_at: new Date().toISOString() })
      .eq('id', numId);

    if (error) {
      console.warn('[useExpoPushToken] Failed to save push token to Supabase:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Completely isolated custom hook for push token management.
 * Plug-and-play: Call `useExpoPushToken(userId)` in any screen or root layout.
 */
export function useExpoPushToken(userId?: number | string | null) {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const registeredUserIdRef = useRef<number | string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function initPush() {
      if (!userId || registeredUserIdRef.current === userId) return;

      setIsRegistering(true);
      const token = await registerForPushNotificationsAsync();

      if (!isCancelled && token) {
        setExpoPushToken(token);
        const res = await savePushTokenToSupabase(userId, token);
        if (res.success) {
          registeredUserIdRef.current = userId;
        }
      }
      if (!isCancelled) {
        setIsRegistering(false);
      }
    }

    void initPush();

    return () => {
      isCancelled = true;
    };
  }, [userId]);

  return { expoPushToken, isRegistering, registerForPushNotificationsAsync };
}
