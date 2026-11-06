import { useEffect, useState } from 'react';
import { authStore, subscribeAuthStore } from '@/stores/auth.store';
import {
  initNativeNotifications,
  registerForegroundPushDeduplicator,
  requestNativeNotificationPermission,
  scheduleNativeNotification,
  setupAndroidChannel,
} from './native-notifications';

// Configure top-level notifications handler for foreground display
initNativeNotifications();

const ANDROID_CHANNEL_ID = 'default';

function getSupabaseClient() {
  try {
    const { supabase } = require('@/services/supabase/client');
    return supabase;
  } catch {
    return null;
  }
}

let inMemoryFallbackStorage: Record<string, string> = {};

async function storageGet(key: string): Promise<string | null> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    if (AsyncStorage?.getItem) {
      return await AsyncStorage.getItem(key);
    }
  } catch {}
  return inMemoryFallbackStorage[key] || null;
}

async function storageSet(key: string, value: string): Promise<void> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    if (AsyncStorage?.setItem) {
      await AsyncStorage.setItem(key, value);
      return;
    }
  } catch {}
  inMemoryFallbackStorage[key] = value;
}

function safeHaptic(type: 'success' | 'warning') {
  try {
    const { hapticSuccess, hapticWarning } = require('@/utils/haptics');
    if (type === 'warning') {
      hapticWarning();
    } else {
      hapticSuccess();
    }
  } catch {}
}

export type NotificationType =
  | 'NEW_SUBMISSION'
  | 'RESUBMISSION'
  | 'REVIEW_SAFE'
  | 'REVIEW_UNSAFE'
  | 'REVIEW_NOTES'
  | 'SYSTEM';

export type NotificationRole = 'vendor' | 'reviewer';

export interface AppNotification {
  id: string;
  recipientRole: NotificationRole;
  recipientUserId?: number | string;
  submittedBy?: number | string;
  vendorName?: string;
  vendorProfileId?: number;
  type: NotificationType;
  title: string;
  titleBn: string;
  body: string;
  bodyBn: string;
  submissionId?: number | string;
  siteName?: string;
  workerCount?: number;
  totalWorkers?: number;
  unsafeCount?: number;
  safeCount?: number;
  allSafe?: boolean;
  workerSummary?: string;
  verdict?: 'safe' | 'unsafe';
  unsafeReasons?: string[];
  read: boolean;
  createdAt: number; // timestamp
}

export interface NotificationPreferences {
  newSubmissions: boolean;
  reviewUpdates: boolean;
  accountUpdates: boolean;
  batteryOptimization: boolean;
}

const NOTIFICATION_CHANNEL_NAME = 'ppeye_realtime_notifications';
const DB_CHANGES_CHANNEL_NAME = 'ppeye_realtime_db_changes';

/**
 * Normalizes any user or entity ID (number, numeric string, UUID, or demo string ID)
 * into a canonical non-empty string for type-safe comparisons (`String(a) === String(b)`).
 */
export function normalizeUserId(val: unknown): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'number') {
    return Number.isFinite(val) && val > 0 ? String(val) : undefined;
  }
  const trimmed = String(val).trim();
  if (
    !trimmed ||
    trimmed === '0' ||
    trimmed === 'null' ||
    trimmed === 'undefined' ||
    trimmed === 'NaN'
  ) {
    return undefined;
  }
  const asNum = Number(trimmed);
  if (!Number.isNaN(asNum) && Number.isFinite(asNum)) {
    return asNum > 0 ? String(asNum) : undefined;
  }
  return trimmed;
}

function preserveIdValue(val: unknown): number | string | undefined {
  const normalized = normalizeUserId(val);
  if (!normalized) return undefined;
  const asNum = Number(normalized);
  return Number.isFinite(asNum) && String(asNum) === normalized ? asNum : normalized;
}

export function isReviewerUser(user: any): boolean {
  if (!user) return false;
  const category = String(user.category || '').trim().toUpperCase();
  const role = String(user.role || '').trim().toLowerCase();
  return (
    category === 'INTERNAL' ||
    role === 'reviewer' ||
    role === 'internal' ||
    role === 'admin'
  );
}

export function isVendorUser(user: any): boolean {
  if (!user) return false;
  const category = String(user.category || '').trim().toUpperCase();
  const role = String(user.role || '').trim().toLowerCase();
  return category === 'EXTERNAL' || role === 'vendor' || role === 'external';
}

function getActiveExternalUserId(): string | undefined {
  const u = authStore.user;
  if (!isVendorUser(u)) {
    return undefined;
  }
  return normalizeUserId(u?.id);
}

function getAuthScopeKey(): string {
  const u = authStore.user;
  const uid = normalizeUserId(u?.id);
  if (!u || !uid) {
    return 'guest';
  }
  return isReviewerUser(u) ? `internal_${uid}` : `vendor_${uid}`;
}

function getScopedStorageKeys() {
  const scope = getAuthScopeKey();
  return {
    notifsKey: `ppeye:notifications:v5:${scope}`,
    prefsKey: `ppeye:notification_preferences:v5:${scope}`,
    dismissedKey: `ppeye:notifications_dismissed_subs:v5:${scope}`,
  };
}

// In-memory preferences
let preferences: NotificationPreferences = {
  newSubmissions: true,
  reviewUpdates: true,
  accountUpdates: true,
  batteryOptimization: true,
};

// Initialize empty — only genuine submissions and reviews are displayed
let notifications: AppNotification[] = [];
const dismissedOrReadSubmissions = new Set<string>();
const liveBroadcastGraceMap = new Map<string, number>();
let isHydrated = false;
let activeBanner: AppNotification | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const recentEventSignatures = new Set<string>();
let lastAuthScopeKey = getAuthScopeKey();

function notify() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

subscribeAuthStore(() => {
  const nextScope = getAuthScopeKey();
  if (nextScope === lastAuthScopeKey) return;
  lastAuthScopeKey = nextScope;
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }
  activeBanner = null;
  notifications = [];
  dismissedOrReadSubmissions.clear();
  liveBroadcastGraceMap.clear();
  recentEventSignatures.clear();
  isHydrated = false;
  notify();
  if (nextScope !== 'guest') {
    void hydrateNotifications();
    void initializeRealtimeNotifications();
  }
});

async function persist() {
  try {
    const { notifsKey, dismissedKey } = getScopedStorageKeys();
    await Promise.all([
      storageSet(notifsKey, JSON.stringify(notifications)),
      storageSet(dismissedKey, JSON.stringify(Array.from(dismissedOrReadSubmissions))),
    ]);
  } catch (err) {
    console.warn('[notification.service] Failed to persist notifications:', err);
  }
}

export async function hydrateNotifications(): Promise<void> {
  if (isHydrated) return;
  const targetScope = getAuthScopeKey();
  const { notifsKey, prefsKey, dismissedKey } = getScopedStorageKeys();
  const expectedExtUserId = getActiveExternalUserId();
  try {
    const [rawNotifs, rawPrefs, rawDismissed] = await Promise.all([
      storageGet(notifsKey),
      storageGet(prefsKey),
      storageGet(dismissedKey),
    ]);
    if (getAuthScopeKey() !== targetScope) return;

    if (rawDismissed) {
      try {
        const parsedDismissed = JSON.parse(rawDismissed);
        if (Array.isArray(parsedDismissed)) {
          parsedDismissed.forEach((id) => dismissedOrReadSubmissions.add(String(id)));
        }
      } catch {}
    }

    if (rawPrefs) {
      try {
        const parsedPrefs = JSON.parse(rawPrefs);
        if (parsedPrefs && typeof parsedPrefs === 'object') {
          preferences = { ...preferences, ...parsedPrefs };
        }
      } catch {}
    }

    if (rawNotifs) {
      try {
        const parsed = JSON.parse(rawNotifs);
        if (Array.isArray(parsed)) {
          notifications = parsed.filter((n: AppNotification) => {
            if (n.id?.startsWith('demo-')) return false;
            if (expectedExtUserId && n.recipientRole === 'vendor' && n.type !== 'SYSTEM') {
              const ownerId = normalizeUserId(n.recipientUserId ?? n.submittedBy);
              if (ownerId) {
                return ownerId === expectedExtUserId;
              }
              const activeProfileId = normalizeUserId(authStore.user?.vendorProfileId);
              const notifProfileId = normalizeUserId(n.vendorProfileId);
              return Boolean(activeProfileId && notifProfileId && activeProfileId === notifProfileId);
            }
            return true;
          });
        }
      } catch {}
    }
  } catch {
    // Keep in-memory defaults
  } finally {
    if (getAuthScopeKey() === targetScope) {
      isHydrated = true;
      notify();
    }
  }
}

