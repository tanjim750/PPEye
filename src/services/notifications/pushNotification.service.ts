import { authStore, hydrateAuthStore, subscribeAuthStore } from '@/stores/auth.store';
import {
  hasRecentlyHandledNotification,
  ingestRemotePushNotification,
  isReviewerUser,
  isVendorUser,
  normalizeUserId,
} from './notification.service';

export const DEFAULT_ANDROID_CHANNEL_ID = 'default';
export const LEGACY_ANDROID_CHANNEL_ID = 'ppeye_alerts';
const STORED_PUSH_TOKEN_KEY = 'ppeye:push:last_device_token_v1';

export interface PushNotificationData {
  submissionId?: number | string;
  submission_id?: number | string;
  siteName?: string;
  site_name?: string;
  verdict?: 'safe' | 'unsafe' | string;
  status?: string;
  allSafe?: boolean;
  route?: string;
  type?: string;
  recipientUserId?: number | string;
  recipient_user_id?: number | string;
  submittedBy?: number | string;
  submitted_by?: number | string;
}

export interface PushRuntimeAdapter {
  getPlatformOS: () => string;
  isPhysicalDevice: () => boolean;
  isExpoGo: () => boolean;
  getEasProjectId: () => string | undefined;
  getNotificationsModule: () => any;
  getSupabaseClient: () => any;
  storageGet: (key: string) => Promise<string | null>;
  storageSet: (key: string, value: string | null) => Promise<void>;
}

let inMemoryTokenStore: Record<string, string> = {};

const defaultAdapter: PushRuntimeAdapter = {
  getPlatformOS: () => {
    try {
      const { Platform } = require('react-native');
      return Platform?.OS || 'android';
    } catch {
      return 'web';
    }
  },
  isPhysicalDevice: () => {
    try {
      const Device = require('expo-device');
      return Boolean(Device?.isDevice);
    } catch {
      return false;
    }
  },
  isExpoGo: () => {
    try {
      const ConstantsModule = require('expo-constants');
      const Constants = ConstantsModule?.default ?? ConstantsModule;
      const ExecutionEnvironment = ConstantsModule?.ExecutionEnvironment;
      return (
        (ExecutionEnvironment &&
          Constants?.executionEnvironment === ExecutionEnvironment.StoreClient) ||
        Constants?.appOwnership === 'expo'
      );
    } catch {
      return false;
    }
  },
  getEasProjectId: () => {
    try {
      const ConstantsModule = require('expo-constants');
      const Constants = ConstantsModule?.default ?? ConstantsModule;
      return (
        Constants?.expoConfig?.extra?.eas?.projectId ??
        Constants?.easConfig?.projectId
      );
    } catch {
      return undefined;
    }
  },
  getNotificationsModule: () => {
    if (defaultAdapter.isExpoGo() || defaultAdapter.getPlatformOS() === 'web') {
      return null;
    }
    try {
      return require('expo-notifications');
    } catch {
      return null;
    }
  },
  getSupabaseClient: () => {
    try {
      const { supabase } = require('@/services/supabase/client');
      return supabase;
    } catch {
      return null;
    }
  },
  storageGet: async (key: string) => {
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      if (AsyncStorage?.getItem) {
        return await AsyncStorage.getItem(key);
      }
    } catch {}
    return inMemoryTokenStore[key] ?? null;
  },
  storageSet: async (key: string, value: string | null) => {
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      if (value === null) {
        if (AsyncStorage?.removeItem) {
          await AsyncStorage.removeItem(key);
          return;
        }
      } else if (AsyncStorage?.setItem) {
        await AsyncStorage.setItem(key, value);
        return;
      }
    } catch {}
    if (value === null) {
      delete inMemoryTokenStore[key];
    } else {
      inMemoryTokenStore[key] = value;
    }
  },
};

let runtimeAdapter: PushRuntimeAdapter = defaultAdapter;

export function setPushRuntimeAdapterForTesting(
  overrides: Partial<PushRuntimeAdapter> | null
): void {
  runtimeAdapter = overrides ? { ...defaultAdapter, ...overrides } : defaultAdapter;
}

export function isValidExpoPushToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token.trim())
  );
}

let cachedPushToken: string | null = null;
let lastRegisteredUserId: string | null = null;
let lifecycleInitialized = false;
let authUnsubscribe: (() => void) | null = null;
let tokenRotationSubscription: { remove?: () => void } | null = null;
let foregroundReceiveSubscription: { remove?: () => void } | null = null;
let responseListenerSubscription: { remove?: () => void } | null = null;

