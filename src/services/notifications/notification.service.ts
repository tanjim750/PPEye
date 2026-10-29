import { useEffect, useState } from 'react';

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

const STORAGE_KEY = 'ppeye:notifications:v3';
const PREFS_KEY = 'ppeye:notification_preferences_v3';
const NOTIFICATION_CHANNEL_NAME = 'ppeye_realtime_notifications';

// In-memory preferences
let preferences: NotificationPreferences = {
  newSubmissions: true,
  reviewUpdates: true,
  accountUpdates: true,
  batteryOptimization: true,
};

// Initial demo notifications strictly partitioned by role
const INITIAL_DEMO_NOTIFICATIONS: AppNotification[] = [
  // Reviewer ONLY notification
  {
    id: 'demo-rev-1',
    recipientRole: 'reviewer',
    type: 'NEW_SUBMISSION',
    title: 'New PPE Submission',
    titleBn: 'নতুন পিপিই সাবমিশন',
    body: 'ABC Telecom Ltd submitted Site-01 (1 worker) for compliance review.',
    bodyBn: 'এবিসি টেলিকম লিমিটেড সাইট-০১ এর পিপিই নিরীক্ষার জন্য জমা দিয়েছে।',
    submissionId: 1,
    siteName: 'Site-01',
    workerCount: 1,
    workerSummary: 'Worker #1 (Pending)',
    read: false,
    createdAt: Date.now() - 1000 * 60 * 10,
  },
  // Vendor ONLY notifications
  {
    id: 'demo-ven-1',
    recipientRole: 'vendor',
    vendorName: 'ABC Telecom',
    type: 'REVIEW_UNSAFE',
    title: 'Safety Action Required',
    titleBn: 'নিরাপত্তা ব্যবস্থা প্রয়োজন',
    body: 'Worker #1 was flagged for missing safety helmet. Please check notes and resubmit.',
    bodyBn: 'কর্মী #১ এর হেলমেট অনুপস্থিত চিহ্নিত হয়েছে। নোট দেখে পুনরায় ছবি জমা দিন।',
    submissionId: 3,
    siteName: 'Site-03',
    workerCount: 1,
    verdict: 'unsafe',
    workerSummary: 'Worker #1: Unsafe (Missing Helmet)',
    unsafeReasons: ['Missing Helmet'],
    read: false,
    createdAt: Date.now() - 1000 * 60 * 35,
  },
  {
    id: 'demo-ven-2',
    recipientRole: 'vendor',
    vendorName: 'ABC Telecom',
    type: 'REVIEW_SAFE',
    title: 'Submission Verified Safe',
    titleBn: 'সাবমিশন অনুমোদিত (নিরাপদ)',
    body: 'Lead EHS Safety Officer approved your recent worker submission.',
    bodyBn: 'লিড ইএইচএস সেফটি অফিসার আপনার সাম্প্রতিক কর্মী সাবমিশন অনুমোদন করেছেন।',
    submissionId: 2,
    siteName: 'Site-02',
    workerCount: 2,
    verdict: 'safe',
    workerSummary: 'Worker #1, #2: Safe',
    read: true,
    createdAt: Date.now() - 1000 * 60 * 120,
  },
];

// Initialize synchronously so home page has zero loading delay
let notifications: AppNotification[] = [...INITIAL_DEMO_NOTIFICATIONS];
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
    await storageSet(STORAGE_KEY, JSON.stringify(notifications));
  } catch (err) {
    console.warn('[notification.service] Failed to persist notifications:', err);
  }
}