export function subscribeNotifications(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function getNotificationPreferences(): NotificationPreferences {
  return { ...preferences };
}

export async function setNotificationPreferences(
  patch: Partial<NotificationPreferences>
): Promise<void> {
  preferences = { ...preferences, ...patch };
  try {
    const { prefsKey } = getScopedStorageKeys();
    await storageSet(prefsKey, JSON.stringify(preferences));
  } catch {}
  notify();
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    await setupAndroidChannel(ANDROID_CHANNEL_ID);
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    return await requestNativeNotificationPermission();
  } catch {}
  return true;
}

export type VendorFilter = {
  userId?: number | string;
  vendorProfileId?: number;
  vendorName?: string;
};

export function getNotifications(
  role?: NotificationRole,
  vendorFilter?: VendorFilter
): AppNotification[] {
  let list = notifications;
  // STRICT role filtering: vendor sees ONLY vendor; reviewer sees ONLY reviewer
  if (role) {
    list = list.filter((n) => n.recipientRole === role);
  }

  // Strict per-user vendor isolation
  if (role === 'vendor') {
    const explicitUserId = normalizeUserId(vendorFilter?.userId);
    const filterUserId = explicitUserId || getActiveExternalUserId();
    const filterName = vendorFilter?.vendorName?.trim().toLowerCase();
    const filterProfileId = normalizeUserId(
      vendorFilter?.vendorProfileId ?? authStore.user?.vendorProfileId
    );

    list = list.filter((n) => {
      const notifUserId = normalizeUserId(n.recipientUserId ?? n.submittedBy);

      // When a vendor user ID is active/specified, enforce strict per-user ownership
      if (filterUserId) {
        if (n.type === 'SYSTEM' && !notifUserId) {
          return true;
        }
        if (notifUserId) {
          return notifUserId === filterUserId;
        }
        // Legacy fallback ONLY when notification had no submittedBy/recipientUserId recorded
        const notifProfileId = normalizeUserId(n.vendorProfileId);
        if (filterProfileId && notifProfileId) {
          return notifProfileId === filterProfileId;
        }
        return false;
      }

      if (notifUserId) {
        return true;
      }

      const notifProfileId = normalizeUserId(n.vendorProfileId);

      // If both have profile IDs, strictly match by profile ID (handles number vs string)
      if (filterProfileId && notifProfileId) {
        return notifProfileId === filterProfileId;
      }

      // If vendor names are present on both, check for match or substring
      if (filterName && n.vendorName) {
        const notifVendor = n.vendorName.trim().toLowerCase();
        if (notifVendor.includes(filterName) || filterName.includes(notifVendor)) {
          return true;
        }
      }

      // General or unscoped vendor notifications remain visible when no user filter is active
      return true;
    });
  }

  // Filter based on active preferences toggles
  const filtered = list.filter((n) => {
    if ((n.type === 'NEW_SUBMISSION' || n.type === 'RESUBMISSION') && !preferences.newSubmissions) {
      return false;
    }
    if (
      (n.type === 'REVIEW_SAFE' || n.type === 'REVIEW_UNSAFE' || n.type === 'REVIEW_NOTES') &&
      !preferences.reviewUpdates
    ) {
      return false;
    }
    if (n.type === 'SYSTEM' && !preferences.accountUpdates) {
      return false;
    }
    return true;
  });

  // Always sort descending by createdAt / timestamp (newest first)
  return filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function getUnreadCount(
  role?: NotificationRole,
  vendorFilter?: VendorFilter
): number {
  return getNotifications(role, vendorFilter).filter((n) => !n.read).length;
}

export function getActiveNotificationBanner(): AppNotification | null {
  return activeBanner;
}

export function dismissNotificationBanner(): void {
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }
  activeBanner = null;
  notify();
}

function dispatchSystemNotification(
  title: string,
  body: string,
  id: string,
  data?: Record<string, any>
) {
  try {
    // 1. Web Notification API (works foreground & background when browser tab is inactive/minimized)
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        const n = new Notification(title, {
          body,
          tag: id,
          icon: '/favicon.ico',
        });
        n.onclick = () => {
          try {
            window.focus();
          } catch {}
        };
      } else if (Notification.permission === 'default') {
        void Notification.requestPermission().then((perm) => {
          if (perm === 'granted') {
            const n = new Notification(title, { body, tag: id, icon: '/favicon.ico' });
            n.onclick = () => {
              try { window.focus(); } catch {}
            };
          }
        });
      }
    }
  } catch {}

  // 2. React Native / Mobile expo-notifications (on native devices)
  try {
    void scheduleNativeNotification(title, body, ANDROID_CHANNEL_ID, data);
  } catch {}

  // 3. Physical phone vibration feedback for mobile devices
  try {
    const { Vibration } = require('react-native');
    if (Vibration?.vibrate) {
      Vibration.vibrate([0, 250, 250, 250]);
    }
  } catch {}
}

export function hasRecentlyHandledNotification(
  type?: string,
  submissionId?: number | string
): boolean {
  const subKey = String(submissionId ?? '').trim();
  if (!subKey) return false;
  const now = Date.now();
  return notifications.some(
    (n) =>
      String(n.submissionId ?? '') === subKey &&
      (!type || n.type === type) &&
      now - (n.createdAt || 0) < 20000
  );
}

if (typeof registerForegroundPushDeduplicator === 'function') {
  registerForegroundPushDeduplicator((notification: any) => {
    const data = notification?.request?.content?.data;
    return hasRecentlyHandledNotification(data?.type, data?.submissionId ?? data?.submission_id);
  });
}

