import { authStore } from "@/stores/auth.store";
import { latestCurrentReview } from "@/services/vendor/vendorSubmissions.service";
import { createRefCountedSubscription } from "@/services/realtime/refCountedSubscription";
import { getDriveThumbnailUrl } from "@/services/google-drive/files";
import { ImageSource } from "expo-image";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState } from "react-native";
import { assets } from "@/constants/assets";
import { isDemoMode } from "@/constants/devMode";

export type WorkerIssue = {
  message: string;
  severityKey: "critical" | "missing";
  tags: string[];
  title: string;
  tone: "error" | "warning";
};

export type WorkerCheck = {
  id: string;
  image?: ImageSource;
  issues?: WorkerIssue[];
  reviewerName?: string;
  reviewerNote?: string;
  siteName?: string;
  status: "safe" | "unsafe" | "review";
  timeKey: string;
  timestamp: number; // Unix timestamp in milliseconds for chronological sorting
  titleKey: string;
  unsafeReasons?: string[];
  workerNumber: number;
  isDemo?: boolean;
};

const now = Date.now();
const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

// Initial state containing Safe, Unsafe, and Pending workers with exact timestamps and proper formatted timeKeys
const demoWorkerChecks = [
  // 1. Safe workers (Approved by EHS - shown in "All History" tab)
  {
    isDemo: true,
    id: 'w130',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time1510', // Today, 03:10 PM
    timestamp: now - 20 * minute,
    titleKey: 'worker130',
    workerNumber: 130,
  },
  {
    isDemo: true,
    id: 'w129',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time1420', // Today, 02:20 PM
    timestamp: now - 70 * minute,
    titleKey: 'worker129',
    workerNumber: 129,
  },
  {
    isDemo: true,
    id: 'w128',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time1215', // Today, 12:15 PM
    timestamp: now - 195 * minute,
    titleKey: 'worker128',
    workerNumber: 128,
  },
  {
    isDemo: true,
    id: 'w126',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time1130', // Today, 11:30 AM
    timestamp: now - 240 * minute,
    titleKey: 'worker126',
    workerNumber: 126,
  },
  {
    isDemo: true,
    id: 'w125',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time1100', // Today, 11:00 AM
    timestamp: now - 270 * minute,
    titleKey: 'worker125',
    workerNumber: 125,
  },
  {
    isDemo: true,
    id: 'w124',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time1042', // Today, 10:42 AM
    timestamp: now - 288 * minute,
    titleKey: 'worker124',
    workerNumber: 124,
  },
  {
    isDemo: true,
    id: 'w132',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time0915', // Today, 09:15 AM
    timestamp: now - 375 * minute,
    titleKey: 'worker132',
    workerNumber: 132,
  },
  {
    isDemo: true,
    id: 'w134',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'yesterday1415', // Yesterday, 02:15 PM
    timestamp: now - 1 * day - 2 * hour,
    titleKey: 'worker134',
    workerNumber: 134,
  },

  // 2. Unsafe workers (Action required - clickable to fix/resubmit)
  {
    isDemo: true,
    id: 'w135',
    image: assets.fieldUnsafeCheck,
    issues: [
      {
        message: 'Worker helmet chin strap was unbuckled while climbing.',
        severityKey: 'critical',
        tags: ['Helmet', 'Safety Gear'],
        title: 'Helmet Chin Strap Unbuckled',
        tone: 'error',
      },
      {
        message: 'Twin tail shock-absorbing lanyard not anchored to safety lifeline.',
        severityKey: 'critical',
        tags: ['Lanyard', 'Fall Arrest'],
        title: 'Lanyard Anchorage Not Secured',
        tone: 'error',
      },
    ],
    reviewerName: 'Mahmudul Hasan · EHS Representative',
    reviewerNote: 'Worker #135 was observed without the helmet chin strap fastened during vertical climbing. The lanyard carabiner was unclipped from the safety lifeline.',
    siteName: 'Gazipur-ER-102 - Tower Sector 3',
    status: 'unsafe',
    timeKey: 'time0945', // Today, 09:45 AM
    timestamp: now - 345 * minute,
    titleKey: 'worker135',
    unsafeReasons: ['helmet', 'lanyard'],
    workerNumber: 135,
  },
  {
    isDemo: true,
    id: 'w127',
    image: assets.fieldUnsafeCheck,
    issues: [
      {
        message: 'Full-body harness leg straps and chest strap loose and improperly adjusted.',
        severityKey: 'critical',
        tags: ['Harness', 'Fall Protection'],
        title: 'Full-Body Harness Fitting Failure',
        tone: 'error',
      },
      {
        message: 'Worker operating near edge with no active fall restraint connection.',
        severityKey: 'critical',
        tags: ['Anchorage', 'Fall Arrest'],
        title: 'Anchorage Missing',
        tone: 'error',
      },
    ],
    reviewerName: 'Tanvir Hossain · EHS Safety Officer',
    reviewerNote: 'Worker #127 full-body harness dorsal D-ring was misaligned and leg straps were unbuckled. Lanyard carabiner was unclipped from certified anchor point.',
    siteName: 'Mirpur-DH-044 - Rooftop Mast',
    status: 'unsafe',
    timeKey: 'yesterday1630', // Yesterday, 04:30 PM
    timestamp: now - 1 * day - 4 * hour,
    titleKey: 'worker127',
    unsafeReasons: ['harness', 'anchorage'],
    workerNumber: 127,
  },

  // 3. Pending workers (Awaiting review - shown in "All pending" tab / "View all")
  {
    isDemo: true,
    id: 'w136',
    status: 'review',
    timeKey: 'time1520', // Today, 03:20 PM
    timestamp: now - 10 * minute,
    titleKey: 'worker136',
    workerNumber: 136,
  },
  {
    isDemo: true,
    id: 'w131',
    status: 'review',
    timeKey: 'time1345', // Today, 01:45 PM
    timestamp: now - 105 * minute,
    titleKey: 'worker131',
    workerNumber: 131,
  },
  {
    isDemo: true,
    id: 'w133',
    status: 'review',
    timeKey: 'time1042', // Today, 10:42 AM
    timestamp: now - 288 * minute,
    titleKey: 'worker133',
    workerNumber: 133,
  },
  {
    isDemo: true,
    id: 'w137',
    status: 'review',
    timeKey: 'yesterday1515', // Yesterday, 03:15 PM
    timestamp: now - 1 * day - 1 * hour,
    titleKey: 'worker137',
    workerNumber: 137,
  },
] satisfies WorkerCheck[];


