import { useEffect, useRef, useState } from 'react';
import {
  registerDevicePushToken,
  syncPushTokenForUser,
} from './pushNotification.service';

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  return registerDevicePushToken();
}

export async function savePushTokenToSupabase(
  userId: number | string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  const res = await syncPushTokenForUser(userId, token);
  return { success: res.success, error: res.error };
}

/**
 * Hook for ensuring the active user's Expo Push Token is registered and persisted.
 * Root cold-start & background deep linking is managed globally in `app/_layout.tsx`
 * via `pushNotification.service.ts`.
 */
export function useExpoPushToken(userId?: number | string | null) {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const registeredUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    const normalizedId = userId !== null && userId !== undefined ? String(userId).trim() : '';

    async function initPush() {
      if (!normalizedId || registeredUserIdRef.current === normalizedId) return;

      setIsRegistering(true);
      const res = await syncPushTokenForUser(normalizedId);

      if (!isCancelled && res.token) {
        setExpoPushToken(res.token);
        if (res.success) {
          registeredUserIdRef.current = normalizedId;
        }
      }
      if (!isCancelled) {
        setIsRegistering(false);
      }
    }

    if (!normalizedId) {
      registeredUserIdRef.current = null;
      setExpoPushToken(null);
    } else {
      void initPush();
    }

    return () => {
      isCancelled = true;
    };
  }, [userId]);

  return { expoPushToken, isRegistering, registerForPushNotificationsAsync };
}
