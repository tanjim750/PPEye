import { ImageSource } from 'expo-image';
import { useEffect, useState } from 'react';
import { assets } from '@/constants/assets';

export type WorkerIssue = {
  message: string;
  severityKey: 'critical' | 'missing';
  tags: string[];
  title: string;
  tone: 'error' | 'warning';
};

export type WorkerCheck = {
  id: string;
  image?: ImageSource;
  issues?: WorkerIssue[];
  reviewerName?: string;
  reviewerNote?: string;
  siteName?: string;
  status: 'safe' | 'unsafe' | 'review';
  timeKey: string;
  timestamp: number; // Unix timestamp in milliseconds for chronological sorting
  titleKey: string;
  unsafeReasons?: string[];
  workerNumber: number;
};

// Base reference timestamp for realistic ordering
const now = Date.now();
const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

// Initial state containing Safe, Unsafe, and Pending workers with exact timestamps and proper formatted timeKeys
let workerChecks: WorkerCheck[] = [
  // 1. Safe workers (Approved by EHS - shown in "All History" tab)
  {
    id: 'w130',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time1510', // Today, 03:10 PM
    timestamp: now - 20 * minute,
    titleKey: 'worker130',
    workerNumber: 130,
  },
  {
    id: 'w129',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time1420', // Today, 02:20 PM
    timestamp: now - 70 * minute,
    titleKey: 'worker129',
    workerNumber: 129,
  },
  {
    id: 'w128',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time1215', // Today, 12:15 PM
    timestamp: now - 195 * minute,
    titleKey: 'worker128',
    workerNumber: 128,
  },
  {
    id: 'w126',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time1130', // Today, 11:30 AM
    timestamp: now - 240 * minute,
    titleKey: 'worker126',
    workerNumber: 126,
  },
  {
    id: 'w125',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time1100', // Today, 11:00 AM
    timestamp: now - 270 * minute,
    titleKey: 'worker125',
    workerNumber: 125,
  },
  {
    id: 'w124',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time1042', // Today, 10:42 AM
    timestamp: now - 288 * minute,
    titleKey: 'worker124',
    workerNumber: 124,
  },
  {
    id: 'w132',
    image: assets.fieldSafeCheck,
    status: 'safe',
    timeKey: 'time0915', // Today, 09:15 AM
    timestamp: now - 375 * minute,
    titleKey: 'worker132',
    workerNumber: 132,
  },
  {
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
    id: 'w136',
    status: 'review',
    timeKey: 'time1520', // Today, 03:20 PM
    timestamp: now - 10 * minute,
    titleKey: 'worker136',
    workerNumber: 136,
  },
  {
    id: 'w131',
    status: 'review',
    timeKey: 'time1345', // Today, 01:45 PM
    timestamp: now - 105 * minute,
    titleKey: 'worker131',
    workerNumber: 131,
  },
  {
    id: 'w133',
    status: 'review',
    timeKey: 'time1042', // Today, 10:42 AM
    timestamp: now - 288 * minute,
    titleKey: 'worker133',
    workerNumber: 133,
  },
  {
    id: 'w137',
    status: 'review',
    timeKey: 'yesterday1515', // Yesterday, 03:15 PM
    timestamp: now - 1 * day - 1 * hour,
    titleKey: 'worker137',
    workerNumber: 137,
  },
];

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeWorkerChecks(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

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
        (item.status === 'safe' || item.status === 'unsafe') &&
        !item.timeKey.startsWith('yesterday')
    )
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit);
}

/**
 * Returns a worker check by its ID or workerNumber.
 */