export async function addNotification(
  input: Omit<AppNotification, 'id' | 'read' | 'createdAt'> & {
    id?: string;
    createdAt?: number;
    showBanner?: boolean;
    skipSystemNotification?: boolean;
  }
): Promise<AppNotification | null> {
  await hydrateNotifications();

  const rawOwnerId = input.recipientUserId ?? input.submittedBy;
  const normalizedOwnerId = normalizeUserId(rawOwnerId);
  const storedOwnerId = preserveIdValue(rawOwnerId);

  // Strict role & per-user guard: if a logged in user exists, drop opposing role or other external user events
  if (authStore.user) {
    const isCurrentReviewer = isReviewerUser(authStore.user);
    const isCurrentVendor = isVendorUser(authStore.user);

    if (input.recipientRole === 'reviewer' && !isCurrentReviewer && isCurrentVendor) {
      console.log('[NOTIF_DEBUG] Filter check (addNotification): DROPPED reviewer notification for active vendor user', {
        submissionId: input.submissionId,
        activeUserId: authStore.user.id,
      });
      return null;
    }
    if (input.recipientRole === 'vendor' && !isCurrentVendor && isCurrentReviewer) {
      console.log('[NOTIF_DEBUG] Filter check (addNotification): DROPPED vendor notification for active reviewer user', {
        submissionId: input.submissionId,
        activeUserId: authStore.user.id,
      });
      return null;
    }
    if (isCurrentVendor && input.recipientRole === 'vendor' && input.type !== 'SYSTEM') {
      const activeVendorUid = getActiveExternalUserId();
      if (!activeVendorUid) {
        console.log('[NOTIF_DEBUG] Filter check (addNotification): DROPPED vendor notification because active vendor ID is invalid');
        return null;
      }
      if (normalizedOwnerId) {
        if (String(normalizedOwnerId) !== String(activeVendorUid)) {
          console.log('[NOTIF_DEBUG] Filter check (addNotification): DROPPED vendor notification due to submitted_by mismatch', {
            expectedUserId: activeVendorUid,
            payloadOwnerId: normalizedOwnerId,
            submissionId: input.submissionId,
          });
          return null;
        }
      } else {
        const activeProfileId = normalizeUserId(authStore.user.vendorProfileId);
        const notifProfileId = normalizeUserId(input.vendorProfileId);
        if (!activeProfileId || !notifProfileId || activeProfileId !== notifProfileId) {
          console.log('[NOTIF_DEBUG] Filter check (addNotification): DROPPED unscoped vendor notification with no matching vendorProfileId', {
            activeVendorUid,
            activeProfileId,
            notifProfileId,
            submissionId: input.submissionId,
          });
          return null;
        }
      }
    }
  }

  // Check preferences: do not add if user muted this category
  if ((input.type === 'NEW_SUBMISSION' || input.type === 'RESUBMISSION') && !preferences.newSubmissions) {
    return null;
  }
  if (
    (input.type === 'REVIEW_SAFE' || input.type === 'REVIEW_UNSAFE' || input.type === 'REVIEW_NOTES') &&
    !preferences.reviewUpdates
  ) {
    return null;
  }
  if (input.type === 'SYSTEM' && !preferences.accountUpdates) {
    return null;
  }

  // Deduplication signature
  const signature = `${input.recipientRole}:${normalizedOwnerId || ''}:${input.type}:${input.submissionId || ''}:${input.title}`;
  if (recentEventSignatures.has(signature)) {
    const existingMatch = notifications.find(
      (n) =>
        n.recipientRole === input.recipientRole &&
        String(n.submissionId || '') === String(input.submissionId || '') &&
        n.type === input.type
    );
    return existingMatch || notifications[0] || null;
  }
  recentEventSignatures.add(signature);
  const dedupeTimer = setTimeout(() => recentEventSignatures.delete(signature), 12000);
  (dedupeTimer as any)?.unref?.();

  const newNotif: AppNotification = {
    id: input.id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    recipientRole: input.recipientRole,
    recipientUserId: storedOwnerId,
    submittedBy: storedOwnerId,
    vendorName: input.vendorName,
    vendorProfileId: input.vendorProfileId,
    type: input.type,
    title: input.title,
    titleBn: input.titleBn,
    body: input.body,
    bodyBn: input.bodyBn,
    submissionId: input.submissionId,
    siteName: input.siteName,
    workerCount: input.workerCount,
    totalWorkers: input.totalWorkers,
    unsafeCount: input.unsafeCount,
    safeCount: input.safeCount,
    allSafe: input.allSafe,
    workerSummary: input.workerSummary,
    verdict: input.verdict,
    unsafeReasons: input.unsafeReasons,
    read: false,
    createdAt: input.createdAt || Date.now(),
  };

  // Add to top of list
  notifications = [newNotif, ...notifications.filter((n) => n.id !== newNotif.id)].slice(0, 50);
  console.log('[NOTIF_DEBUG] State storage write:', {
    id: newNotif.id,
    recipientRole: newNotif.recipientRole,
    recipientUserId: newNotif.recipientUserId,
    type: newNotif.type,
    submissionId: newNotif.submissionId,
    totalStored: notifications.length,
  });
  void persist();

  // Trigger haptic feedback
  if (newNotif.type === 'REVIEW_UNSAFE') {
    safeHaptic('warning');
  } else {
    safeHaptic('success');
  }

  // Trigger OS-level / Background Notification
  if (!input.skipSystemNotification) {
    dispatchSystemNotification(newNotif.title, newNotif.body, newNotif.id, {
      type: newNotif.type,
      submissionId: newNotif.submissionId,
      siteName: newNotif.siteName,
      verdict: newNotif.verdict,
    });
  }

  // Show in-app banner immediately
  if (input.showBanner !== false) {
    if (bannerTimer) clearTimeout(bannerTimer);
    activeBanner = newNotif;
    bannerTimer = setTimeout(() => {
      activeBanner = null;
      notify();
    }, 5500);
    (bannerTimer as any)?.unref?.();
  }

  notify();
  return newNotif;
}

export async function ingestRemotePushNotification(payload: {
  title?: string;
  body?: string;
  data?: Record<string, any>;
  showBanner?: boolean;
}): Promise<AppNotification | null> {
  const data = payload?.data || {};
  const subId = data.submissionId ?? data.submission_id;
  const rawType = String(data.type || '').toUpperCase();
  const rawVerdict = String(data.verdict ?? data.status ?? '').toLowerCase();

  let type: NotificationType = 'SYSTEM';
  let recipientRole: NotificationRole = isReviewerUser(authStore.user) ? 'reviewer' : 'vendor';

  if (rawType === 'NEW_SUBMISSION' || rawType === 'RESUBMISSION') {
    type = rawType as NotificationType;
    recipientRole = 'reviewer';
  } else if (rawType === 'REVIEW_UNSAFE' || rawVerdict === 'unsafe') {
    type = 'REVIEW_UNSAFE';
    recipientRole = 'vendor';
  } else if (rawType === 'REVIEW_SAFE' || rawVerdict === 'safe' || data.allSafe === true) {
    type = 'REVIEW_SAFE';
    recipientRole = 'vendor';
  }

  if (subId && hasRecentlyHandledNotification(type, subId)) {
    return null;
  }

  const title =
    payload.title ||
    (type === 'NEW_SUBMISSION'
      ? 'New PPE Submission'
      : type === 'REVIEW_UNSAFE'
        ? 'Action Required: Unsafe Workers Flagged'
        : 'PPE Review Completed');
  const body = payload.body || (data.siteName ? `Update for ${data.siteName}` : 'Tap to view details.');
  const ownerId = preserveIdValue(
    data.recipientUserId ?? data.recipient_user_id ?? data.submittedBy ?? data.submitted_by ?? authStore.user?.id
  );

  return addNotification({
    recipientRole,
    recipientUserId: recipientRole === 'vendor' ? ownerId : undefined,
    submittedBy: ownerId,
    type,
    title,
    titleBn: title,
    body,
    bodyBn: body,
    submissionId: subId,
    siteName: data.siteName ?? data.site_name,
    verdict: type === 'REVIEW_UNSAFE' ? 'unsafe' : type === 'REVIEW_SAFE' ? 'safe' : undefined,
    allSafe: type === 'REVIEW_SAFE' ? true : type === 'REVIEW_UNSAFE' ? false : undefined,
    showBanner: payload.showBanner ?? false,
    skipSystemNotification: true,
  });
}

export async function markAsRead(id: string): Promise<void> {
  notifications = notifications.map((n) => {
    if (n.id === id) {
      if (n.submissionId) dismissedOrReadSubmissions.add(String(n.submissionId));
      return { ...n, read: true };
    }
    return n;
  });
  notify();
  void persist();
}

export async function markAllAsRead(
  role?: NotificationRole,
  vendorFilter?: VendorFilter
): Promise<void> {
  notifications = notifications.map((n) => {
    const roleMatches = !role || n.recipientRole === role;
    if (!roleMatches) return n;
    if (n.submissionId) {
      dismissedOrReadSubmissions.add(String(n.submissionId));
    }
    return { ...n, read: true };
  });
  notify();
  void persist();
}

export async function deleteNotification(id: string): Promise<void> {
  const target = notifications.find((n) => n.id === id);
  if (target?.submissionId) {
    dismissedOrReadSubmissions.add(String(target.submissionId));
  }
  notifications = notifications.filter((n) => n.id !== id);
  notify();
  void persist();
}

export async function clearAllNotifications(
  role?: NotificationRole,
  vendorFilter?: VendorFilter
): Promise<void> {
  notifications.forEach((n) => {
    if (!role || n.recipientRole === role) {
      if (n.submissionId) {
        dismissedOrReadSubmissions.add(String(n.submissionId));
      }
    }
  });
  if (!role) {
    notifications = [];
    liveBroadcastGraceMap.clear();
    recentEventSignatures.clear();
  } else {
    notifications = notifications.filter((n) => n.recipientRole !== role);
  }
  notify();
  void persist();
}