export async function hydrateNotifications(): Promise<void> {
  if (isHydrated) return;
  try {
    const [rawNotifs, rawPrefs] = await Promise.all([
      storageGet(STORAGE_KEY),
      storageGet(PREFS_KEY),
    ]);

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
          notifications = parsed;
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
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    const Notifications = require('expo-notifications');
    if (Notifications?.requestPermissionsAsync) {
      const { status } = await Notifications.requestPermissionsAsync();
      return status === 'granted';
    }
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

  // STRICT vendor filtering: vendor sees only notifications belonging to their vendor
  if (role === 'vendor' && vendorFilter?.vendorName) {
    const filterName = vendorFilter.vendorName.trim().toLowerCase();
    list = list.filter((n) => {
      if (n.vendorName) {
        return (
          n.vendorName.trim().toLowerCase().includes(filterName) ||
          filterName.includes(n.vendorName.trim().toLowerCase())
        );
      }
      if (n.vendorProfileId && vendorFilter.vendorProfileId) {
        return n.vendorProfileId === vendorFilter.vendorProfileId;
      }
      return false;
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

  // 2. React Native / Mobile expo-notifications (if present)
  try {
    const Notifications = require('expo-notifications');
    if (Notifications?.scheduleNotificationAsync) {
      void Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: true,
          vibrate: [0, 250, 150, 250],
        },
        trigger: null,
      });
    }
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
  const filterName = vendorFilter?.vendorName?.trim().toLowerCase();
  notifications = notifications.map((n) => {
    const roleMatches = !role || n.recipientRole === role;
    if (!roleMatches) return n;
    if (role === 'vendor' && filterName) {
      const vendorMatches =
        n.vendorName?.trim().toLowerCase().includes(filterName) ||
        filterName.includes(n.vendorName?.trim().toLowerCase() || '');
      return vendorMatches ? { ...n, read: true } : n;
    }
    return { ...n, read: true };
  });
  notify();
  void persist();
}

export async function deleteNotification(id: string): Promise<void> {
  notifications = notifications.filter((n) => n.id !== id);
  notify();
  void persist();
}

export async function clearAllNotifications(
  role?: NotificationRole,
  vendorFilter?: VendorFilter
): Promise<void> {
  const filterName = vendorFilter?.vendorName?.trim().toLowerCase();
  if (!role) {
    notifications = [];
  } else if (role === 'vendor' && filterName) {
    notifications = notifications.filter((n) => {
      if (n.recipientRole !== 'vendor') return true;
      const vendorMatches =
        n.vendorName?.trim().toLowerCase().includes(filterName) ||
        filterName.includes(n.vendorName?.trim().toLowerCase() || '');
      return !vendorMatches;
    });
  } else {
    notifications = notifications.filter((n) => n.recipientRole !== role);
  }
  notify();
  void persist();
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
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const channel = notificationChannel || supabase.channel(NOTIFICATION_CHANNEL_NAME);
    await channel.send({
      type: 'broadcast',
      event: 'new_submission_notification',
      payload: {
        ...meta,
        timestamp: Date.now(),
      },
    });
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

  // 1. Immediately create local notification for Vendor
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

  // 2. Immediately create local notification for Reviewer audit & bottom sheet
  void addNotification({
    recipientRole: 'reviewer',
    vendorName: meta.vendorName,
    vendorProfileId: meta.vendorProfileId,
    type: isSafe ? 'REVIEW_SAFE' : 'REVIEW_UNSAFE',
    title: isSafe ? 'Review Completed: Safe' : 'Review Completed: Unsafe Logged',
    titleBn: isSafe ? 'রিভিউ সম্পন্ন: নিরাপদ' : 'রিভিউ সম্পন্ন: অনিরাপদ চিহ্নিত',
    body: `${siteStr}: ${workerDetail}`,
    bodyBn: isSafe
      ? `${siteStr}: নিরীক্ষা সম্পন্ন - কর্মী নিরাপদ হিসেবে অনুমোদিত।`
      : `${siteStr}: নিরীক্ষা সম্পন্ন - সুরক্ষার নিয়মলঙ্ঘন লিপিবদ্ধ করা হয়েছে।`,
    submissionId: meta.submissionId,
    siteName: meta.siteName,
    workerCount: meta.workerCount,
    workerSummary: meta.workerSummary,
    verdict: isSafe ? 'safe' : 'unsafe',
    unsafeReasons: meta.unsafeReasons,
  });

  // 3. Realtime broadcast to remote devices/peers
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
          void addNotification({
            recipientRole: 'reviewer',
            type: 'NEW_SUBMISSION',
            title: 'New PPE Submission',
            titleBn: 'নতুন পিপিই সাবমিশন',
            body: `A new PPE inspection was submitted for review.`,
            bodyBn: `পর্যালোচনার জন্য একটি নতুন পিপিই নিরীক্ষা জমা পড়েছে।`,
            submissionId: payload.submissionId,
          });
        }
      })
      // 2. Peer Notification: When Reviewer evaluates check
      .on('broadcast', { event: 'review_verdict_notification' }, (event: any) => {
        const payload = event.payload || {};
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
      // 3. Fallback to Supabase Postgres Changes
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ppe_submissions' }, (payload: any) => {
        const sub = payload.new;
        if (sub?.id) {
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
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'submission_reviews' }, (payload: any) => {
        const rev = payload.new;
        if (rev?.submission_id) {
          const isSafe = rev.final_status === 'reviewed';
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