export function getWorkerCheckById(id: string): WorkerCheck | undefined {
  return workerChecks.find(
    (item) => item.id === id || String(item.workerNumber) === String(id)
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
    .filter((item) => item.status === 'safe')
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Returns pending/review checks ONLY (for "All pending" tab in History view).
 * Sorted chronologically (latest time first).
 */
export function getPendingWorkerChecks(): WorkerCheck[] {
  return workerChecks
    .filter((item) => item.status === 'review')
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Returns unsafe checks ONLY (for "All Unsafe" tab in History view).
 * Sorted chronologically (latest time first).
 */
export function getUnsafeWorkerChecks(): WorkerCheck[] {
  return workerChecks
    .filter((item) => item.status === 'unsafe')
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Resubmit an unsafe check - transitions its status from 'unsafe' to 'review' (pending).
 */
export function resubmitWorkerCheck(
  idOrWorkerNumber: string | number,
  options?: { backUri?: string; frontUri?: string; siteName?: string; capturedAt?: number }
) {
  const itemTimestamp = options?.capturedAt || Date.now();
  let matched = false;
  workerChecks = workerChecks.map((item) => {
    if (
      item.id === idOrWorkerNumber ||
      (item.workerNumber === idOrWorkerNumber && item.status === 'unsafe') ||
      (typeof idOrWorkerNumber === 'string' &&
        item.id.toLowerCase() === idOrWorkerNumber.toLowerCase())
    ) {
      matched = true;
      return {
        ...item,
        image: options?.frontUri ? { uri: options.frontUri } : item.image,
        siteName: options?.siteName || item.siteName,
        status: 'review' as const,
        timestamp: itemTimestamp,
      };
    }
    return item;
  });

  if (!matched) {
    const num =
      typeof idOrWorkerNumber === 'number'
        ? idOrWorkerNumber
        : parseInt(String(idOrWorkerNumber).replace(/\D/g, ''), 10) || 1;
    workerChecks = [
      {
        id: `w${num}_${itemTimestamp}_${Math.random().toString(36).slice(2, 6)}`,
        image: options?.frontUri ? { uri: options.frontUri } : undefined,
        siteName: options?.siteName || 'Gazipur-ER-102 - Tower Sector 3',
        status: 'review' as const,
        timeKey: 'today',
        timestamp: itemTimestamp,
        titleKey: `worker${num}`,
        workerNumber: num,
      },
      ...workerChecks,
    ];
  }
  workerChecks = [...workerChecks].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  notify();
}

export function toBengaliNumerals(num: number | string): string {
  const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(num).replace(/[0-9]/g, (digit) => bnDigits[Number(digit)] || digit);
}

export function extractSiteCode(siteName?: string): string {
  if (!siteName) return 'Gazipur-ER-102';
  const trimmed = siteName.trim();
  const dashIndex = trimmed.indexOf(' - ');
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
  language?: string
): string {
  const siteCode = extractSiteCode(item.siteName);
  const isBn = language === 'bn' || language?.startsWith('bn');
  const prefix = isBn ? 'কর্মী' : 'Worker';
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
  explicitTimestamp?: number
): string {
  let timestamp = explicitTimestamp;
  let timeKey = '';

  if (typeof itemOrTimeKey === 'object' && itemOrTimeKey !== null) {
    timestamp = itemOrTimeKey.timestamp;
    timeKey = itemOrTimeKey.timeKey || '';
  } else if (typeof itemOrTimeKey === 'string') {
    timeKey = itemOrTimeKey;
  }

  if (timestamp && typeof timestamp === 'number' && !isNaN(timestamp)) {
    const date = new Date(timestamp);
    const now = new Date();

    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const isYesterday =
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString() ===
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).toDateString();

    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const formattedHours = hours < 10 ? `0${hours}` : `${hours}`;
    const timeStr = `${formattedHours}:${minutes} ${ampm}`;

    if (isToday) {
      return timeStr;
    }
    if (isYesterday) {
      return t ? t('external.history.yesterday', { defaultValue: 'Yesterday' }) : 'Yesterday';
    }
    return `${date.getDate()} ${date.toLocaleString('en-US', { month: 'short' })}`;
  }

  if (t && timeKey) {
    const raw = t(`external.recent.${timeKey}`, { defaultValue: timeKey });
    if (
      timeKey.startsWith('yesterday') ||
      raw.toLowerCase().includes('yesterday') ||
      raw.includes('গতকাল')
    ) {
      return raw.includes('গতকাল') ? 'গতকাল' : 'Yesterday';
    }
    return raw.replace(/^(Today,\s*|আজ,\s*)/i, '');
  }

  return 'Just now';
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
        image: item.image || assets.fieldSafeCheck,
        status: 'safe',
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
  reviewerName = 'Mahmudul Hasan · EHS Representative'
) {
  let matched = false;
  workerChecks = workerChecks.map((item) => {
    if (
      item.id === idOrWorkerNumber ||
      item.workerNumber === idOrWorkerNumber ||
      String(item.workerNumber) === String(idOrWorkerNumber) ||
      (idOrWorkerNumber === 'rev-01' && item.id === 'w135')
    ) {
      matched = true;
      return {
        ...item,
        image: assets.fieldUnsafeCheck,
        status: 'unsafe',
        unsafeReasons: reasons.length > 0 ? reasons : item.unsafeReasons,
        reviewerNote: notes || item.reviewerNote,
        reviewerName,
        timeKey: 'time1042',
        timestamp: Date.now(),
      };
    }
    return item;
  });

  if (!matched && typeof idOrWorkerNumber === 'string') {
    const newWorkerNum = parseInt(idOrWorkerNumber.replace(/\D/g, ''), 10) || 135;
    workerChecks = [
      {
        id: idOrWorkerNumber,
        image: assets.fieldUnsafeCheck,
        status: 'unsafe',
        unsafeReasons: reasons,
        reviewerNote: notes || 'PPE non-compliance identified during visual inspection.',
        reviewerName,
        siteName: 'Gazipur-ER-102 - Tower Sector 3',
        timeKey: 'time1042',
        timestamp: Date.now(),
        titleKey: `worker${newWorkerNum}`,
        workerNumber: newWorkerNum,
      },
      ...workerChecks,
    ];
  }
  notify();
}

/**
 * Synchronizes real worker submissions from Supabase to provide fully dynamic worker IDs and checks.
 */
export async function syncWorkerChecksFromSupabase() {
  try {
    const supabase = require('@/services/supabase/client').supabase;
    if (!supabase) return;

    const { data: subs, error } = await supabase
      .from('ppe_submissions')
      .select(`
        id,
        site_name,
        status,
        created_at,
        ppe_worker_instances (
          id,
          sequence_no,
          ppe_reviews (
            id,
            verdict,
            ppe_review_reasons (
              note,
              unsafe_reasons (code, label)
            )
          ),
          ppe_images (
            id,
            side,
            files (
              id,
              provider_file_id
            )
          )
        )
      `)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error || !subs || subs.length === 0) {
      return;
    }

    const liveChecks: WorkerCheck[] = [];
    for (const sub of subs) {
      const workers = (sub.ppe_worker_instances as any[]) || [];
      for (const w of workers) {
        const review = w.ppe_reviews?.[0];
        let status: 'safe' | 'unsafe' | 'review' = 'review';
        let unsafeReasons: string[] = [];
        let reviewerNote: string | undefined;

        if (review?.verdict === 'SAFE') {
          status = 'safe';
        } else if (review?.verdict === 'UNSAFE') {
          status = 'unsafe';
          if (review.ppe_review_reasons) {
            unsafeReasons = review.ppe_review_reasons
              .map((rr: any) => rr.unsafe_reasons?.label || rr.unsafe_reasons?.code)
              .filter(Boolean);
            reviewerNote = review.ppe_review_reasons[0]?.note;
          }
        }

        const frontImg = w.ppe_images?.find((img: any) => img.side === 'FRONT');
        const fileId = frontImg?.files?.provider_file_id;
        const imageUrl = fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w400` : undefined;

        liveChecks.push({
          id: `sub_${sub.id}_w_${w.sequence_no}`,
          image: imageUrl ? ({ uri: imageUrl } as any) : undefined,
          siteName: sub.site_name,
          status,
          timeKey: 'today',
          timestamp: new Date(sub.created_at).getTime(),
          titleKey: `worker${w.sequence_no}`,
          workerNumber: w.sequence_no,
          unsafeReasons,
          reviewerNote,
        });
      }
    }

    if (liveChecks.length > 0) {
      const liveIds = new Set(liveChecks.map((c) => c.id));
      const nonLive = workerChecks.filter((c) => !liveIds.has(c.id));
      workerChecks = [...liveChecks, ...nonLive];
      notify();
    }
  } catch (err) {
    console.warn('[WorkerChecks] syncWorkerChecksFromSupabase caught:', err);
  }
}

/**
 * Hook providing reactive access to worker checks with time sorting
 */
export function useWorkerChecks() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeWorkerChecks(() => {
      setTick((t) => t + 1);
    });
    syncWorkerChecksFromSupabase();
    return unsubscribe;
  }, []);

  return {
    allChecks: getAllWorkerChecks(),
    pendingChecks: getPendingWorkerChecks(),
    recentChecks: getRecentTodayChecks(10),
    safeChecks: getSafeWorkerChecks(),
    unsafeChecks: getUnsafeWorkerChecks(),
    markWorkerSafe,
    markWorkerUnsafe,
    resubmitWorkerCheck,
    syncWorkerChecksFromSupabase,
  };
}