/**
 * Removes a pending submission notification from the Reviewer's panel and bell count
 * once it has been completed/reviewed from Recent or elsewhere.
 */
export function removeReviewedSubmissionNotification(submissionId: number | string): void {
  const strId = String(submissionId);
  liveBroadcastGraceMap.delete(strId);
  const beforeCount = notifications.length;
  notifications = notifications.filter(
    (n) => !(n.recipientRole === 'reviewer' && String(n.submissionId) === strId)
  );
  dismissedOrReadSubmissions.add(strId);
  if (notifications.length !== beforeCount) {
    if (activeBanner && String(activeBanner.submissionId) === strId) {
      activeBanner = null;
    }
    notify();
    void persist();
  }
}

/**
 * Ensures pending submissions in the database have a corresponding notification for Reviewers.
 * Runs on initial load and sync so Reviewers never miss submissions even if they were offline during submission.
 */
export function syncPendingReviewsToNotifications(
  waitingItems: {
    id: string | number;
    vendor?: string;
    location?: string;
    workers?: number;
    timestamp?: number;
  }[]
): void {
  if (authStore.user && !isReviewerUser(authStore.user)) {
    return;
  }
  const waitingIds = new Set(waitingItems.map((item) => String(item.id)));
  const now = Date.now();
  let changed = false;

  // Prune any reviewer pending notification whose submission has already been reviewed,
  // while preserving newly arrived live broadcast notifications whose DB query is still in flight.
  const beforeCount = notifications.length;
  notifications = notifications.filter((n) => {
    if (n.recipientRole === 'reviewer' && (n.type === 'NEW_SUBMISSION' || n.type === 'RESUBMISSION')) {
      if (n.submissionId) {
        const strId = String(n.submissionId);
        if (waitingIds.has(strId)) {
          liveBroadcastGraceMap.delete(strId);
          return true;
        }
        const graceUntil = liveBroadcastGraceMap.get(strId);
        if (graceUntil && now < graceUntil) {
          return true;
        }
        liveBroadcastGraceMap.delete(strId);
        dismissedOrReadSubmissions.add(strId);
        return false;
      }
    }
    return true;
  });
  if (notifications.length !== beforeCount) {
    changed = true;
  }

  for (const item of waitingItems) {
    const subId = item.id;
    if (dismissedOrReadSubmissions.has(String(subId))) {
      continue;
    }
    const exists = notifications.some(
      (n) => n.recipientRole === 'reviewer' && String(n.submissionId) === String(subId)
    );
    if (!exists) {
      const newNotif: AppNotification = {
        id: `notif_pending_${subId}`,
        recipientRole: 'reviewer',
        type: 'NEW_SUBMISSION',
        title: 'New PPE Submission',
        titleBn: 'নতুন পিপিই সাবমিশন',
        body: `${item.vendor || 'Vendor'} submitted ${item.location || 'Site'} (${item.workers || 1} workers) for review.`,
        bodyBn: `${item.vendor || 'ভেন্ডর'} ${item.location || 'সাইট'}-এর ${item.workers || 1} জন কর্মীর পিপিই নিরীক্ষার জন্য জমা দিয়েছেন।`,
        submissionId: subId,
        siteName: item.location,
        workerCount: item.workers,
        read: false,
        createdAt: item.timestamp || Date.now(),
      };
      notifications.unshift(newNotif);
      changed = true;
      if (!activeBanner) {
        activeBanner = newNotif;
        if (bannerTimer) clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => {
          activeBanner = null;
          notify();
        }, 6000);
      }
    }
  }
  if (changed) {
    notifications = notifications.slice(0, 50);
    notify();
    void persist();
  }
}

/**
 * Ensures reviewed checks in the database have a corresponding notification for Vendors.
 */
export function syncWorkerChecksToNotifications(
  checks: {
    submissionId?: number | string;
    submittedBy?: number | string;
    id: number | string;
    vendorName?: string;
    vendorProfileId?: number;
    siteName?: string;
    status: 'safe' | 'unsafe' | 'review';
    timestamp?: number;
    workerCount?: number;
    workerReviews?: { status: 'safe' | 'unsafe' | 'review' }[];
  }[]
): void {
  if (authStore.user && !isVendorUser(authStore.user)) {
    return;
  }
  const activeExtUserId = getActiveExternalUserId();
  let changed = false;
  for (const check of checks) {
    if (check.status !== 'safe' && check.status !== 'unsafe') continue;
    const normalizedCheckOwner =
      check.submittedBy !== undefined && check.submittedBy !== null
        ? normalizeUserId(check.submittedBy)
        : activeExtUserId;
    if (activeExtUserId && (!normalizedCheckOwner || normalizedCheckOwner !== activeExtUserId)) {
      continue;
    }
    const storedCheckOwner = preserveIdValue(check.submittedBy ?? activeExtUserId);
    const subId = check.submissionId || check.id;
    if (dismissedOrReadSubmissions.has(String(subId))) {
      continue;
    }
    const exists = notifications.some(
      (n) =>
        n.recipientRole === 'vendor' &&
        String(n.submissionId) === String(subId) &&
        (!normalizedCheckOwner ||
          normalizeUserId(n.recipientUserId ?? n.submittedBy) === normalizedCheckOwner) &&
        (n.type === 'REVIEW_SAFE' || n.type === 'REVIEW_UNSAFE')
    );
    if (!exists) {
      const isSafe = check.status === 'safe';
      const totalWorkers = check.workerCount || check.workerReviews?.length || 1;
      const unsafeCount = check.workerReviews?.filter((w) => w.status === 'unsafe').length || (isSafe ? 0 : 1);
      const safeCount = check.workerReviews?.filter((w) => w.status === 'safe').length || (isSafe ? totalWorkers : 0);
      const site = check.siteName || 'Site';

      const title = isSafe ? 'PPE Verified: Safe' : 'Action Required: Unsafe Workers Flagged';
      const titleBn = isSafe ? 'পিপিই যাচাই: নিরাপদ' : 'জরুরি পদক্ষেপ: অনিরাপদ কর্মী চিহ্নিত';

      const body = isSafe
        ? `${site}: All ${totalWorkers} workers approved.`
        : `${site}: ${unsafeCount} of ${totalWorkers} workers flagged for safety violations. Tap to review & resubmit.`;
      const bodyBn = isSafe
        ? `${site}: সমস্ত ${totalWorkers} জন কর্মী সফলভাবে নিরাপদ হিসেবে যাচাই করা হয়েছে।`
        : `${site}: ${totalWorkers} জনের মধ্যে ${unsafeCount} জন কর্মীতে ত্রুটি পাওয়া গেছে। বিবরণ দেখে পুনরায় জমা দিন।`;

      notifications.unshift({
        id: `notif_verdict_${subId}_${normalizedCheckOwner || 'vendor'}`,
        recipientRole: 'vendor',
        recipientUserId: storedCheckOwner,
        submittedBy: storedCheckOwner,
        vendorName: check.vendorName,
        vendorProfileId: check.vendorProfileId,
        type: isSafe ? 'REVIEW_SAFE' : 'REVIEW_UNSAFE',
        title,
        titleBn,
        body,
        bodyBn,
        submissionId: subId,
        siteName: site,
        totalWorkers,
        unsafeCount,
        safeCount,
        allSafe: isSafe,
        read: false,
        createdAt: check.timestamp || Date.now(),
      });
      changed = true;
    }
  }
  if (changed) {
    notifications = notifications.slice(0, 50);
    notify();
    void persist();
  }
}

// -------------------------------------------------------------
// Realtime Broadcasts & Supabase Channel Setup
// -------------------------------------------------------------

let notificationChannel: any = null;
let notificationChannelState: 'idle' | 'joining' | 'subscribed' | 'errored' = 'idle';
let notificationReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let dbChangesChannel: any = null;
let dbChangesChannelState: 'idle' | 'joining' | 'subscribed' | 'errored' = 'idle';

