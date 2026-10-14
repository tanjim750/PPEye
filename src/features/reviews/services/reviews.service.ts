import { useEffect, useState } from 'react';

export type ReviewItem = {
  avatar?: string;
  id: string;
  initials?: string;
  location: string;
  otherReasonText?: string;
  photos: number;
  status: 'waiting' | 'reviewed' | 'unsafe';
  teamLead: string;
  teamLeadKey?: string;
  timeDisplay: string;
  timeKey?: string;
  timestamp: number;
  unsafeReasons?: string[];
  vendor: string;
  workers: number;
};

export const unsafeReasonLabels: Record<string, string> = {
  anchorage: 'Anchorage / connection',
  harness: 'Full-body harness',
  helmet: 'Helmet',
  lanyard: 'Lanyard',
  other: 'Other violation',
  shoes: 'Safety shoes',
};

const now = Date.now();
const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

// Initial state: Pending reviews (status === 'waiting'), Safe (status === 'reviewed'), and Unsafe (status === 'unsafe')
let reviews: ReviewItem[] = [
  // 1. Pending for review (waiting)
  {
    avatar: 'RM',
    id: 'rev-01',
    location: 'Gazipur-ER-102',
    photos: 8,
    status: 'waiting',
    teamLead: 'Rahim Mia · Team Leader',
    teamLeadKey: 'rahimLead',
    timeDisplay: '10:42 AM',
    timeKey: 'time1042',
    timestamp: now - 15 * minute,
    vendor: 'ABC Telecom',
    workers: 4,
  },
  {
    id: 'rev-02',
    initials: 'T',
    location: 'Mirpur-DH-044',
    photos: 7,
    status: 'waiting',
    teamLead: 'Tariq Islam · Team Leader',
    timeDisplay: '10:30 AM',
    timestamp: now - 27 * minute,
    vendor: 'Apex Power',
    workers: 3,
  },
  {
    id: 'rev-03',
    initials: 'K',
    location: 'Uttara-DH-109',
    photos: 9,
    status: 'waiting',
    teamLead: 'Kamal Hossain · Team Leader',
    timeDisplay: '10:05 AM',
    timestamp: now - 52 * minute,
    vendor: 'Delta Comms',
    workers: 5,
  },
  {
    avatar: 'TA',
    id: 'rev-04',
    location: 'Mohakhali-ER-312',
    photos: 6,
    status: 'waiting',
    teamLead: 'Tanvir Ahmed · Team Leader',
    timeDisplay: '09:45 AM',
    timestamp: now - 72 * minute,
    vendor: 'Sigma Tech',
    workers: 3,
  },
  {
    id: 'rev-05',
    initials: 'F',
    location: 'Banani-DH-088',
    photos: 8,
    status: 'waiting',
    teamLead: 'Farhan Kabir · Team Leader',
    timeDisplay: '09:20 AM',
    timestamp: now - 97 * minute,
    vendor: 'Smart Infra',
    workers: 4,
  },
  {
    id: 'rev-06',
    initials: 'J',
    location: 'Tongi-GZ-204',
    photos: 5,
    status: 'waiting',
    teamLead: 'Jalal Uddin · Team Leader',
    timeDisplay: '08:50 AM',
    timestamp: now - 127 * minute,
    vendor: 'SpeedNet Ltd',
    workers: 2,
  },
  {
    id: 'rev-07',
    initials: 'N',
    location: 'Dhanmondi-DH-015',
    photos: 11,
    status: 'waiting',
    teamLead: 'Nazmul Haque · Team Leader',
    timeDisplay: 'Yesterday',
    timeKey: 'yesterday',
    timestamp: now - 1 * day - 2 * hour,
    vendor: 'Echo Telecom',
    workers: 6,
  },

  // 2. Safe / Completed reviews (reviewed)
  {
    id: 'rev-08',
    initials: 'K',
    location: 'Dhaka-ER-231',
    photos: 6,
    status: 'reviewed',
    teamLead: 'Karim Hasan · Team Leader',
    teamLeadKey: 'karimLead',
    timeDisplay: '10:18 AM',
    timeKey: 'time1018',
    timestamp: now - 39 * minute,
    vendor: 'XYZ Networks',
    workers: 3,
  },
  {
    id: 'rev-09',
    initials: 'S',
    location: 'Narayanganj-ER-087',
    photos: 10,
    status: 'reviewed',
    teamLead: 'Shakib Ahmed · Team Leader',
    teamLeadKey: 'shakibLead',
    timeDisplay: 'Yesterday',
    timeKey: 'yesterday',
    timestamp: now - 1 * day - 4 * hour,
    vendor: 'ABC Telecom',
    workers: 5,
  },
  {
    avatar: 'MK',
    id: 'rev-10',
    location: 'Savar-DH-501',
    photos: 8,
    status: 'reviewed',
    teamLead: 'Monir Khan · Team Leader',
    timeDisplay: 'Yesterday',
    timeKey: 'yesterday',
    timestamp: now - 1 * day - 6 * hour,
    vendor: 'Vertex Tower',
    workers: 4,
  },

  // 3. Unsafe reviews (marked unsafe by reviewer with reasons)
  {
    avatar: 'TA',
    id: 'rev-unsafe-01',
    location: 'Banani-DH-088',
    otherReasonText: 'Chinstrap of helmet was unbuckled during climb',
    photos: 6,
    status: 'unsafe',
    teamLead: 'Tanvir Ahmed · Team Leader',
    timeDisplay: 'Today, 11:15 AM',
    timestamp: now - 90 * minute,
    unsafeReasons: ['helmet', 'lanyard', 'other'],
    vendor: 'Sigma Tech',
    workers: 3,
  },
  {
    id: 'rev-unsafe-02',
    initials: 'J',
    location: 'Mirpur-DH-044',
    otherReasonText: 'Lanyard carabiner not locked to anchor point',
    photos: 8,
    status: 'unsafe',
    teamLead: 'Jalal Uddin · Team Leader',
    timeDisplay: 'Yesterday, 04:20 PM',
    timestamp: now - 1 * day - 3 * hour,
    unsafeReasons: ['harness', 'anchorage', 'other'],
    vendor: 'SpeedNet Ltd',
    workers: 4,
  },
];

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeReviews(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAllReviews(): ReviewItem[] {
  return [...reviews].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Returns pending reviews ONLY (waiting for review), sorted chronologically (latest time first).
 */
export function getPendingReviews(): ReviewItem[] {
  return reviews
    .filter((item) => item.status === 'waiting')
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Returns recent pending reviews ONLY (up to max limit, default 5).
 */
export function getRecentPendingReviews(limit = 5): ReviewItem[] {
  return getPendingReviews().slice(0, limit);
}

/**
 * Returns safe/reviewed reviews ONLY, sorted chronologically (latest time first).
 */
export function getSafeReviews(): ReviewItem[] {
  return reviews
    .filter((item) => item.status === 'reviewed')
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Returns unsafe reviews ONLY, sorted chronologically (latest time first).
 */
export function getUnsafeReviews(): ReviewItem[] {
  return reviews
    .filter((item) => item.status === 'unsafe')
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Mark a review as reviewed/safe.
 */
export function markReviewReviewed(id: string) {
  reviews = reviews.map((item) => {
    if (item.id === id) {
      return {
        ...item,
        status: 'reviewed',
        timestamp: Date.now(),
      };
    }
    return item;
  });
  notify();
}

/**
 * Mark a review as unsafe with specified reasons and notes.
 */
export function markReviewUnsafe(id: string, reasons: string[], customReason?: string) {
  reviews = reviews.map((item) => {
    if (item.id === id) {
      return {
        ...item,
        otherReasonText: customReason,
        status: 'unsafe',
        timestamp: Date.now(),
        unsafeReasons: reasons,
      };
    }
    return item;
  });
  notify();
}

/**
 * React hook providing reactive access to reviewer reviews
 */
export function useReviews() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeReviews(() => {
      setTick((t) => t + 1);
    });
    return unsubscribe;
  }, []);

  const pending = getPendingReviews();
  const safe = getSafeReviews();
  const unsafe = getUnsafeReviews();
  const recentPending = getRecentPendingReviews(5);

  return {
    allReviews: getAllReviews(),
    markReviewReviewed,
    markReviewUnsafe,
    pendingReviews: pending,
    recentPendingReviews: recentPending,
    safeReviews: safe,
    unsafeReviews: unsafe,
  };
}
