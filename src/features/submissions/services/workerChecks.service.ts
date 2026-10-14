import { ImageSource } from 'expo-image';
import { useEffect, useState } from 'react';
import { assets } from '@/constants/assets';

export type WorkerCheck = {
  id: string;
  image?: ImageSource;
  status: 'safe' | 'unsafe' | 'review';
  timeKey: string;
  timestamp: number; // Unix timestamp in milliseconds for chronological sorting
  titleKey: string;
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
    status: 'unsafe',
    timeKey: 'time0945', // Today, 09:45 AM
    timestamp: now - 345 * minute,
    titleKey: 'worker135',
    workerNumber: 135,
  },
  {
    id: 'w127',
    image: assets.fieldUnsafeCheck,
    status: 'unsafe',
    timeKey: 'yesterday1630', // Yesterday, 04:30 PM
    timestamp: now - 1 * day - 4 * hour,
    titleKey: 'worker127',
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
 * Returns safe and unsafe checks ONLY for vendor home page (up to limit, max 10).
 * Sorted chronologically (latest time first).
 * Pending (review) checks are excluded.
 */
export function getRecentSafeAndUnsafeChecks(limit = 10): WorkerCheck[] {
  return workerChecks
    .filter((item) => item.status === 'safe' || item.status === 'unsafe')
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
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
 * Hook providing reactive access to worker checks with time sorting
 */
export function useWorkerChecks() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeWorkerChecks(() => {
      setTick((t) => t + 1);
    });
    return unsubscribe;
  }, []);

  return {
    allChecks: getAllWorkerChecks(),
    pendingChecks: getPendingWorkerChecks(),
    recentChecks: getRecentSafeAndUnsafeChecks(10),
    safeChecks: getSafeWorkerChecks(),
    markWorkerSafe,
  };
}