async function sendBroadcastSafely(
  supabase: any,
  preferredChannel: any,
  channelName: string,
  eventName: string,
  payload: Record<string, any>
): Promise<boolean> {
  if (!supabase || typeof supabase.channel !== 'function') {
    return false;
  }

  let channel = preferredChannel;
  if (!channel) {
    const existing = supabase
      .getChannels?.()
      ?.find((c: any) => c.topic === `realtime:${channelName}`);
    channel =
      existing ||
      supabase.channel(channelName, {
        config: { broadcast: { ack: true, self: false } },
      });
  }

  const canPush =
    typeof channel.canPush === 'function'
      ? Boolean(channel.canPush())
      : Boolean(channel.channelAdapter?.canPush?.() ?? channel.state === 'joined');

  if (canPush && typeof channel.send === 'function') {
    try {
      const status = await channel.send({
        type: 'broadcast',
        event: eventName,
        payload,
      });
      if (!status || status === 'ok') {
        return true;
      }
      console.warn(`[NOTIF_DEBUG] WebSocket broadcast '${eventName}' returned '${status}', falling back to httpSend`);
    } catch (wsErr) {
      console.warn(`[NOTIF_DEBUG] WebSocket broadcast '${eventName}' threw error, falling back to httpSend:`, wsErr);
    }
  }

  if (typeof channel.httpSend === 'function') {
    try {
      await channel.httpSend(eventName, payload);
      return true;
    } catch (httpErr) {
      console.warn(`[NOTIF_DEBUG] httpSend '${eventName}' failed on '${channelName}':`, httpErr);
    }
  }

  if (typeof channel.send === 'function') {
    try {
      await channel.send({
        type: 'broadcast',
        event: eventName,
        payload,
      });
      return true;
    } catch (fallbackErr) {
      console.warn(`[NOTIF_DEBUG] Fallback channel.send '${eventName}' failed on '${channelName}':`, fallbackErr);
    }
  }

  return false;
}

export async function handleIncomingNewSubmissionBroadcast(
  rawPayload: Record<string, any> | null | undefined
): Promise<AppNotification | null> {
  const payload = rawPayload || {};
  console.log('[NOTIF_DEBUG] Received broadcast new_submission:', payload);

  const subId = payload.submissionId ?? payload.submission_id;
  if (!subId) {
    console.log('[NOTIF_DEBUG] Filter check (new_submission): DROPPED (missing submissionId)');
    return null;
  }

  const currentUser = authStore.user;
  const senderId = normalizeUserId(payload.submitted_by ?? payload.submittedBy);
  if (currentUser && senderId && normalizeUserId(currentUser.id) === senderId) {
    console.log('[NOTIF_DEBUG] Filter check (new_submission): DROPPED (self-echo from active user)', {
      activeUserId: currentUser.id,
      senderId,
    });
    return null;
  }
  if (currentUser && !isReviewerUser(currentUser)) {
    console.log('[NOTIF_DEBUG] Filter check (new_submission): DROPPED (active user is not Reviewer/Internal)', {
      activeUserId: currentUser.id,
      role: currentUser.role,
      category: currentUser.category,
    });
    return null;
  }

  console.log('[NOTIF_DEBUG] Filter check (new_submission): ACCEPTED for Reviewer', {
    submissionId: subId,
    activeReviewerId: currentUser?.id,
  });

  const strId = String(subId);
  dismissedOrReadSubmissions.delete(strId);
  // Protect freshly received live broadcast notification from stale pre-fetch sync pruning
  liveBroadcastGraceMap.set(strId, Date.now() + 30000);

  const isResub = Boolean(payload.isResubmission);
  const workerCount = Number(payload.workerCount) || 1;
  const vendorName = payload.vendorName || 'Vendor';
  const siteName = payload.siteName || 'Site';

  const notif = await addNotification({
    recipientRole: 'reviewer',
    type: isResub ? 'RESUBMISSION' : 'NEW_SUBMISSION',
    title: isResub ? 'PPE Resubmission Received' : 'New PPE Submission',
    titleBn: isResub ? 'পিপিই পুনঃজমা পাওয়া গেছে' : 'নতুন পিপিই সাবমিশন',
    body: `${vendorName} submitted ${siteName} (${workerCount} workers) for review.`,
    bodyBn: `${vendorName} ${siteName}-এর ${workerCount} জন কর্মীর পিপিই নিরীক্ষার জন্য জমা দিয়েছেন।`,
    submissionId: subId,
    siteName,
    workerCount,
    vendorName,
    vendorProfileId: payload.vendorProfileId,
  });

  // Immediately force-sync Reviewer queue so Recent/Pending list updates with zero cooldown delay
  try {
    const { syncReviewsFromSupabase } = require('@/features/reviews/services/reviews.service');
    if (typeof syncReviewsFromSupabase === 'function') {
      void syncReviewsFromSupabase({ force: true });
    }
  } catch {}

  return notif;
}

export async function handleIncomingReviewVerdictBroadcast(
  rawPayload: Record<string, any> | null | undefined
): Promise<AppNotification | null> {
  const payload = rawPayload || {};
  console.log('[NOTIF_DEBUG] Received broadcast review_verdict:', payload);

  const subId = payload.submissionId ?? payload.submission_id;
  if (subId) {
    removeReviewedSubmissionNotification(subId);
  }

  const currentUser = authStore.user;
  if (currentUser && isReviewerUser(currentUser) && !isVendorUser(currentUser)) {
    console.log('[NOTIF_DEBUG] Filter check (review_verdict): DROPPED (active user is Reviewer; cleared pending item only)', {
      submissionId: subId,
      activeUserId: currentUser.id,
    });
    return null;
  }

  const rawOwnerId =
    payload.submitted_by ??
    payload.submittedBy ??
    payload.recipientUserId ??
    payload.vendor_id;
  let normalizedOwnerId = normalizeUserId(rawOwnerId);

  if (!normalizedOwnerId && subId) {
    const numericSubId = Number(subId);
    if (Number.isFinite(numericSubId) && numericSubId > 0) {
      try {
        const supabase = getSupabaseClient();
        const { data: subRow } = await supabase
          ?.from('ppe_submissions')
          .select('submitted_by, metadata')
          .eq('id', numericSubId)
          .maybeSingle();
        normalizedOwnerId = normalizeUserId(
          subRow?.submitted_by ?? (subRow?.metadata as any)?.submittedBy
        );
      } catch {}
    }
  }

  const activeExtUserId = getActiveExternalUserId();
  if (activeExtUserId) {
    if (normalizedOwnerId) {
      if (String(activeExtUserId) !== String(normalizedOwnerId)) {
        console.log('[NOTIF_DEBUG] Filter check (review_verdict): DROPPED (String(vendor.id) !== String(payload.submitted_by))', {
          vendorId: String(activeExtUserId),
          payloadSubmittedBy: String(normalizedOwnerId),
          submissionId: subId,
        });
        return null;
      }
    } else {
      const activeProfileId = normalizeUserId(currentUser?.vendorProfileId);
      const payloadProfileId = normalizeUserId(payload.vendorProfileId);
      if (!activeProfileId || !payloadProfileId || activeProfileId !== payloadProfileId) {
        console.log('[NOTIF_DEBUG] Filter check (review_verdict): DROPPED (missing submitted_by and vendorProfileId mismatch)', {
          vendorId: activeExtUserId,
          activeProfileId,
          payloadProfileId,
          submissionId: subId,
        });
        return null;
      }
    }
  }

  console.log('[NOTIF_DEBUG] Filter check (review_verdict): ACCEPTED for Vendor', {
    vendorId: activeExtUserId,
    payloadSubmittedBy: normalizedOwnerId,
    submissionId: subId,
  });

  if (subId) {
    dismissedOrReadSubmissions.delete(String(subId));
  }

  const isSafe =
    payload.verdict === 'safe' ||
    payload.verdict === 'reviewed' ||
    (payload.hasUnsafe === undefined ? payload.verdict !== 'unsafe' : !payload.hasUnsafe);
  const siteStr = payload.siteName || 'Site';
  const totalCount = Number(payload.totalWorkers ?? payload.workerCount) || 1;
  const unsafeCount =
    payload.unsafeCount !== undefined ? Number(payload.unsafeCount) : isSafe ? 0 : 1;
  const safeCount =
    payload.safeCount !== undefined ? Number(payload.safeCount) : Math.max(0, totalCount - unsafeCount);
  const storedOwnerId = preserveIdValue(normalizedOwnerId ?? activeExtUserId);

  const notifTitle = isSafe
    ? 'PPE Verified: All Safe'
    : 'Action Required: Unsafe Workers Flagged';
  const notifTitleBn = isSafe
    ? 'পিপিই যাচাই: সকল কর্মী নিরাপদ'
    : 'জরুরি পদক্ষেপ: অনিরাপদ কর্মী চিহ্নিত';
  const notifBody = isSafe
    ? `All ${totalCount} workers approved for site ${siteStr}.`
    : `${unsafeCount} of ${totalCount} workers flagged for safety issues at ${siteStr}. Tap to fix & resubmit.`;
  const notifBodyBn = isSafe
    ? `${siteStr} সাইটের সকল ${totalCount} কর্মী সফলভাবে অনুমোদিত হয়েছে।`
    : `${siteStr}-এ ${totalCount} জনের মধ্যে ${unsafeCount} জন কর্মীর সুরক্ষা ত্রুটি চিহ্নিত হয়েছে। সংশোধন ও পুনরায় জমা দিতে ট্যাপ করুন।`;

  const notif = await addNotification({
    recipientRole: 'vendor',
    recipientUserId: storedOwnerId,
    submittedBy: storedOwnerId,
    vendorName: payload.vendorName,
    vendorProfileId: payload.vendorProfileId,
    type: isSafe ? 'REVIEW_SAFE' : 'REVIEW_UNSAFE',
    title: notifTitle,
    titleBn: notifTitleBn,
    body: notifBody,
    bodyBn: notifBodyBn,
    submissionId: subId,
    siteName: payload.siteName,
    workerCount: totalCount,
    totalWorkers: totalCount,
    unsafeCount,
    safeCount,
    allSafe: isSafe,
    workerSummary: payload.workerSummary,
    verdict: isSafe ? 'safe' : 'unsafe',
    unsafeReasons: payload.unsafeReasons,
  });

  // Immediately refresh Vendor submissions list so Home 'Recent' statuses update live
  try {
    const { syncWorkerChecksFromSupabase } = require('@/features/submissions/services/workerChecks.service');
    if (typeof syncWorkerChecksFromSupabase === 'function') {
      void syncWorkerChecksFromSupabase({ force: true });
    }
  } catch {}

  return notif;
}