const handledNotificationResponseKeys = new Set<string>();
let pendingDeepLinkData: PushNotificationData | null = null;
let deepLinkReadyChecker: (() => boolean) | null = null;
let deepLinkNavigateFn: ((href: string) => void) | null = null;

/**
 * Configures MAX-importance Android notification channel ('default' + 'ppeye_alerts' alias)
 * so OS push notifications wake the lock screen, play default sound, and vibrate even in Doze/background.
 */
export async function configureAndroidPushChannels(): Promise<void> {
  if (runtimeAdapter.getPlatformOS() !== 'android') return;
  const Notifications = runtimeAdapter.getNotificationsModule();
  if (!Notifications?.setNotificationChannelAsync) return;

  const channelSpec = {
    name: 'PPEye Safety Alerts',
    importance: Notifications.AndroidImportance?.MAX ?? 5,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1E40AF',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PUBLIC ?? 1,
    bypassDnd: false,
    sound: 'default',
  };

  try {
    await Notifications.setNotificationChannelAsync(DEFAULT_ANDROID_CHANNEL_ID, channelSpec);
    await Notifications.setNotificationChannelAsync(LEGACY_ANDROID_CHANNEL_ID, channelSpec);
  } catch (err) {
    console.warn('[pushNotification.service] Failed to configure Android channel:', err);
  }
}

/**
 * Configures foreground notification behavior so heads-up banners appear when the app is open,
 * while suppressing duplicate remote push alerts if the Realtime WebSocket already displayed it.
 */