let workerChecks: WorkerCheck[] = isDemoMode ? [...demoWorkerChecks] : [];

const listeners = new Set<() => void>();
let workerChecksChannel: any = null;
let workerChecksAppStateSub: { remove: () => void } | null = null;
let workerChecksSyncInterval: ReturnType<typeof setInterval> | null = null;

function stopWorkerChecksPolling() {
  if (workerChecksSyncInterval) clearInterval(workerChecksSyncInterval);
  workerChecksSyncInterval = null;
}

function canSyncWorkerChecksWhileFocused() {
  return listeners.size > 0 && AppState.currentState === 'active';
}

function syncWorkerChecksWhileFocused() {
  if (canSyncWorkerChecksWhileFocused()) void syncWorkerChecksFromSupabase();
}

function startWorkerChecksPolling() {
  if (listeners.size === 0 || AppState.currentState !== 'active' || workerChecksSyncInterval) return;
  workerChecksSyncInterval = setInterval(syncWorkerChecksWhileFocused, 15000);
}

function notify() {
  listeners.forEach((listener) => listener());
}

function ensureWorkerChecksRealtimeSubscription() {
  if (workerChecksChannel || listeners.size === 0) {
    return;
  }
  try {
    const supabase = require("@/services/supabase/client").supabase;
    if (!supabase || typeof supabase.channel !== "function") return;

    workerChecksChannel = supabase
      .channel("ppeye-vendor-worker-checks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ppe_reviews" },
        () => {
          syncWorkerChecksWhileFocused();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "submission_reviews" },
        () => {
          syncWorkerChecksWhileFocused();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ppe_submissions" },
        () => {
          syncWorkerChecksWhileFocused();
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "ppe_images" }, () => { syncWorkerChecksWhileFocused(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "ppe_review_reasons" }, () => { syncWorkerChecksWhileFocused(); })
      .subscribe((status: string) => { if (status === 'SUBSCRIBED') syncWorkerChecksWhileFocused(); });
  } catch {
    // Ignore channel setup errors in offline mode
  }
}

function cleanupWorkerChecksRealtimeSubscriptionIfIdle() {
  if (listeners.size > 0 || !workerChecksChannel) {
    return;
  }
  try {
    const supabase = require("@/services/supabase/client").supabase;
    if (supabase && typeof supabase.removeChannel === "function") {
      void supabase.removeChannel(workerChecksChannel);
    }
  } catch {
    // Ignore cleanup errors
  } finally {
    workerChecksChannel = null;
  }
}

export function subscribeWorkerChecks(listener: () => void) {
  listeners.add(listener);
  const releaseRealtime = workerChecksRealtimeRefs.acquire();
  return () => {
    listeners.delete(listener);
    releaseRealtime();
  };
}

const workerChecksRealtimeRefs = createRefCountedSubscription(() => {
  ensureWorkerChecksRealtimeSubscription();
  workerChecksAppStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      startWorkerChecksPolling();
      syncWorkerChecksWhileFocused();
    } else {
      stopWorkerChecksPolling();
    }
  });
  startWorkerChecksPolling();
  return () => {
    cleanupWorkerChecksRealtimeSubscriptionIfIdle();
    workerChecksAppStateSub?.remove();
    workerChecksAppStateSub = null;
    stopWorkerChecksPolling();
  };
});