export async function broadcastNewSubmissionAlert(meta: {
  submissionId: number | string;
  siteName?: string;
  workerCount?: number;
  vendorName?: string;
  vendorProfileId?: number;
  submittedBy?: number | string;
  isResubmission?: boolean;
}): Promise<void> {
  const subId = meta.submissionId;
  if (subId) {
    dismissedOrReadSubmissions.delete(String(subId));
  }

  const resolvedSubmittedBy = preserveIdValue(meta.submittedBy ?? authStore.user?.id);
  const resolvedProfileId = meta.vendorProfileId ?? authStore.user?.vendorProfileId;

  console.log('[NOTIF_DEBUG] Dispatching new_submission:', {
    submissionId: subId,
    submitted_by: resolvedSubmittedBy,
    vendorProfileId: resolvedProfileId,
    siteName: meta.siteName,
    workerCount: meta.workerCount,
    senderUserId: authStore.user?.id,
    senderRole: authStore.user?.role,
  });

  // 1. Immediately register Reviewer notification ONLY if current device has no logged-in vendor (e.g. Reviewer/test harness)
  // Vendor devices MUST NOT self-notify on their own submission.
  const isCurrentReviewer = isReviewerUser(authStore.user);

  if (isCurrentReviewer) {
    void addNotification({
      recipientRole: 'reviewer',
      type: meta.isResubmission ? 'RESUBMISSION' : 'NEW_SUBMISSION',
      title: meta.isResubmission ? 'PPE Resubmission Received' : 'New PPE Submission',
      titleBn: meta.isResubmission ? 'পিপিই পুনঃজমা পাওয়া গেছে' : 'নতুন পিপিই সাবমিশন',
      body: `${meta.vendorName || 'Vendor'} submitted ${meta.siteName || 'Site'} (${meta.workerCount || 1} workers) for review.`,
      bodyBn: `${meta.vendorName || 'ভেন্ডর'} ${meta.siteName || 'সাইট'}-এর ${meta.workerCount || 1} জন কর্মীর পিপিই নিরীক্ষার জন্য জমা দিয়েছেন।`,
      submissionId: subId,
      siteName: meta.siteName,
      workerCount: meta.workerCount,
      vendorName: meta.vendorName,
      vendorProfileId: resolvedProfileId,
    });
  }

  // 2. Realtime broadcast to remote Reviewer devices/peers across channels
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    // Ensure local broadcast channel is initialized if not yet subscribed
    if (!notificationChannel) {
      initializeRealtimeNotifications();
    }

    const payload = {
      ...meta,
      submissionId: subId,
      submission_id: subId,
      submittedBy: resolvedSubmittedBy,
      submitted_by: resolvedSubmittedBy,
      vendor_id: resolvedSubmittedBy,
      vendorProfileId: resolvedProfileId,
      timestamp: Date.now(),
    };

    const sentNotif = await sendBroadcastSafely(
      supabase,
      notificationChannel,
      NOTIFICATION_CHANNEL_NAME,
      'new_submission_notification',
      payload
    );
    const sentLiveSync = await sendBroadcastSafely(
      supabase,
      null,
      'ppe_live_sync',
      'new_submission',
      payload
    );
    console.log('[NOTIF_DEBUG] Broadcast dispatch result (new_submission):', {
      submissionId: subId,
      sentNotif,
      sentLiveSync,
    });

    // 3. Trigger Server Push Notification (via Edge Function) so background / locked reviewer devices get system tray alert
    if (supabase.functions && typeof supabase.functions.invoke === 'function') {
      void supabase.functions.invoke('send-push-notification', {
        body: {
          role: 'reviewer',
          submission_id: subId,
          title: 'New PPE Submission',
          body: `${meta.vendorName || 'Vendor'} submitted ${meta.siteName || 'Site'} (${meta.workerCount || 1} workers) for review.`,
          data: {
            type: 'NEW_SUBMISSION',
            submissionId: subId,
            siteName: meta.siteName,
            workerCount: meta.workerCount,
            submitted_by: resolvedSubmittedBy,
          },
        },
      }).catch((err: any) => {
        console.warn('[notification.service] send-push-notification invoke failed for reviewer:', err);
      });
    }
  } catch (err) {
    console.warn('[notification.service] Failed to broadcast new_submission_notification:', err);
  }
}

