import { useEffect, useState } from 'react';
import { supabase } from '@/services/supabase/client';

export type WorkerReviewVerdict = {
  sequenceNo: number;
  workerName?: string;
  status: 'safe' | 'unsafe';
  unsafeReasons?: string[];
  otherReasonText?: string;
  frontUri?: string | null;
  backUri?: string | null;
  frontDriveId?: string | null;
  backDriveId?: string | null;
  reviewedAt?: number;
};

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
  workerReviews?: WorkerReviewVerdict[];
  isDraft?: boolean;
};

export const unsafeReasonLabels: Record<string, string> = {
  anchorage: 'Anchorage / connection',
  harness: 'Full-body harness',
  helmet: 'Helmet',
  lanyard: 'Lanyard',
  other: 'Other violation',
  shoes: 'Safety shoes',
};

export const reasonIcons: Record<string, { ios: string; android: string; web: string }> = {
  anchorage: { ios: 'anchor', android: 'anchor', web: 'anchor' },
  harness: { ios: 'figure.stand', android: 'accessibility_new', web: 'accessibility_new' },
  helmet: { ios: 'wrench.and.screwdriver', android: 'construction', web: 'construction' },
  lanyard: { ios: 'link', android: 'link', web: 'link' },
  other: { ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' },
  shoes: { ios: 'shoeprints.fill', android: 'directions_walk', web: 'directions_walk' },
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
    photos: 6,
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
    photos: 10,
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
    photos: 4,
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
    photos: 12,
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
    timeDisplay: '11:15 AM',
    timestamp: now - 90 * minute,
    unsafeReasons: ['helmet', 'lanyard', 'other'],
    vendor: 'Sigma Tech',
    workers: 3,
    workerReviews: [
      {
        sequenceNo: 1,
        workerName: 'Worker 1',
        status: 'unsafe',
        unsafeReasons: ['helmet', 'other'],
        otherReasonText: 'Chinstrap of helmet was unbuckled during climb',
      },
      {
        sequenceNo: 2,
        workerName: 'Worker 2',
        status: 'safe',
      },
      {
        sequenceNo: 3,
        workerName: 'Worker 3',
        status: 'unsafe',
        unsafeReasons: ['lanyard', 'anchorage'],
        otherReasonText: 'Lanyard carabiner not locked to anchor point',
      },
    ],
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
    workerReviews: [
      {
        sequenceNo: 1,
        workerName: 'Worker 1',
        status: 'unsafe',
        unsafeReasons: ['harness', 'other'],
        otherReasonText: 'Harness leg straps loose',
      },
      {
        sequenceNo: 2,
        workerName: 'Worker 2',
        status: 'unsafe',
        unsafeReasons: ['anchorage'],
        otherReasonText: 'Not anchored to certified point',
      },
      {
        sequenceNo: 3,
        workerName: 'Worker 3',
        status: 'safe',
      },
      {
        sequenceNo: 4,
        workerName: 'Worker 4',
        status: 'unsafe',
        unsafeReasons: ['shoes'],
        otherReasonText: 'Normal sneakers worn instead of safety shoes',
      },
    ],
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

export function sortReviewsWithRealFirst(items: ReviewItem[]): ReviewItem[] {
  return [...items].sort((a, b) => {
    // 1. In-progress drafts should be at the very top of pending
    if (a.isDraft && !b.isDraft) return -1;
    if (!a.isDraft && b.isDraft) return 1;

    // 2. Real database submissions ALWAYS come before mock items
    const aIsReal = !isNaN(Number(a.id));
    const bIsReal = !isNaN(Number(b.id));
    if (aIsReal && !bIsReal) return -1;
    if (!aIsReal && bIsReal) return 1;

    // 3. Newest timestamp first
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
}

export function getAllReviews(): ReviewItem[] {
  return sortReviewsWithRealFirst(reviews);
}

/**
 * Returns pending reviews ONLY (waiting for review), sorted with drafts and real DB submissions first.
 */
export function getPendingReviews(): ReviewItem[] {
  return sortReviewsWithRealFirst(reviews.filter((item) => item.status === 'waiting'));
}

/**
 * Returns recent pending reviews ONLY (up to max limit, default 5).
 * Real vendor submissions are guaranteed to be in the top slots!
 */
export function getRecentPendingReviews(limit = 5): ReviewItem[] {
  return getPendingReviews().slice(0, limit);
}

/**
 * Returns in-progress draft reviews currently being reviewed.
 */
export function getInProgressReviews(): ReviewItem[] {
  return reviews.filter((item) => item.isDraft === true && item.status === 'waiting');
}

/**
 * Returns current count of in-progress draft reviews.
 */
export function getInProgressCount(): number {
  return getInProgressReviews().length;
}

/**
 * Sort reviews strictly chronologically (latest timestamp first).
 * Used for History (Safe & Unsafe reviewed lists) where items must strictly follow clock time.
 */
export function sortReviewsChronologically(items: ReviewItem[]): ReviewItem[] {
  return [...items].sort((a, b) => {
    const timeA = typeof a.timestamp === 'number' && !isNaN(a.timestamp) ? a.timestamp : 0;
    const timeB = typeof b.timestamp === 'number' && !isNaN(b.timestamp) ? b.timestamp : 0;
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

/**
 * Returns safe/reviewed reviews, sorted chronologically (latest time first).
 * Includes any completed review that has at least one safe worker.
 */
export function getSafeReviews(): ReviewItem[] {
  return sortReviewsChronologically(
    reviews.filter((item) => {
      // Must not be draft or in-progress
      if (item.isDraft || item.status === 'waiting') return false;

      // If item has workerReviews, check if at least one worker is safe
      if (item.workerReviews && item.workerReviews.length > 0) {
        return item.workerReviews.some((w) => w.status === 'safe');
      }

      // Fallback for legacy items without workerReviews array
      return item.status === 'reviewed';
    })
  );
}

/**
 * Returns unsafe reviews, sorted chronologically (latest time first).
 * Includes any completed review that has at least one unsafe worker.
 */
export function getUnsafeReviews(): ReviewItem[] {
  return sortReviewsChronologically(
    reviews.filter((item) => {
      // Must not be draft or in-progress
      if (item.isDraft || item.status === 'waiting') return false;

      // If item has workerReviews, check if at least one worker is unsafe
      if (item.workerReviews && item.workerReviews.length > 0) {
        return item.workerReviews.some((w) => w.status === 'unsafe');
      }

      // Fallback for legacy items without workerReviews array
      return item.status === 'unsafe';
    })
  );
}

// Local draft tracking map so drafts are INSTANT and NEVER wiped out by Supabase syncing
const localDraftSubmissions = new Map<string, { workerReviews: WorkerReviewVerdict[]; timestamp: number }>();

let isSyncing = false;
let hasPendingSync = false;
let realtimeSubscribed = false;

export async function syncReviewsFromSupabase() {
  if (isSyncing) {
    hasPendingSync = true;
    return;
  }
  isSyncing = true;
  try {
    const { data, error } = await supabase
      .from('ppe_submissions')
      .select(`
        id,
        vendor_profile_id,
        site_name,
        status,
        metadata,
        submitted_at,
        created_at,
        vendor_profiles (
          vendor_name,
          project_name
        ),
        ppe_worker_instances (
          id,
          sequence_no
        )
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data) {
      return;
    }

    const mappedItems: ReviewItem[] = data.map((sub: any) => {
      const ts = new Date(sub.submitted_at || sub.created_at).getTime();
      const workerCount = Array.isArray(sub.ppe_worker_instances)
        ? Math.max(1, sub.ppe_worker_instances.length)
        : 1;
      const photoCount = workerCount * 2;
      const vendorName =
        sub.vendor_profiles?.vendor_name || 'ABC Telecom';

      let mappedStatus: 'waiting' | 'reviewed' | 'unsafe' = 'waiting';
      let isDraft = false;
      const meta = (sub.metadata || {}) as any;
      const localDraft = localDraftSubmissions.get(String(sub.id));
      const isLocallyDraft = Boolean(localDraft);

      if (sub.status === 'COMPLETED' || sub.status === 'APPROVED' || sub.status === 'SAFE') {
        if (meta.reviewResult === 'unsafe' || meta.hasUnsafe) {
          mappedStatus = 'unsafe';
        } else {
          mappedStatus = 'reviewed';
        }
      } else if (sub.status === 'UNSAFE' || sub.status === 'ACTION_REQUIRED') {
        mappedStatus = 'unsafe';
      } else if (sub.status === 'UNDER_REVIEW' || isLocallyDraft) {
        mappedStatus = 'waiting';
        isDraft = true;
      } else {
        mappedStatus = 'waiting';
        isDraft = false;
      }

      const finalTimestamp = localDraft?.timestamp || (isDraft ? (localDraft?.timestamp || ts) : ts);

      return {
        id: String(sub.id),
        avatar: vendorName.slice(0, 2).toUpperCase(),
        location: sub.site_name || 'Site-01',
        photos: photoCount,
        status: mappedStatus,
        isDraft,
        teamLead: meta.teamLead || 'Rahim Mia · Team Leader',
        timeDisplay: formatReviewTime({ timestamp: finalTimestamp }),
        timestamp: finalTimestamp,
        vendor: vendorName,
        workers: workerCount,
        workerReviews: localDraft?.workerReviews || meta.workerReviews || undefined,
        unsafeReasons: meta.unsafeReasons || undefined,
        otherReasonText: meta.otherReasonText || undefined,
      };
    });

    // Merge Supabase submissions:
    // Any existing reviews with a numeric ID are replaced by the fresh database items.
    // Non-numeric items (e.g. mock baseline items) are preserved underneath, strictly excluding ghost IDs.
    const initialMockIds = new Set([
      'rev-01',
      'rev-02',
      'rev-03',
      'rev-04',
      'rev-05',
      'rev-unsafe-01',
      'rev-unsafe-02',
    ]);
    const nonDbReviews = reviews.filter((r) => initialMockIds.has(r.id));
    reviews = sortReviewsWithRealFirst([...mappedItems, ...nonDbReviews]);
    notify();
  } catch (err) {
    console.warn('[reviews.service] Failed to sync reviews from Supabase:', err);
  } finally {
    isSyncing = false;
    if (hasPendingSync) {
      hasPendingSync = false;
      setTimeout(() => {
        syncReviewsFromSupabase();
      }, 50);
    }
  }
}

const LIVE_SYNC_CHANNEL_NAME = 'ppe_live_sync';
let liveSyncChannel: ReturnType<typeof supabase.channel> | null = null;

export function getLiveSyncChannel() {
  if (!liveSyncChannel) {
    liveSyncChannel = supabase.channel(LIVE_SYNC_CHANNEL_NAME, {
      config: {
        broadcast: { ack: false, self: true },
      },
    });
  }
  return liveSyncChannel;
}

export function broadcastNewSubmission(submissionId?: number | string) {
  try {
    const channel = getLiveSyncChannel();
    channel.send({
      type: 'broadcast',
      event: 'new_submission',
      payload: { submissionId, timestamp: Date.now() },
    });
    // Also trigger immediate local sync
    syncReviewsFromSupabase();
  } catch (err) {
    console.warn('[reviews.service] Error broadcasting new submission:', err);
  }
}

export function setupReviewsRealtimeSubscription() {
  if (realtimeSubscribed) return;
  try {
    const channel = getLiveSyncChannel();
    channel
      .on('broadcast', { event: 'new_submission' }, (payload) => {
        console.log('[reviews.service] Received live broadcast new_submission:', payload);
        syncReviewsFromSupabase();
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ppe_submissions' },
        () => {
          syncReviewsFromSupabase();
        }
      )
      .subscribe((status) => {
        console.log('[reviews.service] Live sync channel status:', status);
      });
    realtimeSubscribed = true;
  } catch (err) {
    console.warn('[reviews.service] Realtime subscription error:', err);
  }
}

// Trigger initial sync on file load and keep syncing periodically for cross-phone live updates
if (typeof setTimeout !== 'undefined') {
  setTimeout(() => {
    syncReviewsFromSupabase();
    setupReviewsRealtimeSubscription();
  }, 50);
}

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    syncReviewsFromSupabase();
  }, 3000);
}

/**
 * Mark a review as reviewed/safe.
 */
export function markReviewReviewed(id: string) {
  localDraftSubmissions.delete(String(id));
  const nowTs = Date.now();
  reviews = reviews.map((item) => {
    if (String(item.id) === String(id)) {
      return {
        ...item,
        status: 'reviewed',
        isDraft: false,
        timestamp: nowTs,
        timeDisplay: formatReviewTime({ timestamp: nowTs }),
      };
    }
    return item;
  });
  notify();

  const numId = Number(id);
  if (!isNaN(numId) && numId > 0) {
    supabase
      .from('ppe_submissions')
      .update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', numId)
      .then(({ error }) => {
        if (error) {
          console.warn('[reviews.service] Error updating submission to COMPLETED:', error.message);
        } else {
          broadcastNewSubmission(numId);
        }
      });
  }
}

/**
 * Mark a review as unsafe with specified reasons and notes.
 */
export function markReviewUnsafe(id: string, reasons: string[], customReason?: string) {
  localDraftSubmissions.delete(String(id));
  const nowTs = Date.now();
  reviews = reviews.map((item) => {
    if (String(item.id) === String(id)) {
      return {
        ...item,
        otherReasonText: customReason,
        status: 'unsafe',
        isDraft: false,
        timestamp: nowTs,
        timeDisplay: formatReviewTime({ timestamp: nowTs }),
        unsafeReasons: reasons,
      };
    }
    return item;
  });
  notify();

  const numId = Number(id);
  if (!isNaN(numId) && numId > 0) {
    supabase
      .from('ppe_submissions')
      .update({
        status: 'UNDER_REVIEW',
        updated_at: new Date().toISOString(),
      })
      .eq('id', numId)
      .then(({ error }) => {
        if (error) {
          console.warn('[reviews.service] Error updating submission to UNDER_REVIEW:', error.message);
        } else {
          broadcastNewSubmission(numId);
        }
      });
  }
}

/**
 * Save in-progress / draft review when reviewer exits before completing all workers.
 * Keeps status as 'waiting' so it stays in Pending and Recent,
 * marks isDraft: true, and updates timestamp to Date.now() so it moves to the VERY TOP of the queue!
 */
export function saveDraftSubmissionReview(
  id: string,
  workerVerdicts: WorkerReviewVerdict[]
) {
  const nowTs = Date.now();
  localDraftSubmissions.set(String(id), {
    workerReviews: workerVerdicts,
    timestamp: nowTs,
  });

  reviews = reviews.map((item) => {
    if (String(item.id) === String(id)) {
      return {
        ...item,
        status: 'waiting',
        isDraft: true,
        workerReviews: workerVerdicts,
        timestamp: nowTs,
        timeDisplay: formatReviewTime({ timestamp: nowTs }),
      };
    }
    return item;
  });
  // Re-sort with real and in-progress items at the top
  reviews = sortReviewsWithRealFirst(reviews);
  notify();

  const numId = Number(id);
  if (!isNaN(numId) && numId > 0) {
    supabase
      .from('ppe_submissions')
      .update({
        status: 'UNDER_REVIEW',
        updated_at: new Date().toISOString(),
      })
      .eq('id', numId)
      .then(({ error }) => {
        if (error) {
          console.warn('[reviews.service] Error updating submission to UNDER_REVIEW draft:', error.message);
        } else {
          broadcastNewSubmission(numId);
        }
      });
  }
}

/**
 * Finalize an entire submission review after reviewing all workers.
 * Records each worker's verdict, calculates combined status, and updates Supabase if real.
 */
export function completeSubmissionReview(
  id: string,
  workerVerdicts: WorkerReviewVerdict[]
) {
  localDraftSubmissions.delete(String(id));
  const hasUnsafe = workerVerdicts.some((w) => w.status === 'unsafe');
  const allUnsafeReasons = Array.from(
    new Set(workerVerdicts.flatMap((w) => w.unsafeReasons || []))
  );
  const combinedNotes = workerVerdicts
    .filter((w) => w.otherReasonText && w.status === 'unsafe')
    .map((w) => `Worker ${w.sequenceNo}: ${w.otherReasonText}`)
    .join('; ');

  const completionTs = Date.now();
  reviews = reviews.map((item) => {
    if (String(item.id) === String(id)) {
      return {
        ...item,
        isDraft: false,
        status: hasUnsafe ? 'unsafe' : 'reviewed',
        unsafeReasons: allUnsafeReasons.length > 0 ? allUnsafeReasons : item.unsafeReasons,
        otherReasonText: combinedNotes || item.otherReasonText,
        workerReviews: workerVerdicts,
        timestamp: completionTs,
        timeDisplay: formatReviewTime({ timestamp: completionTs }),
      };
    }
    return item;
  });
  notify();

  const numId = Number(id);
  if (!isNaN(numId) && numId > 0) {
    supabase
      .from('ppe_submissions')
      .update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
        metadata: {
          reviewResult: hasUnsafe ? 'unsafe' : 'safe',
          hasUnsafe,
          workerReviews: workerVerdicts,
          allUnsafeReasons,
          combinedNotes,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', numId)
      .then(({ error }) => {
        if (error) {
          console.warn('[reviews.service] Error updating submission:', error.message);
        } else {
          broadcastNewSubmission(numId);
        }
      });
  }
}

/**
 * React hook providing reactive access to reviewer reviews
 */
export function useReviews() {
  const [, setTick] = useState(0);

  useEffect(() => {
    syncReviewsFromSupabase();
    setupReviewsRealtimeSubscription();

    const unsubscribe = subscribeReviews(() => {
      setTick((t) => t + 1);
    });

    // Refresh display ticks every 30 seconds so relative timestamps update in real time
    const tickInterval = setInterval(() => {
      setTick((t) => t + 1);
    }, 30000);

    return () => {
      unsubscribe();
      clearInterval(tickInterval);
    };
  }, []);

  const pending = getPendingReviews();
  const safe = getSafeReviews();
  const unsafe = getUnsafeReviews();
  const recentPending = getRecentPendingReviews(5);
  const inProgress = getInProgressReviews();

  return {
    allReviews: getAllReviews(),
    completeSubmissionReview,
    saveDraftSubmissionReview,
    markReviewReviewed,
    markReviewUnsafe,
    pendingReviews: pending,
    recentPendingReviews: recentPending,
    safeReviews: safe,
    unsafeReviews: unsafe,
    inProgressReviews: inProgress,
    inProgressCount: inProgress.length,
    syncReviewsFromSupabase,
  };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isSameCalendarDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function isYesterdayDate(d: Date, now: Date): boolean {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return isSameCalendarDay(d, yesterday);
}

function formatClockTime(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const formattedHours = hours < 10 ? `0${hours}` : `${hours}`;
  return `${formattedHours}:${minutes} ${ampm}`;
}

/**
 * Formats a review timestamp dynamically for feed and list rows:
 * - If today: "hh:mm A" (e.g. "06:29 PM")
 * - If yesterday: "Yesterday, hh:mm A"
 * - If earlier: "DD MMM, hh:mm A" (e.g. "18 Oct, 04:20 PM")
 */
export function formatReviewTime(item: { timestamp?: number; timeDisplay?: string }): string {
  if (item.timestamp && typeof item.timestamp === 'number' && !isNaN(item.timestamp)) {
    const date = new Date(item.timestamp);
    const now = new Date();
    if (isSameCalendarDay(date, now)) {
      return formatClockTime(date);
    }
    if (isYesterdayDate(date, now)) {
      return `Yesterday, ${formatClockTime(date)}`;
    }
    const day = date.getDate();
    const month = MONTH_NAMES[date.getMonth()];
    return `${day} ${month}, ${formatClockTime(date)}`;
  }
  return item.timeDisplay || '10:42 AM';
}

/**
 * Formats a review timestamp dynamically:
 * - If today: "hh:mm A" (e.g. "06:29 PM" - per user request: "today hoile sudu time tai dekhabe")
 * - If yesterday: "Yesterday, hh:mm A"
 * - If earlier: "DD MMM, hh:mm A" (e.g. "18 Oct, 04:20 PM")
 */
export function formatReviewDateTime(item: { timestamp?: number; timeDisplay?: string }): string {
  if (item.timestamp && typeof item.timestamp === 'number' && !isNaN(item.timestamp)) {
    const date = new Date(item.timestamp);
    const now = new Date();
    if (isSameCalendarDay(date, now)) {
      return formatClockTime(date);
    }
    if (isYesterdayDate(date, now)) {
      return `Yesterday, ${formatClockTime(date)}`;
    }
    const day = date.getDate();
    const month = MONTH_NAMES[date.getMonth()];
    return `${day} ${month}, ${formatClockTime(date)}`;
  }
  if (item.timeDisplay) {
    return item.timeDisplay.replace(/^Today,?\s*/i, '');
  }
  return '10:42 AM';
}

export function createOrUpdatePendingReview(data: {
  location: string;
  photos: number;
  workers: number;
  teamLead?: string;
  timestamp?: number;
}) {
  const currentNow = data.timestamp || Date.now();
  const newReview: ReviewItem = {
    avatar: 'RM',
    id: `rev-${currentNow}-${Math.random().toString(36).slice(2, 6)}`,
    location: data.location,
    photos: data.photos || 2,
    status: 'waiting',
    teamLead: data.teamLead || 'Rahim Mia · Team Leader',
    timeDisplay: formatReviewTime({ timestamp: currentNow }),
    timestamp: currentNow,
    vendor: 'ABC Telecom',
    workers: data.workers || 1,
  };
  reviews = [newReview, ...reviews].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  notify();
}