export function configureForegroundPushHandler(): void {
  const Notifications = runtimeAdapter.getNotificationsModule();
  if (!Notifications?.setNotificationHandler) return;

  try {
    Notifications.setNotificationHandler({
      handleNotification: async (notification: any) => {
        const triggerType = notification?.request?.trigger?.type;
        const data = notification?.request?.content?.data;
        const subId = data?.submissionId ?? data?.submission_id;

        if (triggerType === 'push' && subId && hasRecentlyHandledNotification(data?.type, subId)) {
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
  } catch (err) {
    console.warn('[pushNotification.service] Failed to set foreground notification handler:', err);
  }
}

/**
 * Requests OS notification permissions and retrieves the device's Expo Push Token.
 */
export async function registerDevicePushToken(): Promise<string | null> {
  const platform = runtimeAdapter.getPlatformOS();
  if (platform === 'web' || runtimeAdapter.isExpoGo()) {
    return null;
  }
  if (!runtimeAdapter.isPhysicalDevice()) {
    return null;
  }

  const Notifications = runtimeAdapter.getNotificationsModule();
  if (!Notifications?.getExpoPushTokenAsync) {
    return null;
  }

  await configureAndroidPushChannels();

  try {
    const existing = await Notifications.getPermissionsAsync?.();
    let finalStatus = existing?.status ?? 'granted';
    if (finalStatus !== 'granted' && Notifications.requestPermissionsAsync) {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested?.status;
    }
    if (finalStatus !== 'granted') {
      console.log('[pushNotification.service] Notification permission not granted');
      return null;
    }

    const projectId = runtimeAdapter.getEasProjectId();
    const tokenRes = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const rawToken = typeof tokenRes === 'string' ? tokenRes : tokenRes?.data;
    if (!isValidExpoPushToken(rawToken)) {
      return null;
    }

    const cleanToken = rawToken.trim();
    cachedPushToken = cleanToken;
    await runtimeAdapter.storageSet(STORED_PUSH_TOKEN_KEY, cleanToken);
    return cleanToken;
  } catch (err) {
    console.warn('[pushNotification.service] Failed to obtain Expo push token:', err);
    return null;
  }
}

/**
 * Upserts the user's active push token into `user_push_tokens` (and `users.expo_push_token`)
 * via SECURITY DEFINER RPC + direct table upsert so token registration succeeds across all auth modes.
 */
export async function syncPushTokenForUser(
  userId: number | string,
  explicitToken?: string | null
): Promise<{ success: boolean; token?: string; error?: string }> {
  const normalizedUid = normalizeUserId(userId);
  const numUid = Number(normalizedUid);
  if (!normalizedUid || !Number.isFinite(numUid) || numUid <= 0) {
    return { success: false, error: 'Invalid user ID' };
  }

  const token = isValidExpoPushToken(explicitToken)
    ? explicitToken.trim()
    : await registerDevicePushToken();
  if (!token) {
    return { success: false, error: 'Push token unavailable' };
  }

  cachedPushToken = token;
  await runtimeAdapter.storageSet(STORED_PUSH_TOKEN_KEY, token);

  const supabase = runtimeAdapter.getSupabaseClient();
  if (!supabase) {
    return { success: false, error: 'Supabase client unavailable' };
  }

  const deviceType = runtimeAdapter.getPlatformOS() === 'ios' ? 'ios' : 'android';
  const nowIso = new Date().toISOString();
  let persisted = false;
  let lastError: string | undefined;

  // 1. Atomic SECURITY DEFINER RPC (unlinks stale users on same phone + upserts user_push_tokens + users.expo_push_token)
  if (typeof supabase.rpc === 'function') {
    try {
      const { data: rpcOk, error: rpcErr } = await supabase.rpc('register_user_push_token', {
        p_user_id: numUid,
        p_push_token: token,
        p_device_type: deviceType,
      });
      if (!rpcErr && rpcOk !== false) {
        persisted = true;
      } else if (rpcErr) {
        lastError = rpcErr.message;
      }
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
  }

  // 2. Direct upsert on user_push_tokens (covers authenticated RLS sessions & explicit multi-device tracking)
  if (typeof supabase.from === 'function') {
    try {
      const { error: upsertErr } = await (supabase.from('user_push_tokens') as any).upsert(
        {
          user_id: numUid,
          push_token: token,
          device_type: deviceType,
          is_active: true,
          updated_at: nowIso,
        },
        { onConflict: 'user_id,push_token' }
      );
      if (!upsertErr) {
        persisted = true;
      } else if (!persisted) {
        lastError = upsertErr.message;
      }
    } catch (err: any) {
      if (!persisted) lastError = err?.message || String(err);
    }

    // 3. Fallback mirror to users.expo_push_token if RPC was not yet deployed
    if (!persisted) {
      try {
        const { error: userUpdateErr } = await (supabase.from('users') as any)
          .update({ expo_push_token: token, updated_at: nowIso })
          .eq('id', numUid);
        if (!userUpdateErr) {
          persisted = true;
        } else {
          lastError = userUpdateErr.message;
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
    }
  }

  if (persisted) {
    lastRegisteredUserId = String(numUid);
    return { success: true, token };
  }

  return { success: false, token, error: lastError || 'Failed to persist push token' };
}

/**
 * Unlinks / deactivates the device's push token on logout or account switch
 * so logged-out devices or subsequent users on the same phone never receive stale notifications.
 */
export async function unlinkPushTokenForUser(
  userId?: number | string | null,
  explicitToken?: string | null
): Promise<void> {
  const targetUidStr = normalizeUserId(userId ?? lastRegisteredUserId);
  const numUid = targetUidStr ? Number(targetUidStr) : null;
  const validNumUid = numUid && Number.isFinite(numUid) && numUid > 0 ? numUid : null;

  const token =
    (isValidExpoPushToken(explicitToken) ? explicitToken.trim() : null) ||
    cachedPushToken ||
    (await runtimeAdapter.storageGet(STORED_PUSH_TOKEN_KEY));

  if (lastRegisteredUserId && (!targetUidStr || lastRegisteredUserId === targetUidStr)) {
    lastRegisteredUserId = null;
  }

  if (!validNumUid && !token) return;

  const supabase = runtimeAdapter.getSupabaseClient();
  if (!supabase) return;

  const nowIso = new Date().toISOString();

  if (typeof supabase.rpc === 'function') {
    try {
      await supabase.rpc('unregister_user_push_token', {
        p_user_id: validNumUid,
        p_push_token: token ?? null,
      });
    } catch {}
  }

  if (typeof supabase.from === 'function') {
    try {
      const table = supabase.from('user_push_tokens') as any;
      if (validNumUid && token) {
        await table
          .update({ is_active: false, updated_at: nowIso })
          .eq('user_id', validNumUid)
          .eq('push_token', token);
      } else if (validNumUid) {
        await table
          .update({ is_active: false, updated_at: nowIso })
          .eq('user_id', validNumUid);
      } else if (token) {
        await table
          .update({ is_active: false, updated_at: nowIso })
          .eq('push_token', token);
      }
    } catch {}

    if (validNumUid) {
      try {
        await (supabase.from('users') as any)
          .update({ expo_push_token: null, updated_at: nowIso })
          .eq('id', validNumUid);
      } catch {}
    }
  }
}

/**
 * Resolves the in-app Expo Router path for a notification tap based on payload data and user role.
 */
export function resolvePushDeepLinkRoute(
  data: PushNotificationData | null | undefined,
  user: any = authStore.user
): string | null {
  if (!data || typeof data !== 'object') return null;

  const rawSubId = data.submissionId ?? data.submission_id;
  const subId = rawSubId !== undefined && rawSubId !== null && String(rawSubId).trim() !== ''
    ? encodeURIComponent(String(rawSubId).trim())
    : null;

  const rawType = String(data.type || '').trim().toUpperCase();
  const rawVerdict = String(data.verdict ?? data.status ?? '').trim().toLowerCase();

  const userIsReviewer = isReviewerUser(user);
  const userIsVendor = isVendorUser(user);

  // 1. Reviewer submission notifications -> /review/[submissionId]
  if (rawType === 'NEW_SUBMISSION' || rawType === 'RESUBMISSION') {
    if (user && userIsVendor && !userIsReviewer) {
      return null;
    }
    return subId ? `/review/${subId}` : '/reviews';
  }

  // 2. Vendor Unsafe verdict -> /submission-details?id=[submissionId]
  if (rawType === 'REVIEW_UNSAFE' || rawVerdict === 'unsafe' || data.route === 'ActionRequired') {
    if (user && userIsReviewer && !userIsVendor) {
      return subId ? `/review/${subId}` : '/reviews';
    }
    return subId ? `/submission-details?id=${subId}` : '/history?filter=unsafe';
  }

  // 3. Vendor Safe verdict -> /history?filter=all&submissionId=[submissionId]
  if (rawType === 'REVIEW_SAFE' || rawVerdict === 'safe' || data.allSafe === true) {
    if (user && userIsReviewer && !userIsVendor) {
      return subId ? `/review/${subId}` : '/reviews';
    }
    return subId ? `/history?filter=all&submissionId=${subId}` : '/history?filter=all';
  }

  // 4. Generic fallback when submissionId is present
  if (subId) {
    return userIsReviewer ? `/review/${subId}` : `/submission-details?id=${subId}`;
  }

  return null;
}

function getResponseDedupeKey(response: any): string | null {
  if (!response) return null;
  const reqId = response?.notification?.request?.identifier;
  const actionId = response?.actionIdentifier ?? 'default';
  if (reqId) {
    return `${reqId}:${actionId}`;
  }
  const data = response?.notification?.request?.content?.data;
  const subId = data?.submissionId ?? data?.submission_id;
  const type = data?.type ?? data?.verdict ?? '';
  if (subId || type) {
    return `fallback:${type}:${subId ?? ''}:${actionId}`;
  }
  return null;
}

export function flushPendingPushDeepLink(): boolean {
  if (!pendingDeepLinkData || !deepLinkNavigateFn) {
    return false;
  }
  if (deepLinkReadyChecker && !deepLinkReadyChecker()) {
    return false;
  }
  const activeUser = authStore.user;
  if (!activeUser?.id) {
    return false;
  }

  const targetRoute = resolvePushDeepLinkRoute(pendingDeepLinkData, activeUser);
  pendingDeepLinkData = null;

  if (!targetRoute) {
    return false;
  }

  try {
    deepLinkNavigateFn(targetRoute);
    return true;
  } catch (err) {
    console.warn('[pushNotification.service] Deep link navigation failed:', err);
    return false;
  }
}

export async function handleNotificationResponse(response: any): Promise<boolean> {
  const dedupeKey = getResponseDedupeKey(response);
  if (!dedupeKey || handledNotificationResponseKeys.has(dedupeKey)) {
    return false;
  }

  const content = response?.notification?.request?.content;
  const data = content?.data as PushNotificationData | undefined;
  if (!data || typeof data !== 'object') {
    return false;
  }

  handledNotificationResponseKeys.add(dedupeKey);
  if (handledNotificationResponseKeys.size > 100) {
    const oldest = handledNotificationResponseKeys.values().next().value;
    if (oldest) handledNotificationResponseKeys.delete(oldest);
  }

  // Clear sticky OS cold-start response so remounts do not replay it
  try {
    const Notifications = runtimeAdapter.getNotificationsModule();
    await Notifications?.clearLastNotificationResponseAsync?.();
  } catch {}

  // Ensure auth store is hydrated before checking user role on cold start
  await hydrateAuthStore().catch(() => null);

  // Mirror tapped remote push into in-app notification bell if missing
  void ingestRemotePushNotification({
    title: content?.title,
    body: content?.body,
    data: data as Record<string, any>,
    showBanner: false,
  }).catch(() => {});

  pendingDeepLinkData = data;
  return flushPendingPushDeepLink();
}

/**
 * Initializes login/logout push token synchronization, OS token rotation listener,
 * and foreground remote push synchronization.
 */
export function initializePushNotificationLifecycle(): () => void {
  if (lifecycleInitialized) {
    return teardownPushNotificationLifecycle;
  }
  lifecycleInitialized = true;

  configureForegroundPushHandler();
  void configureAndroidPushChannels();

  let previousUserId = normalizeUserId(authStore.user?.id) ?? null;

  if (previousUserId) {
    void syncPushTokenForUser(previousUserId);
  } else {
    void hydrateAuthStore().then((hydrated) => {
      const uid = normalizeUserId(hydrated?.id);
      if (uid && !lastRegisteredUserId) {
        previousUserId = uid;
        void syncPushTokenForUser(uid);
      }
    });
  }

  authUnsubscribe = subscribeAuthStore(() => {
    const nextUserId = normalizeUserId(authStore.user?.id) ?? null;
    if (nextUserId === previousUserId) return;

    const departingUserId = previousUserId;
    previousUserId = nextUserId;

    if (!nextUserId) {
      if (departingUserId) {
        void unlinkPushTokenForUser(departingUserId);
      }
      pendingDeepLinkData = null;
      return;
    }

    if (departingUserId && departingUserId !== nextUserId) {
      void unlinkPushTokenForUser(departingUserId).finally(() => {
        void syncPushTokenForUser(nextUserId);
      });
    } else {
      void syncPushTokenForUser(nextUserId);
    }

    flushPendingPushDeepLink();
  });

  const Notifications = runtimeAdapter.getNotificationsModule();
  if (Notifications) {
    try {
      if (typeof Notifications.addPushTokenListener === 'function') {
        tokenRotationSubscription = Notifications.addPushTokenListener(() => {
          const activeUid = normalizeUserId(authStore.user?.id);
          if (activeUid) {
            // Re-fetch and persist fresh ExpoPushToken after native FCM/APNs rotation
            void registerDevicePushToken().then((freshToken) => {
              if (freshToken) {
                void syncPushTokenForUser(activeUid, freshToken);
              }
            });
          }
        });
      }
    } catch {}

    try {
      if (typeof Notifications.addNotificationReceivedListener === 'function') {
        foregroundReceiveSubscription = Notifications.addNotificationReceivedListener(
          (notification: any) => {
            const content = notification?.request?.content;
            if (notification?.request?.trigger?.type === 'push' && content?.data) {
              void ingestRemotePushNotification({
                title: content.title,
                body: content.body,
                data: content.data,
                showBanner: true,
              }).catch(() => {});
            }
          }
        );
      }
    } catch {}
  }

  return teardownPushNotificationLifecycle;
}

/**
 * Binds Expo Router navigation for both background notification taps AND killed-app cold starts.
 */
export function bindPushDeepLinkNavigation(
  navigateFn: (href: string) => void,
  isReadyFn?: () => boolean
): () => void {
  deepLinkNavigateFn = navigateFn;
  deepLinkReadyChecker = isReadyFn ?? null;

  const Notifications = runtimeAdapter.getNotificationsModule();
  if (Notifications) {
    if (!responseListenerSubscription && typeof Notifications.addNotificationResponseReceivedListener === 'function') {
      try {
        responseListenerSubscription = Notifications.addNotificationResponseReceivedListener(
          (response: any) => {
            void handleNotificationResponse(response);
          }
        );
      } catch (err) {
        console.warn('[pushNotification.service] Failed to attach response listener:', err);
      }
    }

    if (typeof Notifications.getLastNotificationResponseAsync === 'function') {
      void Notifications.getLastNotificationResponseAsync()
        .then((initialResponse: any) => {
          if (initialResponse) {
            void handleNotificationResponse(initialResponse);
          }
        })
        .catch(() => {});
    }
  }

  flushPendingPushDeepLink();

  return () => {
    if (deepLinkNavigateFn === navigateFn) {
      deepLinkNavigateFn = null;
      deepLinkReadyChecker = null;
    }
  };
}

export function teardownPushNotificationLifecycle(): void {
  lifecycleInitialized = false;
  if (authUnsubscribe) {
    authUnsubscribe();
    authUnsubscribe = null;
  }
  tokenRotationSubscription?.remove?.();
  tokenRotationSubscription = null;
  foregroundReceiveSubscription?.remove?.();
  foregroundReceiveSubscription = null;
  responseListenerSubscription?.remove?.();
  responseListenerSubscription = null;
  deepLinkNavigateFn = null;
  deepLinkReadyChecker = null;
  pendingDeepLinkData = null;
  handledNotificationResponseKeys.clear();
  cachedPushToken = null;
  lastRegisteredUserId = null;
}