export async function broadcastReviewVerdictAlert(meta: {
  submissionId: number | string;
  siteName?: string;
  vendorName?: string;
  vendorProfileId?: number;
  submittedBy?: number | string;
  recipientUserId?: number | string;
  verdict: 'safe' | 'unsafe' | 'reviewed';
  hasUnsafe?: boolean;
  totalWorkers?: number;
  unsafeCount?: number;
  safeCount?: number;
  workerCount?: number;
  workerSummary?: string;
  unsafeReasons?: string[];
  notes?: string;
}): Promise<void> {
  const isSafe = meta.verdict === 'safe' || meta.verdict === 'reviewed' || !meta.hasUnsafe;
  const siteStr = meta.siteName || 'Site';
  const totalCount = meta.totalWorkers ?? meta.workerCount ?? 1;
  const unsafeCount = meta.unsafeCount ?? (isSafe ? 0 : 1);
  const safeCount = meta.safeCount ?? (totalCount - unsafeCount);

  let normalizedOwnerId = normalizeUserId(meta.recipientUserId ?? meta.submittedBy);
  let resolvedVendorProfileId = meta.vendorProfileId;

  if (!normalizedOwnerId) {
    const numericSubId = Number(meta.submissionId);
    if (Number.isFinite(numericSubId) && numericSubId > 0) {
      try {
        const supabase = getSupabaseClient();
        const { data: subRow } = await supabase
          ?.from('ppe_submissions')
          .select('submitted_by, vendor_profile_id, metadata')
          .eq('id', numericSubId)
          .maybeSingle();
        if (subRow) {
          normalizedOwnerId = normalizeUserId(
            subRow.submitted_by ?? (subRow.metadata as any)?.submittedBy
          );
          if (!resolvedVendorProfileId && subRow.vendor_profile_id) {
            resolvedVendorProfileId = Number(subRow.vendor_profile_id);
          }
        }
      } catch {}
    }
  }

  const ownerUserId = preserveIdValue(normalizedOwnerId);

  console.log('[NOTIF_DEBUG] Dispatching review_verdict:', {
    submissionId: meta.submissionId,
    submitted_by: ownerUserId,
    vendor_id: ownerUserId,
    vendorProfileId: resolvedVendorProfileId,
    verdict: isSafe ? 'safe' : 'unsafe',
    unsafeCount,
    totalWorkers: totalCount,
    senderUserId: authStore.user?.id,
    senderRole: authStore.user?.role,
  });

  // Reviewer does NOT receive notification for their own review verdict.
  // Purge this submission from Reviewer's pending notifications immediately!
  if (meta.submissionId) {
    removeReviewedSubmissionNotification(meta.submissionId);
  }

  // Targeted Notification Title & Body (Requirement 1: Case A & Case B)
  const notifTitle = isSafe
    ? 'PPE Verified: All Safe'
    : 'Action Required: Unsafe Workers Flagged';
  const notifTitleBn = isSafe
    ? 'পিপিই যাচাই: সকল কর্মী নিরাপদ'
    : 'জরুরি পদক্ষেপ: অনিরাপদ কর্মী চিহ্নিত';

  const notifBody = isSafe
    ? `All ${totalCount} workers approved for site ${siteStr}.`
    : `${unsafeCount} of ${totalCount} workers flagged for safety issues at ${siteStr}. Tap to fix & resubmit.`;
  const notifBodyBn = isSafe
    ? `${siteStr} সাইটের সকল ${totalCount} কর্মী সফলভাবে অনুমোদিত হয়েছে।`
    : `${siteStr}-এ ${totalCount} জনের মধ্যে ${unsafeCount} জন কর্মীর সুরক্ষা ত্রুটি চিহ্নিত হয়েছে। সংশোধন ও পুনরায় জমা দিতে ট্যাপ করুন।`;

  // Only Vendor devices (or unauthenticated test harness) receive safe/unsafe verdict notification locally
  const isCurrentReviewer = isReviewerUser(authStore.user);

  if (!isCurrentReviewer) {
    void addNotification({
      recipientRole: 'vendor',
      recipientUserId: ownerUserId,
      submittedBy: ownerUserId,
      vendorName: meta.vendorName,
      vendorProfileId: resolvedVendorProfileId,
      type: isSafe ? 'REVIEW_SAFE' : 'REVIEW_UNSAFE',
      title: notifTitle,
      titleBn: notifTitleBn,
      body: notifBody,
      bodyBn: notifBodyBn,
      submissionId: meta.submissionId,
      siteName: meta.siteName,
      workerCount: totalCount,
      totalWorkers: totalCount,
      unsafeCount,
      safeCount,
      allSafe: isSafe,
      workerSummary: meta.workerSummary,
      verdict: isSafe ? 'safe' : 'unsafe',
      unsafeReasons: meta.unsafeReasons,
    });
  }

  // Realtime broadcast to remote Vendor devices/peers
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    if (!notificationChannel) {
      initializeRealtimeNotifications();
    }

    const broadcastPayload = {
      ...meta,
      submissionId: meta.submissionId,
      submission_id: meta.submissionId,
      vendorProfileId: resolvedVendorProfileId,
      submittedBy: ownerUserId,
      submitted_by: ownerUserId,
      vendor_id: ownerUserId,
      recipientUserId: ownerUserId,
      totalWorkers: totalCount,
      unsafeCount,
      safeCount,
      allSafe: isSafe,
      timestamp: Date.now(),
    };

    const sentVerdict = await sendBroadcastSafely(
      supabase,
      notificationChannel,
      NOTIFICATION_CHANNEL_NAME,
      'review_verdict_notification',
      broadcastPayload
    );
    console.log('[NOTIF_DEBUG] Broadcast dispatch result (review_verdict):', {
      submissionId: meta.submissionId,
      submitted_by: ownerUserId,
      sentVerdict,
    });

    // Server-level Push Notification via Supabase Edge Function to reach Vendor phone even if locked/closed/battery-saver
    if (supabase.functions && typeof supabase.functions.invoke === 'function') {
      void supabase.functions.invoke('send-push-notification', {
        body: {
          submission_id: meta.submissionId,
          recipient_user_id: ownerUserId,
          submitted_by: ownerUserId,
          title: notifTitle,
          body: notifBody,
          data: isSafe
            ? {
                type: 'REVIEW_SAFE',
                submissionId: meta.submissionId,
                submitted_by: ownerUserId,
                siteName: meta.siteName,
                verdict: 'safe',
                status: 'safe',
                allSafe: true,
                totalWorkers: totalCount,
              }
            : {
                type: 'REVIEW_UNSAFE',
                submissionId: meta.submissionId,
                submitted_by: ownerUserId,
                siteName: meta.siteName,
                verdict: 'unsafe',
                status: 'unsafe',
                allSafe: false,
                unsafeCount,
                totalWorkers: totalCount,
                route: 'ActionRequired',
              },
        },
      }).catch((pushErr: any) => {
        console.warn('[notification.service] send-push-notification invoke failed for vendor:', pushErr);
      });
    }
  } catch (err) {
    console.warn('[notification.service] Failed to broadcast review_verdict_notification:', err);
  }
}

