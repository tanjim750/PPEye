import { useEffect, useState } from 'react';
import {
  initNativeNotifications,
  requestNativeNotificationPermission,
  scheduleNativeNotification,
  setupAndroidChannel,
} from './native-notifications';

// Configure top-level notifications handler for foreground display
initNativeNotifications();

const ANDROID_CHANNEL_ID = 'ppeye_alerts';

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

const STORAGE_KEY = 'ppeye:notifications:v4';
const PREFS_KEY = 'ppeye:notification_preferences_v4';
const DISMISSED_SUBS_KEY = 'ppeye:notifications_dismissed_subs_v4';
const NOTIFICATION_CHANNEL_NAME = 'ppeye_realtime_notifications';

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
let isHydrated = false;
let activeBanner: AppNotification | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const recentEventSignatures = new Set<string>();

function notify() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

async function persist() {
  try {
    await Promise.all([
      storageSet(STORAGE_KEY, JSON.stringify(notifications)),
      storageSet(DISMISSED_SUBS_KEY, JSON.stringify(Array.from(dismissedOrReadSubmissions))),
    ]);
  } catch (err) {
    console.warn('[notification.service] Failed to persist notifications:', err);
  }
}

export async function hydrateNotifications(): Promise<void> {
  if (isHydrated) return;
  try {
    const [rawNotifs, rawPrefs, rawDismissed] = await Promise.all([
      storageGet(STORAGE_KEY),
      storageGet(PREFS_KEY),
      storageGet(DISMISSED_SUBS_KEY),
    ]);

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
          notifications = parsed.filter((n) => !n.id?.startsWith('demo-'));
        }
      } catch {}
    }
  } catch {
    // Keep in-memory defaults
  } finally {
    isHydrated = true;
    notify();
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
    await storageSet(PREFS_KEY, JSON.stringify(preferences));
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

  // Vendor filtering: only filter if notification explicitly specifies a different vendor profile ID
  if (role === 'vendor') {
    const filterName = vendorFilter?.vendorName?.trim().toLowerCase();
    const filterProfileId =
      vendorFilter?.vendorProfileId !== undefined && vendorFilter?.vendorProfileId !== null
        ? Number(vendorFilter.vendorProfileId)
        : undefined;

    list = list.filter((n) => {
      const notifProfileId =
        n.vendorProfileId !== undefined && n.vendorProfileId !== null
          ? Number(n.vendorProfileId)
          : undefined;

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

      // General or unscoped vendor notifications remain visible to the vendor
      return true;
    });
  }

  // Filter based on active preferences toggles
  return list.filter((n) => {
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

function dispatchSystemNotification(title: string, body: string, id: string) {
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
    void scheduleNativeNotification(title, body, ANDROID_CHANNEL_ID);
  } catch {}

  // 3. Physical phone vibration feedback for mobile devices
  try {
    const { Vibration } = require('react-native');
    if (Vibration?.vibrate) {
      Vibration.vibrate([0, 250, 150, 250]);
    }
  } catch {}
}

export async function addNotification(
  input: Omit<AppNotification, 'id' | 'read' | 'createdAt'> & {
    id?: string;
    createdAt?: number;
    showBanner?: boolean;
  }
): Promise<AppNotification | null> {
  await hydrateNotifications();

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
  const signature = `${input.recipientRole}:${input.type}:${input.submissionId || ''}:${input.title}`;
  if (recentEventSignatures.has(signature)) {
    return notifications[0] || null;
  }
  recentEventSignatures.add(signature);
  setTimeout(() => recentEventSignatures.delete(signature), 12000);

  const newNotif: AppNotification = {
    id: input.id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    recipientRole: input.recipientRole,
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
    read: false,
    createdAt: input.createdAt || Date.now(),
  };

  // Add to top of list
  notifications = [newNotif, ...notifications.filter((n) => n.id !== newNotif.id)].slice(0, 50);
  void persist();

  // Trigger haptic feedback
  if (newNotif.type === 'REVIEW_UNSAFE') {
    safeHaptic('warning');
  } else {
    safeHaptic('success');
  }

  // Trigger OS-level / Background Notification
  dispatchSystemNotification(newNotif.title, newNotif.body, newNotif.id);

  // Show in-app banner immediately
  if (input.showBanner !== false) {
    if (bannerTimer) clearTimeout(bannerTimer);
    activeBanner = newNotif;
    bannerTimer = setTimeout(() => {
      activeBanner = null;
      notify();
    }, 5500);
  }

  notify();
  return newNotif;
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
  const waitingIds = new Set(waitingItems.map((item) => String(item.id)));
  let changed = false;

  // Prune any reviewer pending notification whose submission has already been reviewed
  const beforeCount = notifications.length;
  notifications = notifications.filter((n) => {
    if (n.recipientRole === 'reviewer' && (n.type === 'NEW_SUBMISSION' || n.type === 'RESUBMISSION')) {
      if (n.submissionId && !waitingIds.has(String(n.submissionId))) {
        dismissedOrReadSubmissions.add(String(n.submissionId));
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
    submissionId?: number;
    id: number | string;
    vendorName?: string;
    vendorProfileId?: number;
    siteName?: string;
    status: 'safe' | 'unsafe' | 'review';
    timestamp?: number;
  }[]
): void {
  let changed = false;
  for (const check of checks) {
    if (check.status !== 'safe' && check.status !== 'unsafe') continue;
    const subId = check.submissionId || check.id;
    if (dismissedOrReadSubmissions.has(String(subId))) {
      continue;
    }
    const exists = notifications.some(
      (n) =>
        n.recipientRole === 'vendor' &&
        String(n.submissionId) === String(subId) &&
        (n.type === 'REVIEW_SAFE' || n.type === 'REVIEW_UNSAFE')
    );
    if (!exists) {
      const isSafe = check.status === 'safe';
      notifications.unshift({
        id: `notif_verdict_${subId}`,
        recipientRole: 'vendor',
        vendorName: check.vendorName,
        vendorProfileId: check.vendorProfileId,
        type: isSafe ? 'REVIEW_SAFE' : 'REVIEW_UNSAFE',
        title: isSafe ? 'PPE Verified: Safe' : 'Action Required: Unsafe Worker',
        titleBn: isSafe ? 'পিপিই যাচাই: নিরাপদ' : 'জরুরি পদক্ষেপ: অনিরাপদ কর্মী চিহ্নিত',
        body: `${check.siteName || 'Site'}: ${isSafe ? 'Worker verified Safe' : 'Worker flagged for safety violations'}`,
        bodyBn: isSafe
          ? `${check.siteName || 'সাইট'}: কর্মী সফলভাবে নিরাপদ হিসেবে যাচাই করা হয়েছে।`
          : `${check.siteName || 'সাইট'}: কর্মীতে সুরক্ষা ত্রুটি চিহ্নিত হয়েছে। বিবরণ দেখে পুনরায় জমা দিন।`,
        submissionId: subId,
        siteName: check.siteName,
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

export async function broadcastNewSubmissionAlert(meta: {
  submissionId: number | string;
  siteName?: string;
  workerCount?: number;
  vendorName?: string;
}): Promise<void> {
  const subId = meta.submissionId;
  if (subId) {
    dismissedOrReadSubmissions.delete(String(subId));
  }

  // 1. Immediately register Reviewer notification so Reviewer bell and popup banner activate instantly
  void addNotification({
    recipientRole: 'reviewer',
    type: 'NEW_SUBMISSION',
    title: 'New PPE Submission',
    titleBn: 'নতুন পিপিই সাবমিশন',
    body: `${meta.vendorName || 'Vendor'} submitted ${meta.siteName || 'Site'} (${meta.workerCount || 1} workers) for review.`,
    bodyBn: `${meta.vendorName || 'ভেন্ডর'} ${meta.siteName || 'সাইট'}-এর ${meta.workerCount || 1} জন কর্মীর পিপিই নিরীক্ষার জন্য জমা দিয়েছেন।`,
    submissionId: subId,
    siteName: meta.siteName,
    workerCount: meta.workerCount,
  });

  // 2. Immediately register Vendor submission confirmation so Vendor bell also receives submission receipt
  void addNotification({
    recipientRole: 'vendor',
    vendorName: meta.vendorName,
    type: 'NEW_SUBMISSION',
    title: 'Submission Sent Successfully',
    titleBn: 'সাবমিশন সফলভাবে পাঠানো হয়েছে',
    body: `${meta.siteName || 'Site'}: ${meta.workerCount || 1} worker(s) submitted for compliance review.`,
    bodyBn: `${meta.siteName || 'সাইট'}: ${meta.workerCount || 1} জন কর্মীর পিপিই নিরীক্ষার জন্য জমা দেওয়া হয়েছে।`,
    submissionId: subId,
    siteName: meta.siteName,
    workerCount: meta.workerCount,
  });

  // 3. Realtime broadcast to remote devices/peers across channels
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const payload = {
      ...meta,
      timestamp: Date.now(),
    };

    const channel = notificationChannel || supabase.channel(NOTIFICATION_CHANNEL_NAME);
    await channel.send({
      type: 'broadcast',
      event: 'new_submission_notification',
      payload,
    }).catch(() => {});

    // Also broadcast to live sync channel so all reviewers update immediately
    const liveChan = supabase.channel('ppe_live_sync');
    await liveChan.send({
      type: 'broadcast',
      event: 'new_submission',
      payload,
    }).catch(() => {});
  } catch (err) {
    console.warn('[notification.service] Failed to broadcast new_submission_notification:', err);
  }
}

export async function broadcastReviewVerdictAlert(meta: {
  submissionId: number | string;
  siteName?: string;
  vendorName?: string;
  vendorProfileId?: number;
  verdict: 'safe' | 'unsafe' | 'reviewed';
  hasUnsafe?: boolean;
  workerCount?: number;
  workerSummary?: string;
  unsafeReasons?: string[];
  notes?: string;
}): Promise<void> {
  const isSafe = meta.verdict === 'safe' || meta.verdict === 'reviewed' || !meta.hasUnsafe;
  const siteStr = meta.siteName || 'Site';
  const workerDetail = meta.workerSummary || (isSafe ? `Worker verified Safe` : `Worker flagged for safety violations`);

  // Reviewer does NOT receive notification for their own review verdict.
  // Purge this submission from Reviewer's pending notifications immediately!
  if (meta.submissionId) {
    removeReviewedSubmissionNotification(meta.submissionId);
  }

  // Only the Vendor receives safe/unsafe notification.
  void addNotification({
    recipientRole: 'vendor',
    vendorName: meta.vendorName,
    vendorProfileId: meta.vendorProfileId,
    type: isSafe ? 'REVIEW_SAFE' : 'REVIEW_UNSAFE',
    title: isSafe ? 'PPE Verified: Safe' : 'Action Required: Unsafe Worker',
    titleBn: isSafe ? 'পিপিই যাচাই: নিরাপদ' : 'জরুরি পদক্ষেপ: অনিরাপদ কর্মী চিহ্নিত',
    body: `${siteStr}: ${workerDetail}`,
    bodyBn: isSafe
      ? `${siteStr}: কর্মী সফলভাবে নিরাপদ হিসেবে যাচাই করা হয়েছে।`
      : `${siteStr}: কর্মীতে সুরক্ষা ত্রুটি চিহ্নিত হয়েছে। বিবরণ দেখে পুনরায় জমা দিন।`,
    submissionId: meta.submissionId,
    siteName: meta.siteName,
    workerCount: meta.workerCount,
    workerSummary: meta.workerSummary,
    verdict: isSafe ? 'safe' : 'unsafe',
    unsafeReasons: meta.unsafeReasons,
  });

  // Realtime broadcast to remote devices/peers
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const channel = notificationChannel || supabase.channel(NOTIFICATION_CHANNEL_NAME);
    await channel.send({
      type: 'broadcast',
      event: 'review_verdict_notification',
      payload: {
        ...meta,
        timestamp: Date.now(),
      },
    });
  } catch (err) {
    console.warn('[notification.service] Failed to broadcast review_verdict_notification:', err);
  }
}

export function initializeRealtimeNotifications(): () => void {
  void hydrateNotifications();
  if (notificationChannel && (notificationChannel as any)._hasSubscribed) {
    return () => {};
  }

  const supabase = getSupabaseClient();
  if (!supabase || typeof supabase.channel !== 'function') {
    return () => {};
  }

  try {
    const existing = supabase.getChannels?.().find((c: any) => c.topic === `realtime:${NOTIFICATION_CHANNEL_NAME}`);
    if (existing) {
      if ((existing as any)._hasSubscribed) {
        notificationChannel = existing;
        return () => {};
      }
      try {
        supabase.removeChannel(existing);
      } catch {}
      notificationChannel = null;
    }

    notificationChannel = supabase.channel(NOTIFICATION_CHANNEL_NAME, {
      config: { broadcast: { ack: true, self: true } },
    });
    (notificationChannel as any)._hasSubscribed = true;

    notificationChannel
      // 1. Reviewer Notification: When Vendor submits new check
      .on('broadcast', { event: 'new_submission_notification' }, (event: any) => {
        const payload = event.payload || {};
        if (payload.submissionId) {
          dismissedOrReadSubmissions.delete(String(payload.submissionId));
        }
        void addNotification({
          recipientRole: 'reviewer',
          type: 'NEW_SUBMISSION',
          title: 'New PPE Submission',
          titleBn: 'নতুন পিপিই সাবমিশন',
          body: `${payload.vendorName || 'Vendor'} submitted ${payload.siteName || 'Site'} (${payload.workerCount || 1} workers) for review.`,
          bodyBn: `${payload.vendorName || 'ভেন্ডর'} ${payload.siteName || 'সাইট'}-এর ${payload.workerCount || 1} জন কর্মীর পিপিই নিরীক্ষার জন্য জমা দিয়েছেন।`,
          submissionId: payload.submissionId,
          siteName: payload.siteName,
          workerCount: payload.workerCount,
        });
      })
      .on('broadcast', { event: 'new_submission' }, (event: any) => {
        const payload = event.payload || {};
        if (payload.submissionId) {
          dismissedOrReadSubmissions.delete(String(payload.submissionId));
          void addNotification({
            recipientRole: 'reviewer',
            type: 'NEW_SUBMISSION',
            title: 'New PPE Submission',
            titleBn: 'নতুন পিপিই সাবমিশন',
            body: `${payload.vendorName || 'Vendor'} submitted ${payload.siteName || 'Site'} (${payload.workerCount || 1} workers) for review.`,
            bodyBn: `${payload.vendorName || 'ভেন্ডর'} ${payload.siteName || 'সাইট'}-এর ${payload.workerCount || 1} জন কর্মীর পিপিই নিরীক্ষার জন্য জমা দিয়েছেন।`,
            submissionId: payload.submissionId,
            siteName: payload.siteName,
            workerCount: payload.workerCount,
          });
        }
      })
      // 2. Peer Notification: When Reviewer evaluates check
      .on('broadcast', { event: 'review_verdict_notification' }, (event: any) => {
        const payload = event.payload || {};
        if (payload.submissionId) {
          removeReviewedSubmissionNotification(payload.submissionId);
        }
        const isSafe = payload.verdict === 'safe' || payload.verdict === 'reviewed' || !payload.hasUnsafe;
        const siteStr = payload.siteName || 'Site';
        const workerDetail = payload.workerSummary || (isSafe ? `Worker verified Safe` : `Worker flagged for safety violations`);
        if (isSafe) {
          void addNotification({
            recipientRole: 'vendor',
            vendorName: payload.vendorName,
            vendorProfileId: payload.vendorProfileId,
            type: 'REVIEW_SAFE',
            title: 'PPE Verified: Safe',
            titleBn: 'পিপিই যাচাই: নিরাপদ',
            body: `${siteStr}: ${workerDetail}`,
            bodyBn: `${siteStr}: কর্মী সফলভাবে নিরাপদ হিসেবে যাচাই করা হয়েছে।`,
            submissionId: payload.submissionId,
            siteName: payload.siteName,
            workerCount: payload.workerCount,
            workerSummary: payload.workerSummary,
            verdict: 'safe',
            unsafeReasons: payload.unsafeReasons,
          });
        } else {
          void addNotification({
            recipientRole: 'vendor',
            vendorName: payload.vendorName,
            vendorProfileId: payload.vendorProfileId,
            type: 'REVIEW_UNSAFE',
            title: 'Action Required: Unsafe Worker',
            titleBn: 'জরুরি পদক্ষেপ: অনিরাপদ কর্মী চিহ্নিত',
            body: `${siteStr}: ${workerDetail}`,
            bodyBn: `${siteStr}: কর্মীতে সুরক্ষা ত্রুটি চিহ্নিত হয়েছে। বিবরণ দেখে পুনরায় জমা দিন।`,
            submissionId: payload.submissionId,
            siteName: payload.siteName,
            workerCount: payload.workerCount,
            workerSummary: payload.workerSummary,
            verdict: 'unsafe',
            unsafeReasons: payload.unsafeReasons,
          });
        }
      })
      // 3. Fallback to Supabase Postgres Changes (Realtime DB triggers)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ppe_submissions' }, (payload: any) => {
        const sub = payload.new;
        if (sub?.id && payload.eventType === 'INSERT') {
          void addNotification({
            recipientRole: 'reviewer',
            type: 'NEW_SUBMISSION',
            title: 'New PPE Submission',
            titleBn: 'নতুন পিপিই সাবমিশন',
            body: `Site ${sub.site_name || 'inspection'} submitted for compliance review.`,
            bodyBn: `সাইট ${sub.site_name || 'এর'} নিরীক্ষা পর্যালোচনার জন্য জমা পড়েছে।`,
            submissionId: sub.id,
            siteName: sub.site_name,
          });
        } else if (sub?.id && sub.status && sub.status !== 'waiting' && sub.status !== 'UNDER_REVIEW') {
          removeReviewedSubmissionNotification(sub.id);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submission_reviews' }, (payload: any) => {
        const rev = payload.new;
        if (rev?.submission_id) {
          removeReviewedSubmissionNotification(rev.submission_id);
          const isSafe = rev.verdict === 'SAFE' || rev.verdict === 'safe' || rev.final_status === 'reviewed';
          void addNotification({
            recipientRole: 'vendor',
            type: isSafe ? 'REVIEW_SAFE' : 'REVIEW_UNSAFE',
            title: isSafe ? 'PPE Approved (Safe)' : 'Action Required: Unsafe Workers',
            titleBn: isSafe ? 'পিপিই অনুমোদন: নিরাপদ' : 'জরুরি পদক্ষেপ: অনিরাপদ কর্মী চিহ্নিত',
            body: isSafe
              ? 'Your PPE submission has been reviewed and verified as Safe.'
              : 'Safety violations were flagged on your submission. Please check notes and resubmit.',
            bodyBn: isSafe
              ? 'আপনার পিপিই সাবমিশন পর্যালোচনা শেষে নিরাপদ হিসেবে অনুমোদিত হয়েছে।'
              : 'আপনার সাবমিশনে সুরক্ষা ত্রুটি চিহ্নিত হয়েছে। অনুগ্রহ করে নোট দেখে পুনরায় জমা দিন।',
            submissionId: rev.submission_id,
          });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ppe_reviews' }, (payload: any) => {
        const rev = payload.new;
        if (rev?.id) {
          const isSafe = rev.verdict === 'SAFE';
          void addNotification({
            recipientRole: 'vendor',
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
        }
      })
      .subscribe((status: string) => {
        console.log('[notification.service] Supabase notifications channel status:', status);
      });

    return () => {};
  } catch (err) {
    console.warn('[notification.service] Failed to subscribe to notifications channel:', err);
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