export function getAllWorkerChecks(): WorkerCheck[] {
  return [...workerChecks].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Returns safe AND unsafe checks for TODAY for vendor home page (up to limit, max 10).
 * Sorted chronologically (latest time first).
 * Excludes yesterday submissions.
 */
export function getRecentTodayChecks(limit = 10): WorkerCheck[] {
  return workerChecks
    .filter(
      (item) =>
        (item.status === "safe" || item.status === "unsafe") &&
        !item.timeKey.startsWith("yesterday"),
    )
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit);
}

/**
 * Returns a worker check by its ID or workerNumber.
 */
export function getWorkerCheckById(id: string): WorkerCheck | undefined {
  return workerChecks.find(
    (item) => item.id === id || String(item.workerNumber) === String(id),
  );
}

/**
 * Returns safe and unsafe checks (legacy export kept for compatibility).
 */
export function getRecentSafeAndUnsafeChecks(limit = 10): WorkerCheck[] {
  return getRecentTodayChecks(limit);
}

/**
 * Returns safe checks ONLY (for "All History" tab in History view).
 * Sorted chronologically (latest time first).
 */
export function getSafeWorkerChecks(): WorkerCheck[] {
  return workerChecks
    .filter((item) => item.status === "safe")
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Returns pending/review checks ONLY (for "All pending" tab in History view).
 * Sorted chronologically (latest time first).
 */
export function getPendingWorkerChecks(): WorkerCheck[] {
  return workerChecks
    .filter((item) => item.status === "review")
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Returns unsafe checks ONLY (for "All Unsafe" tab in History view).
 * Sorted chronologically (latest time first).
 */
export function getUnsafeWorkerChecks(): WorkerCheck[] {
  return workerChecks
    .filter((item) => item.status === "unsafe")
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Resubmit an unsafe check - transitions its status from 'unsafe' to 'review' (pending).
 */
export function resubmitWorkerCheck(
  idOrWorkerNumber: string | number,
  options?: {
    backUri?: string;
    frontUri?: string;
    siteName?: string;
    capturedAt?: number;
  },
) {
  const itemTimestamp = options?.capturedAt || Date.now();
  let matched = false;
  workerChecks = workerChecks.map((item) => {
    if (
      item.id === idOrWorkerNumber ||
      (item.workerNumber === idOrWorkerNumber && item.status === "unsafe") ||
      (typeof idOrWorkerNumber === "string" &&
        item.id.toLowerCase() === idOrWorkerNumber.toLowerCase())
    ) {
      matched = true;
      return {
        ...item,
        image: options?.frontUri ? { uri: options.frontUri } : item.image,
        siteName: options?.siteName || item.siteName,
        status: "review" as const,
        timestamp: itemTimestamp,
      };
    }
    return item;
  });

  if (!matched) return;
  workerChecks = [...workerChecks].sort(
    (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
  );
  notify();
}

export function toBengaliNumerals(num: number | string): string {
  const bnDigits = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  return String(num).replace(
    /[0-9]/g,
    (digit) => bnDigits[Number(digit)] || digit,
  );
}

export function extractSiteCode(siteName?: string): string {
  if (!siteName) return "Site";
  const trimmed = siteName.trim();
  const dashIndex = trimmed.indexOf(" - ");
  if (dashIndex !== -1) {
    return trimmed.slice(0, dashIndex).trim();
  }
  return trimmed;
}

/**
 * Returns dynamic title for worker check on vendor side:
 * Displays "Worker - <site code>" (or Bengali "কর্মী - <site code>")
 * Worker ID is removed as per user request.
 */
export function formatWorkerCheckTitle(
  item: { siteName?: string; workerNumber?: number; titleKey?: string },
  t?: (key: string, options?: any) => string,
  language?: string,
): string {
  const siteCode = extractSiteCode(item.siteName);
  const isBn = language === "bn" || language?.startsWith("bn");
  const prefix = isBn ? "কর্মী" : "Worker";
  return `${prefix} - ${siteCode}`;
}

/**
 * Formats time display using real time:
 * - If today: returns real formatted time (e.g. "06:05 PM")
 * - If yesterday: returns "Yesterday" (or Bengali "গতকাল")
 */
export function formatWorkerCheckTime(
  itemOrTimeKey: string | { timestamp?: number; timeKey?: string },
  t?: (key: string, options?: any) => string,
  explicitTimestamp?: number,
): string {
  let timestamp = explicitTimestamp;
  let timeKey = "";

  if (typeof itemOrTimeKey === "object" && itemOrTimeKey !== null) {
    timestamp = itemOrTimeKey.timestamp;
    timeKey = itemOrTimeKey.timeKey || "";
  } else if (typeof itemOrTimeKey === "string") {
    timeKey = itemOrTimeKey;
  }

  if (timestamp && typeof timestamp === "number" && !isNaN(timestamp)) {
    const date = new Date(timestamp);
    const now = new Date();

    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const isYesterday =
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 1,
      ).toDateString() ===
      new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      ).toDateString();

    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    const formattedHours = hours < 10 ? `0${hours}` : `${hours}`;
    const timeStr = `${formattedHours}:${minutes} ${ampm}`;

    if (isToday) {
      return timeStr;
    }
    if (isYesterday) {
      return t
        ? t("external.history.yesterday", { defaultValue: "Yesterday" })
        : "Yesterday";
    }
    return `${date.getDate()} ${date.toLocaleString("en-US", { month: "short" })}`;
  }

  if (t && timeKey) {
    const raw = t(`external.recent.${timeKey}`, { defaultValue: timeKey });
    if (
      timeKey.startsWith("yesterday") ||
      raw.toLowerCase().includes("yesterday") ||
      raw.includes("গতকাল")
    ) {
      return raw.includes("গতকাল") ? "গতকাল" : "Yesterday";
    }
    return raw.replace(/^(Today,\s*|আজ,\s*)/i, "");
  }

  return "Just now";
}

/**
 * Mark a worker as safe (e.g., when Reviewer marks a worker safe).
 */
export function markWorkerSafe(idOrWorkerNumber: string | number) {
  workerChecks = workerChecks.map((item) => {
    if (
      item.id === idOrWorkerNumber ||
      item.workerNumber === idOrWorkerNumber ||
      String(item.workerNumber) === String(idOrWorkerNumber)
    ) {
      return {
        ...item,
        image: item.image,
        status: "safe",
        timestamp: Date.now(), // Bump timestamp to now
      };
    }
    return item;
  });
  notify();
}

/**
 * Mark a worker as unsafe with reviewer reasons and note.
 */
export function markWorkerUnsafe(
  idOrWorkerNumber: string | number,
  reasons: string[] = [],
  notes?: string,
  reviewerName = "Reviewer",
) {
  let matched = false;
  workerChecks = workerChecks.map((item) => {
    if (
      item.id === idOrWorkerNumber ||
      item.workerNumber === idOrWorkerNumber ||
      String(item.workerNumber) === String(idOrWorkerNumber)
    ) {
      matched = true;
      return {
        ...item,
        image: item.image,
        status: "unsafe",
        unsafeReasons: reasons.length > 0 ? reasons : item.unsafeReasons,
        reviewerNote: notes || item.reviewerNote,
        reviewerName,
        timeKey: "time1042",
        timestamp: Date.now(),
      };
    }
    return item;
  });

  if (!matched && typeof idOrWorkerNumber === "string") return;
  notify();
}

let syncWorkerChecksInFlight: Promise<void> | null = null;
let lastWorkerChecksSignature = "";

/**
 * Synchronizes real worker submissions from Supabase to provide fully dynamic worker IDs and checks.
 */
export async function syncWorkerChecksFromSupabase(): Promise<void> {
  if (authStore.user?.category !== "EXTERNAL") return;
  if (syncWorkerChecksInFlight) {
    return syncWorkerChecksInFlight;
  }

  syncWorkerChecksInFlight = (async () => {
    try {
      const supabase = require("@/services/supabase/client").supabase;
      if (!supabase) return;
      const accountKey = `${authStore.user?.id}:${authStore.user?.vendorProfileId}`;
      const profileId = authStore.user?.vendorProfileId;
      if (typeof profileId !== 'number') return;

      let query = supabase
        .from("ppe_submissions")
        .select(
          `
          id,
          site_name,
          metadata,
          created_at,
          ppe_worker_instances (
            id,
            sequence_no,
            ppe_reviews (
              id,
              verdict,
              reviewed_at,
              ppe_review_reasons (
                note,
                unsafe_reasons (code, label)
              )
            ),
            ppe_images (
              id,
              side,
              created_at,
              files (
                id,
                provider_file_id,
                storage_provider
              )
            )
          )
        `,
        )
        .eq('vendor_profile_id', profileId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (authStore.user?.externalType === 'WORKER' && typeof authStore.user.id === 'number') query = query.eq('submitted_by', authStore.user.id);
      const { data: subs, error } = await query;

      if (accountKey !== `${authStore.user?.id}:${authStore.user?.vendorProfileId}`) return;

      if (error || !subs) {
        return;
      }

      const liveChecks: WorkerCheck[] = [];

      for (const sub of subs) {
        const workers = (sub.ppe_worker_instances as any[]) || [];

        for (const w of workers) {
          const review = latestCurrentReview(w, ((sub as any).metadata?.workerReviews || []).find((item: any) => Number(item.sequenceNo) === Number(w.sequence_no)));
          const newestPhotoAt = Math.max(0, ...(w.ppe_images || []).map((image: any) => new Date(image.created_at || 0).getTime()));
          let status: "safe" | "unsafe" | "review" = "review";
          let unsafeReasons: string[] = [];
          let reviewerNote: string | undefined;

          if (review?.verdict === "SAFE") {
            status = "safe";
          } else if (review?.verdict === "UNSAFE") {
            status = "unsafe";
            if (review.ppe_review_reasons) {
              unsafeReasons = review.ppe_review_reasons
                .map(
                  (rr: any) =>
                    rr.unsafe_reasons?.label || rr.unsafe_reasons?.code,
                )
                .filter(Boolean);
              reviewerNote = review.ppe_review_reasons[0]?.note;
            }
          }

          const frontImg = [...(w.ppe_images || [])].filter((img: any) => img.side === "FRONT").sort(
            (a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
          )[0];
          const fileId = frontImg?.files?.provider_file_id;
          const storageProvider = frontImg?.files?.storage_provider;
          const isSupabase =
            storageProvider === "SUPABASE" ||
            fileId?.startsWith("submissions/") ||
            fileId?.includes("/");

          let imageUrl: string | undefined;
          if (fileId) {
            if (isSupabase) {
              const { getCachedImageUriSync } = require("@/utils/image");
              imageUrl = getCachedImageUriSync(fileId) ?? undefined;
            } else {
              imageUrl = getDriveThumbnailUrl(fileId);
            }
          }
          const latestReviewAt = review?.reviewed_at ? new Date(review.reviewed_at).getTime() : 0;

          liveChecks.push({
            id: `sub_${sub.id}_w_${w.sequence_no}`,
            image: imageUrl ? ({ uri: imageUrl } as any) : undefined,
            siteName: sub.site_name,
            status,
            timeKey: "today",
            timestamp: Math.max(new Date(sub.created_at).getTime(), newestPhotoAt, latestReviewAt),
            titleKey: `worker${w.sequence_no}`,
            workerNumber: w.sequence_no,
            unsafeReasons,
            reviewerNote,
          });
        }
      }

      const demoItems = isDemoMode ? workerChecks.filter((item) => item.isDemo) : [];
      const nextChecks = [...liveChecks, ...demoItems].sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
      );
      const nextSignature = nextChecks.map((check) => [
        check.id,
        check.status,
        check.timestamp,
        check.siteName,
        check.workerNumber,
        check.image?.uri || "",
        (check.unsafeReasons || []).join(","),
        check.reviewerNote || "",
      ].join(":")).join("|");
      if (nextSignature !== lastWorkerChecksSignature) {
        lastWorkerChecksSignature = nextSignature;
        workerChecks = nextChecks;
        notify();
      }
    } catch (err) {
      console.warn("[WorkerChecks] syncWorkerChecksFromSupabase caught:", err);
    } finally {
      syncWorkerChecksInFlight = null;
    }
  })();

  return syncWorkerChecksInFlight;
}

/**
 * Hook providing reactive access to worker checks with time sorting
 */
export function useWorkerChecks(enabled = true) {
  const [, setTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      void syncWorkerChecksFromSupabase();
      return subscribeWorkerChecks(() => setTick((t) => t + 1));
    }, [enabled]),
  );

  return {
    allChecks: enabled ? getAllWorkerChecks() : [],
    pendingChecks: enabled ? getPendingWorkerChecks() : [],
    recentChecks: enabled ? getRecentTodayChecks(10) : [],
    safeChecks: enabled ? getSafeWorkerChecks() : [],
    unsafeChecks: enabled ? getUnsafeWorkerChecks() : [],
    markWorkerSafe,
    markWorkerUnsafe,
    resubmitWorkerCheck,
    syncWorkerChecksFromSupabase,
  };
}