function initializeDbChangesFallbackChannel(supabase: any): void {
  if (!authStore.user) return;
  if (
    dbChangesChannel &&
    (dbChangesChannelState === 'subscribed' || dbChangesChannelState === 'joining')
  ) {
    return;
  }

  try {
    const existingDb = supabase
      .getChannels?.()
      ?.find((c: any) => c.topic === `realtime:${DB_CHANGES_CHANNEL_NAME}`);
    if (existingDb) {
      if (existingDb.state === 'joined' || existingDb.state === 'joining') {
        dbChangesChannel = existingDb;
        dbChangesChannelState = existingDb.state === 'joined' ? 'subscribed' : 'joining';
        return;
      }
      try {
        void supabase.removeChannel(existingDb);
      } catch {}
      dbChangesChannel = null;
    }

    dbChangesChannelState = 'joining';
    dbChangesChannel = supabase
      .channel(DB_CHANGES_CHANNEL_NAME)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ppe_submissions' }, (payload: any) => {
        const sub = payload.new;
        if (!sub?.id) return;
        if (isReviewerUser(authStore.user)) {
          if (sub.status === 'waiting' || sub.status === 'UNDER_REVIEW') {
            void handleIncomingNewSubmissionBroadcast({
              submissionId: sub.id,
              siteName: sub.site_name,
              workerCount: Number((sub.metadata as any)?.totalWorkers || (sub.metadata as any)?.workerCount) || 1,
              vendorProfileId: sub.vendor_profile_id ? Number(sub.vendor_profile_id) : undefined,
              submitted_by: sub.submitted_by ?? (sub.metadata as any)?.submittedBy,
            });
          } else if (sub.status) {
            removeReviewedSubmissionNotification(sub.id);
          }
          return;
        }
        const activeExtUserId = getActiveExternalUserId();
        const rowOwner = normalizeUserId(sub.submitted_by ?? sub.vendor_id ?? (sub.metadata as any)?.submittedBy);
        if (activeExtUserId && rowOwner && rowOwner !== activeExtUserId) {
          return;
        }
        if (sub.status && sub.status !== 'waiting' && sub.status !== 'UNDER_REVIEW') {
          removeReviewedSubmissionNotification(sub.id);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submission_reviews' }, async (payload: any) => {
        const rev = payload.new;
        if (!rev?.submission_id) return;
        removeReviewedSubmissionNotification(rev.submission_id);
        const activeExtUserId = getActiveExternalUserId();
        if (!activeExtUserId) return;
        let ownerUserId = normalizeUserId(rev.submitted_by ?? rev.vendor_id);
        if (!ownerUserId) {
          try {
            const { data: subRow } = await supabase
              .from('ppe_submissions')
              .select('submitted_by, metadata')
              .eq('id', Number(rev.submission_id))
              .maybeSingle();
            ownerUserId = normalizeUserId(subRow?.submitted_by ?? (subRow?.metadata as any)?.submittedBy);
          } catch {}
        }
        if (!ownerUserId || ownerUserId !== activeExtUserId) return;
        const isSafe = rev.verdict === 'SAFE' || rev.verdict === 'safe' || rev.final_status === 'reviewed';
        void handleIncomingReviewVerdictBroadcast({
          submissionId: rev.submission_id,
          submitted_by: ownerUserId,
          verdict: isSafe ? 'safe' : 'unsafe',
          hasUnsafe: !isSafe,
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ppe_reviews' }, async (payload: any) => {
        const rev = payload.new;
        if (!rev?.id || !rev?.worker_instance_id) return;
        const activeExtUserId = getActiveExternalUserId();
        if (!activeExtUserId) return;
        let ownerUserId = normalizeUserId(rev.submitted_by ?? rev.vendor_id);
        let submissionId: number | undefined;
        if (!ownerUserId) {
          try {
            const { data: instRow } = await supabase
              .from('ppe_worker_instances')
              .select('submission_id, ppe_submissions ( submitted_by, metadata )')
              .eq('id', Number(rev.worker_instance_id))
              .maybeSingle();
            submissionId = instRow?.submission_id ? Number(instRow.submission_id) : undefined;
            const joinedSub = Array.isArray((instRow as any)?.ppe_submissions)
              ? (instRow as any).ppe_submissions[0]
              : (instRow as any)?.ppe_submissions;
            ownerUserId = normalizeUserId(joinedSub?.submitted_by ?? joinedSub?.metadata?.submittedBy);
          } catch {}
        }
        if (!ownerUserId || ownerUserId !== activeExtUserId) return;
        const isSafe = rev.verdict === 'SAFE';
        void addNotification({
          recipientRole: 'vendor',
          recipientUserId: preserveIdValue(ownerUserId),
          submittedBy: preserveIdValue(ownerUserId),
          submissionId,
          type: isSafe ? 'REVIEW_SAFE' : 'REVIEW_UNSAFE',
          title: isSafe ? 'Worker Verified: Safe' : 'Safety Violation: Unsafe Worker',
          titleBn: isSafe ? 'কর্মী যাচাই: নিরাপদ' : 'সুরক্ষা ত্রুটি: অনিরাপদ কর্মী',
          body: isSafe
            ? 'A worker inspection was verified and approved by EHS.'
            : 'A worker was flagged for PPE safety violations.',
          bodyBn: isSafe
            ? 'কর্মীর পিপিই নিরীক্ষা ইএইচএস কর্তৃক নিরাপদ হিসেবে অনুমোদিত হয়েছে।'
            : 'কর্মীতে পিপিই সুরক্ষা ত্রুটি চিহ্নিত করা হয়েছে।',
        });
      })
      .subscribe((status: string) => {
        console.log('[NOTIF_DEBUG] DB changes fallback channel status:', status);
        if (status === 'SUBSCRIBED') {
          dbChangesChannelState = 'subscribed';
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          dbChangesChannelState = 'errored';
          dbChangesChannel = null;
        }
      });
  } catch (err) {
    dbChangesChannelState = 'errored';
    dbChangesChannel = null;
    console.warn('[NOTIF_DEBUG] DB changes fallback channel setup failed (isolated from broadcast):', err);
  }
}

export function initializeRealtimeNotifications(): () => void {
  void hydrateNotifications();

  const supabase = getSupabaseClient();
  if (!supabase || typeof supabase.channel !== 'function') {
    return () => {};
  }

  // Ensure optional DB fallback channel is also initialized when logged in (isolated from broadcast channel)
  initializeDbChangesFallbackChannel(supabase);

  if (
    notificationChannel &&
    (notificationChannelState === 'subscribed' || notificationChannelState === 'joining') &&
    notificationChannel.state !== 'closed' &&
    notificationChannel.state !== 'errored'
  ) {
    return () => {};
  }

  try {
    const existing = supabase
      .getChannels?.()
      ?.find((c: any) => c.topic === `realtime:${NOTIFICATION_CHANNEL_NAME}`);
    if (existing) {
      if (existing.state === 'joined' || existing.state === 'joining') {
        notificationChannel = existing;
        notificationChannelState = existing.state === 'joined' ? 'subscribed' : 'joining';
        return () => {};
      }
      try {
        void supabase.removeChannel(existing);
      } catch {}
      notificationChannel = null;
    }

    notificationChannelState = 'joining';
    // Pure Broadcast channel — zero postgres_changes RLS dependencies so WebSocket join succeeds 100% of the time
    notificationChannel = supabase.channel(NOTIFICATION_CHANNEL_NAME, {
      config: { broadcast: { ack: true, self: false } },
    });

    notificationChannel
      // 1. Reviewer Notification: When Vendor submits new check
      .on('broadcast', { event: 'new_submission_notification' }, (event: any) => {
        void handleIncomingNewSubmissionBroadcast(event?.payload);
      })
      .on('broadcast', { event: 'new_submission' }, (event: any) => {
        void handleIncomingNewSubmissionBroadcast(event?.payload);
      })
      // 2. Vendor Notification: When Reviewer evaluates check
      .on('broadcast', { event: 'review_verdict_notification' }, (event: any) => {
        void handleIncomingReviewVerdictBroadcast(event?.payload);
      })
      .subscribe((status: string) => {
        console.log('[NOTIF_DEBUG] Broadcast notifications channel status:', status);
        if (status === 'SUBSCRIBED') {
          notificationChannelState = 'subscribed';
          if (notificationReconnectTimer) {
            clearTimeout(notificationReconnectTimer);
            notificationReconnectTimer = null;
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          notificationChannelState = 'errored';
          const deadChannel = notificationChannel;
          notificationChannel = null;
          if (deadChannel) {
            try {
              void supabase.removeChannel(deadChannel);
            } catch {}
          }
          if (!notificationReconnectTimer) {
            notificationReconnectTimer = setTimeout(() => {
              notificationReconnectTimer = null;
              initializeRealtimeNotifications();
            }, 2500);
            (notificationReconnectTimer as any)?.unref?.();
          }
        }
      });

    return () => {};
  } catch (err) {
    notificationChannelState = 'errored';
    notificationChannel = null;
    console.warn('[NOTIF_DEBUG] Failed to subscribe to broadcast notifications channel:', err);
    return () => {};
  }
}

// -------------------------------------------------------------
// React Hook
// -------------------------------------------------------------

export function useNotifications(
  role?: NotificationRole,
  vendorFilter?: VendorFilter
) {
  const [, setTick] = useState(0);

  useEffect(() => {
    void hydrateNotifications();
    const cleanupRealtime = initializeRealtimeNotifications();
    const unsubscribe = subscribeNotifications(() => {
      setTick((prev) => prev + 1);
    });

    return () => {
      unsubscribe();
      cleanupRealtime();
    };
  }, []);

  const notifs = getNotifications(role, vendorFilter);
  const unreadCount = getUnreadCount(role, vendorFilter);
  const banner = getActiveNotificationBanner();

  return {
    notifications: notifs,
    unreadCount,
    banner,
    preferences,
    updatePreferences: setNotificationPreferences,
    requestPermission: requestNotificationPermission,
    markAsRead,
    markAllAsRead: () => markAllAsRead(role, vendorFilter),
    deleteNotification,
    clearAll: () => clearAllNotifications(role, vendorFilter),
    dismissBanner: dismissNotificationBanner,
  };
}
