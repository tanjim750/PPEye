import { supabase } from "@/services/supabase/client";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState } from "react-native";
import { authStore } from "@/stores/auth.store";
import { createRefCountedSubscription } from "@/services/realtime/refCountedSubscription";
import { computeReviewsSignature } from "./reviewSignature";
import { persistCompletedSubmissionReview, persistReviewerDraft } from "./reviewPersistence";
import { isDemoMode } from "@/constants/devMode";

export type WorkerReviewVerdict = {
  sequenceNo: number;
  workerName?: string;
  status: "safe" | "unsafe";
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
  status: "waiting" | "reviewed" | "unsafe";
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
  draftReviewerId?: number;
  isDemo?: boolean;
};

export const unsafeReasonLabels: Record<string, string> = {
  anchorage: "Anchorage / connection",
  harness: "Full-body harness",
  helmet: "Helmet",
  lanyard: "Lanyard",
  other: "Other violation",
  shoes: "Safety shoes",
};

export const reasonIcons: Record<
  string,
  { ios: string; android: string; web: string }
> = {
  anchorage: { ios: "anchor", android: "anchor", web: "anchor" },
  harness: {
    ios: "figure.stand",
    android: "accessibility_new",
    web: "accessibility_new",
  },
  helmet: {
    ios: "wrench.and.screwdriver",
    android: "construction",
    web: "construction",
  },
  lanyard: { ios: "link", android: "link", web: "link" },
  other: { ios: "ellipsis", android: "more_horiz", web: "more_horiz" },
  shoes: {
    ios: "shoeprints.fill",
    android: "directions_walk",
    web: "directions_walk",
  },
};

const now = Date.now();
const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

// Initial state: Pending reviews (status === 'waiting'), Safe (status === 'reviewed'), and Unsafe (status === 'unsafe')
const demoReviews = [
  // 1. Pending for review (waiting)
  {
    isDemo: true,
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
    isDemo: true,
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
    isDemo: true,
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
    isDemo: true,
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
    isDemo: true,
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
    isDemo: true,
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
    isDemo: true,
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
    isDemo: true,
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
    isDemo: true,
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
    isDemo: true,
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
    isDemo: true,
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
    isDemo: true,
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
] satisfies ReviewItem[];


let reviews: ReviewItem[] = isDemoMode ? [...demoReviews] : [];

const listeners = new Set<() => void>();
let appStateSubscription: { remove: () => void } | null = null;
let reviewsSyncInterval: ReturnType<typeof setInterval> | null = null;

function stopReviewsPolling() {
  if (reviewsSyncInterval) clearInterval(reviewsSyncInterval);
  reviewsSyncInterval = null;
}

function canSyncReviewsWhileFocused() {
  return listeners.size > 0 && AppState.currentState === "active";
}

function syncReviewsWhileFocused() {
  if (canSyncReviewsWhileFocused()) void syncReviewsFromSupabase();
}

function startReviewsPolling() {
  if (listeners.size === 0 || AppState.currentState !== "active" || reviewsSyncInterval) return;
  reviewsSyncInterval = setInterval(syncReviewsWhileFocused, 15000);
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeReviews(listener: () => void) {
  listeners.add(listener);
  const releaseRealtime = reviewsRealtimeRefs.acquire();
  return () => {
    listeners.delete(listener);
    releaseRealtime();
  };
}

export function sortReviewsWithRealFirst(items: ReviewItem[]): ReviewItem[] {
  return [...items].sort((a, b) => {
    // 1. Real database submissions ALWAYS come before mock items!
    // Mock items must NEVER appear above any real submission or draft.
    const aIsReal = !isNaN(Number(a.id));
    const bIsReal = !isNaN(Number(b.id));
    if (aIsReal && !bIsReal) return -1;
    if (!aIsReal && bIsReal) return 1;

    // 2. Most recent event timestamp ALWAYS comes first!
    // - When a vendor submits: its timestamp is Date.now() -> goes straight to #1 (top of Recent)!
    // - When a reviewer leaves mid-review: its draft timestamp is Date.now() -> goes straight to #1 (top of Pending & Recent)!
    const timeA = a.timestamp || 0;
    const timeB = b.timestamp || 0;
    if (timeA !== timeB) {
      return timeB - timeA;
    }

    // 3. Tie-breaker: If timestamps are identical, in-progress draft takes priority
    if (a.isDraft && !b.isDraft) return -1;
    if (!a.isDraft && b.isDraft) return 1;

    return 0;
  });
}

export function getAllReviews(): ReviewItem[] {
  return sortReviewsWithRealFirst(reviews);
}

/**
 * Returns pending reviews ONLY (waiting for review), sorted with drafts and real DB submissions first.
 */
export function getPendingReviews(): ReviewItem[] {
  return sortReviewsWithRealFirst(
    reviews.filter((item) => item.status === "waiting"),
  );
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
  const reviewerId = Number(authStore.user?.id);
  return reviews.filter(
    (item) => item.isDraft === true && item.status === "waiting" && (!Number.isFinite(reviewerId) || item.draftReviewerId === reviewerId),
  );
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
    const timeA =
      typeof a.timestamp === "number" && !isNaN(a.timestamp) ? a.timestamp : 0;
    const timeB =
      typeof b.timestamp === "number" && !isNaN(b.timestamp) ? b.timestamp : 0;
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
      if (item.isDraft || item.status === "waiting") return false;

      // If item has workerReviews, check if at least one worker is safe
      if (item.workerReviews && item.workerReviews.length > 0) {
        return item.workerReviews.some((w) => w.status === "safe");
      }

      // Fallback for legacy items without workerReviews array
      return item.status === "reviewed";
    }),
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
      if (item.isDraft || item.status === "waiting") return false;

      // If item has workerReviews, check if at least one worker is unsafe
      if (item.workerReviews && item.workerReviews.length > 0) {
        return item.workerReviews.some((w) => w.status === "unsafe");
      }

      // Fallback for legacy items without workerReviews array
      return item.status === "unsafe";
    }),
  );
}

// Local draft tracking map so drafts are INSTANT and NEVER wiped out by Supabase syncing
const localDraftSubmissions = new Map<
  string,
  { workerReviews: WorkerReviewVerdict[]; timestamp: number; reviewerId?: number }
>();
const draftSaveQueues = new Map<string, Promise<{ success: boolean; error?: string }>>();

// Local completed tracking map so completed reviews appear INSTANTLY in Safe/Unsafe and are NEVER wiped out by premature Supabase syncing
export type LocalCompletedData = {
  status: "reviewed" | "unsafe";
  workerReviews: WorkerReviewVerdict[];
  unsafeReasons?: string[];
  otherReasonText?: string;
  timestamp: number;
};
const localCompletedSubmissions = new Map<string, LocalCompletedData>();

let isSyncing = false;
let hasPendingSync = false;
let realtimeSubscribed = false;
let lastReviewsSignature = "";

export async function syncReviewsFromSupabase() {
  if (authStore.user && authStore.user.category !== "INTERNAL" && authStore.user.role !== "reviewer") return;
  if (isSyncing) {
    hasPendingSync = true;
    return;
  }
  isSyncing = true;
  try {
    const { data, error } = await supabase
      .from("ppe_submissions")
      .select(
        `
        id,
        vendor_profile_id,
        site_name,
        status,
        metadata,
        submitted_at,
        created_at,
        updated_at,
        vendor_profiles (
          vendor_name,
          project_name
        ),
        ppe_worker_instances (
          id,
          sequence_no,
          ppe_reviews (
            id, verdict, reviewed_at,
            ppe_review_reasons ( note, unsafe_reasons ( code, label ) )
          ),
          ppe_images ( side, created_at )
        )
      `,
      )
      .order("created_at", { ascending: false })
      .limit(50);

    if (error || !data) {
      if (error) {
        console.warn("[reviews.service] syncReviewsFromSupabase query error:", error.message);
      }
      return;
    }

    const mappedItems: ReviewItem[] = data.map((sub: any) => {
      const createdTs = new Date(sub.submitted_at || sub.created_at).getTime();
      const updatedTs = sub.updated_at
        ? new Date(sub.updated_at).getTime()
        : createdTs;
      const meta = (sub.metadata || {}) as any;
      const workerCount = Array.isArray(sub.ppe_worker_instances)
        ? sub.ppe_worker_instances.length
        : Number(meta.totalWorkers) || 0;
      const photoCount = workerCount * 2;
      const vendorName = sub.vendor_profiles?.vendor_name || "Vendor";

      let mappedStatus: "waiting" | "reviewed" | "unsafe" = "waiting";
      let isDraft = false;
      const liveWorkerReviews: WorkerReviewVerdict[] = (sub.ppe_worker_instances || []).map((worker: any) => {
        const newestPhoto = Math.max(0, ...(worker.ppe_images || []).map((image: any) => new Date(image.created_at || 0).getTime()));
        const latestReview = [...(worker.ppe_reviews || [])].sort((a: any, b: any) => new Date(b.reviewed_at).getTime() - new Date(a.reviewed_at).getTime())[0];
        const isCurrent = latestReview && new Date(latestReview.reviewed_at).getTime() >= newestPhoto;
        const reasons = isCurrent ? (latestReview.ppe_review_reasons || []).map((reason: any) => reason.unsafe_reasons?.code?.toLowerCase()).filter(Boolean) : [];
        const notes = isCurrent ? (latestReview.ppe_review_reasons || []).map((reason: any) => reason.note).filter(Boolean).join("; ") : undefined;
        return { sequenceNo: Number(worker.sequence_no), workerName: `Worker ${worker.sequence_no}`, status: isCurrent && latestReview.verdict === "UNSAFE" ? "unsafe" : "safe", unsafeReasons: reasons, otherReasonText: notes, reviewedAt: isCurrent ? new Date(latestReview.reviewed_at).getTime() : undefined };
      }).filter((worker: any) => worker.reviewedAt !== undefined);
      const currentUnsafe = liveWorkerReviews.some((worker) => worker.status === "unsafe");
      const completeLiveReviews = liveWorkerReviews.length === workerCount;
      const currentMetadataReviews: WorkerReviewVerdict[] = (Array.isArray(meta.workerReviews) ? meta.workerReviews : []).filter((workerReview: any) => {
        const worker = (sub.ppe_worker_instances || []).find((item: any) => Number(item.sequence_no) === Number(workerReview.sequenceNo));
        const newestPhoto = Math.max(0, ...((worker?.ppe_images || []).map((image: any) => new Date(image.created_at || 0).getTime())));
        return Number(workerReview.reviewedAt || 0) >= newestPhoto && Number(workerReview.reviewedAt || 0) > 0;
      });
      const hasSupersededReview = (sub.ppe_worker_instances || []).some((worker: any) => {
        const latest = [...(worker.ppe_reviews || [])].sort((a: any, b: any) => new Date(b.reviewed_at || 0).getTime() - new Date(a.reviewed_at || 0).getTime())[0];
        const newestPhoto = Math.max(0, ...(worker.ppe_images || []).map((image: any) => new Date(image.created_at || 0).getTime()));
        const metaReview = (Array.isArray(meta.workerReviews) ? meta.workerReviews : []).find((item: any) => Number(item.sequenceNo) === Number(worker.sequence_no));
        return (latest && new Date(latest.reviewed_at || 0).getTime() < newestPhoto) || (metaReview && Number(metaReview.reviewedAt || 0) < newestPhoto);
      });
      const localCompleted = localCompletedSubmissions.get(String(sub.id));
      const localDraft = localDraftSubmissions.get(String(sub.id));
      const isLocallyDraft = Boolean(localDraft);

      if (localCompleted) {
        // Optimistic completed state is protected against premature sync
        mappedStatus = localCompleted.status;
        isDraft = false;
        // Clean up from local completed map once Supabase DB officially matches COMPLETED status
        if (
          sub.status === "COMPLETED" ||
          sub.status === "APPROVED" ||
          sub.status === "SAFE"
        ) {
          localCompletedSubmissions.delete(String(sub.id));
        }
      } else if (hasSupersededReview) {
        mappedStatus = "waiting";
        isDraft = false;
      } else if (completeLiveReviews) {
        mappedStatus = currentUnsafe ? "unsafe" : "reviewed";
      } else if (
        sub.status === "COMPLETED" ||
        sub.status === "APPROVED" ||
        sub.status === "SAFE"
      ) {
        if ((liveWorkerReviews.length > 0 && currentUnsafe) || meta.reviewResult === "unsafe" || meta.hasUnsafe) {
          mappedStatus = "unsafe";
        } else {
          mappedStatus = "reviewed";
        }
      } else if (sub.status === "UNSAFE" || sub.status === "ACTION_REQUIRED") {
        mappedStatus = "unsafe";
      } else if (sub.status === "UNDER_REVIEW" || isLocallyDraft) {
        mappedStatus = "waiting";
        isDraft = true;
      } else {
        mappedStatus = "waiting";
        isDraft = false;
      }

      // If draft, use the latest interaction timestamp (either localDraft timestamp or updated_at)
      const draftTs = localDraft?.timestamp || updatedTs;
      const finalTimestamp =
        localCompleted?.timestamp || (isDraft ? draftTs : createdTs);

      return {
        id: String(sub.id),
        avatar: vendorName.slice(0, 2).toUpperCase(),
        location: sub.site_name || "Site unavailable",
        photos: photoCount,
        status: mappedStatus,
        isDraft,
        teamLead: meta.teamLead || "Vendor team",
        timeDisplay: formatReviewTime({ timestamp: finalTimestamp }),
        timestamp: finalTimestamp,
        vendor: vendorName,
        workers: workerCount,
        workerReviews: localCompleted?.workerReviews || localDraft?.workerReviews || (liveWorkerReviews.length ? liveWorkerReviews : currentMetadataReviews.length ? currentMetadataReviews : (isDraft ? meta.reviewDraft?.workerReviews : undefined)),
        draftReviewerId: Number(meta.reviewDraft?.reviewerId) || undefined,
        unsafeReasons:
          localCompleted?.unsafeReasons ||
          meta.unsafeReasons ||
          meta.allUnsafeReasons ||
          undefined,
        otherReasonText:
          localCompleted?.otherReasonText ||
          meta.otherReasonText ||
          meta.combinedNotes ||
          undefined,
      };
    });

    // Merge Supabase submissions:
    // Any existing reviews with a numeric ID are replaced by the fresh database items.
    const demoItems = isDemoMode ? reviews.filter((item) => item.isDemo) : [];
    const nextReviews = sortReviewsWithRealFirst([...mappedItems, ...demoItems]);
    const nextSignature = computeReviewsSignature(nextReviews);
    if (nextSignature !== lastReviewsSignature) {
      lastReviewsSignature = nextSignature;
      reviews = nextReviews;
      notify();
    }
  } catch (err) {
    console.warn(
      "[reviews.service] Failed to sync reviews from Supabase:",
      err,
    );
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

const LIVE_SYNC_CHANNEL_NAME = "ppe_live_sync";
let liveSyncChannel: ReturnType<typeof supabase.channel> | null = null;

export function getLiveSyncChannel() {
  if (!liveSyncChannel) {
    liveSyncChannel = supabase.channel(LIVE_SYNC_CHANNEL_NAME, {
      config: {
        broadcast: { ack: true, self: true },
      },
    });

    // Attach listeners BEFORE subscribing so incoming broadcasts and DB events are never missed
    liveSyncChannel
      .on("broadcast", { event: "new_submission" }, (payload) => {
        console.log(
          "[reviews.service] Received live broadcast new_submission:",
          payload,
        );
        syncReviewsWhileFocused();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ppe_submissions" },
        (payload) => {
          console.log(
            "[reviews.service] Postgres change on ppe_submissions:",
            payload,
          );
          syncReviewsWhileFocused();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ppe_images" },
        () => {
          syncReviewsWhileFocused();
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "ppe_reviews" }, () => { void syncReviewsWhileFocused(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "ppe_review_reasons" }, () => { void syncReviewsWhileFocused(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "submission_reviews" }, () => { void syncReviewsWhileFocused(); })
      .subscribe((status) => {
        console.log("[reviews.service] Live sync channel status:", status);
        if (status === "SUBSCRIBED") void syncReviewsWhileFocused();
      });

    realtimeSubscribed = true;
  }
  return liveSyncChannel;
}

export async function broadcastNewSubmission(submissionId?: number | string) {
  try {
    const channel = getLiveSyncChannel();

    // 1. Send broadcast via WebSocket channel
    try {
      await channel.send({
        type: "broadcast",
        event: "new_submission",
        payload: { submissionId, timestamp: Date.now() },
      });
    } catch (wsErr) {
      console.warn(
        "[reviews.service] WebSocket send error, using REST fallback:",
        wsErr,
      );
    }

    // 2. Also send via HTTP REST broadcast for 100% guaranteed delivery across mobile devices
    if (typeof (channel as any).httpSend === "function") {
      try {
        await (channel as any).httpSend("new_submission", {
          submissionId,
          timestamp: Date.now(),
        });
      } catch (httpErr) {
        console.warn("[reviews.service] httpSend error:", httpErr);
      }
    }

    // 3. Immediate local sync on sending device
    syncReviewsFromSupabase();
  } catch (err) {
    console.warn("[reviews.service] Error broadcasting new submission:", err);
  }
}

export function setupReviewsRealtimeSubscription() {
  // getLiveSyncChannel() initializes and subscribes with both broadcast and postgres_changes
  getLiveSyncChannel();
}

const reviewsRealtimeRefs = createRefCountedSubscription(() => {
  setupReviewsRealtimeSubscription();
  appStateSubscription = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      startReviewsPolling();
      syncReviewsWhileFocused();
    } else {
      stopReviewsPolling();
    }
  });
  startReviewsPolling();
  return () => {
    appStateSubscription?.remove();
    appStateSubscription = null;
    stopReviewsPolling();
    if (liveSyncChannel) void supabase.removeChannel(liveSyncChannel);
    liveSyncChannel = null;
    realtimeSubscribed = false;
  };
});

/**
 * Mark a review as reviewed/safe.
 */
export function markReviewReviewed(id: string) {
  localDraftSubmissions.delete(String(id));
  const nowTs = Date.now();
  localCompletedSubmissions.set(String(id), {
    status: "reviewed",
    workerReviews: [],
    timestamp: nowTs,
  });

  reviews = reviews.map((item) => {
    if (String(item.id) === String(id)) {
      return {
        ...item,
        status: "reviewed",
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
    (async () => {
      try {
        const { error } = await supabase
          .from("ppe_submissions")
          .update({
            status: "COMPLETED",
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", numId);

        if (error) {
          console.warn(
            "[reviews.service] Error updating submission to COMPLETED:",
            error.message,
          );
        } else {
          broadcastNewSubmission(numId);
        }
      } catch (err) {
        console.warn("[reviews.service] Exception in markReviewReviewed:", err);
      }
    })();
  }
}

/**
 * Mark a review as unsafe with specified reasons and notes.
 */
export function markReviewUnsafe(
  id: string,
  reasons: string[],
  customReason?: string,
) {
  localDraftSubmissions.delete(String(id));
  const nowTs = Date.now();
  localCompletedSubmissions.set(String(id), {
    status: "unsafe",
    workerReviews: [],
    unsafeReasons: reasons,
    otherReasonText: customReason,
    timestamp: nowTs,
  });

  reviews = reviews.map((item) => {
    if (String(item.id) === String(id)) {
      return {
        ...item,
        otherReasonText: customReason,
        status: "unsafe",
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
    (async () => {
      try {
        const { error } = await supabase
          .from("ppe_submissions")
          .update({
            status: "UNDER_REVIEW",
            updated_at: new Date().toISOString(),
          })
          .eq("id", numId);

        if (error) {
          console.warn(
            "[reviews.service] Error updating submission to UNDER_REVIEW:",
            error.message,
          );
        } else {
          broadcastNewSubmission(numId);
        }
      } catch (err) {
        console.warn("[reviews.service] Exception in markReviewUnsafe:", err);
      }
    })();
  }
}

/**
 * Save in-progress / draft review when reviewer exits before completing all workers.
 * Keeps status as 'waiting' so it stays in Pending and Recent,
 * marks isDraft: true, and updates timestamp to Date.now() so it moves to the VERY TOP of the queue!
 */
export async function saveDraftSubmissionReview(
  id: string,
  workerVerdicts: WorkerReviewVerdict[],
): Promise<{ success: boolean; error?: string }> {
  const knownDraftOwner = reviews.find((item) => item.id === String(id))?.draftReviewerId;
  const knownDraft = reviews.find((item) => item.id === String(id))?.isDraft === true;
  let reviewerId = Number(authStore.user?.id);
  if (knownDraftOwner && knownDraftOwner !== reviewerId) {
    return { success: false, error: "This review draft belongs to another reviewer." };
  }
  if (!Number.isFinite(reviewerId) || reviewerId <= 0 || authStore.user?.category !== "INTERNAL") {
    const { data: internalUser } = await supabase
      .from("users")
      .select("id")
      .eq("category", "INTERNAL")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (internalUser?.id) {
      reviewerId = internalUser.id;
    }
  }
  if (!Number.isFinite(reviewerId) || reviewerId <= 0) {
    reviewerId = 1;
  }
  if (!knownDraft && getInProgressCount() >= 3) {
    return { success: false, error: "You already have three in-progress reviews. Complete or leave one before starting another." };
  }
  const nowTs = Date.now();
  const updateLocalDraft = () => {
    localDraftSubmissions.set(String(id), {
      workerReviews: workerVerdicts,
      timestamp: nowTs,
      reviewerId: reviewerId || undefined,
    });
    reviews = sortReviewsWithRealFirst(reviews.map((item) => item.id === String(id)
      ? {
          ...item,
          status: "waiting",
          isDraft: true,
          draftReviewerId: reviewerId || undefined,
          workerReviews: workerVerdicts,
          timestamp: nowTs,
          timeDisplay: formatReviewTime({ timestamp: nowTs }),
        }
      : item));
    notify();
  };

  if (String(id).startsWith("rev-")) {
    updateLocalDraft();
    return { success: true };
  }

  const numId = Number(id);
  if (!Number.isFinite(numId) || numId <= 0) {
    if (!String(id).startsWith("rev-")) {
      return { success: false, error: "This review draft does not have a valid submission ID." };
    }
    updateLocalDraft();
    return { success: true };
  }

  const key = String(numId);
  const previousWrite = draftSaveQueues.get(key) || Promise.resolve({ success: true });
  const nextWrite = previousWrite.catch(() => ({ success: false, error: "Previous draft save failed." })).then(async () => {
    const result = await persistReviewerDraft(supabase, numId, reviewerId, workerVerdicts);
    if (!result.success) return result;
    try {
      updateLocalDraft();
      await broadcastNewSubmission(numId);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save reviewer draft.";
      console.warn("[reviews.service] Error persisting reviewer draft:", error);
      return { success: false, error: message };
    }
  });
  draftSaveQueues.set(key, nextWrite);
  void nextWrite.then(() => {
    if (draftSaveQueues.get(key) === nextWrite) draftSaveQueues.delete(key);
  });
  return nextWrite;
}

/**
 * Finalize an entire submission review after reviewing all workers.
 * Records each worker's verdict, calculates combined status, and updates Supabase if real.
 */
export async function completeSubmissionReview(
  id: string,
  workerVerdicts: WorkerReviewVerdict[],
): Promise<{ success: boolean; error?: string }> {
  if (!workerVerdicts.length) return { success: false, error: "Review at least one worker before completing." };
  const invalidUnsafe = workerVerdicts.find((w) => w.status === "unsafe" && (!(w.unsafeReasons?.length) || (w.unsafeReasons.includes("other") && !w.otherReasonText?.trim())));
  if (invalidUnsafe) return { success: false, error: `Add an unsafe reason${invalidUnsafe.unsafeReasons?.includes("other") ? " and describe Other" : ""} for Worker ${invalidUnsafe.sequenceNo}.` };

  const hasUnsafe = workerVerdicts.some((w) => w.status === "unsafe");
  const allUnsafeReasons = Array.from(
    new Set(workerVerdicts.flatMap((w) => w.unsafeReasons || [])),
  );
  const combinedNotes = workerVerdicts
    .filter((w) => w.otherReasonText && w.status === "unsafe")
    .map((w) => `Worker ${w.sequenceNo}: ${w.otherReasonText}`)
    .join("; ");

  const completionTs = Date.now();
  const verdictStatus: "reviewed" | "unsafe" = hasUnsafe
    ? "unsafe"
    : "reviewed";

  const numId = Number(id);
  if (Number.isFinite(numId) && numId > 0) {
    let reviewerId = Number(authStore.user?.id);
    if (!Number.isFinite(reviewerId) || reviewerId <= 0 || authStore.user?.category !== "INTERNAL") {
      const { data: internalUser } = await supabase
        .from("users")
        .select("id")
        .eq("category", "INTERNAL")
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (internalUser?.id) {
        reviewerId = internalUser.id;
      } else {
        const { data: anyUser } = await supabase
          .from("users")
          .select("id")
          .order("id", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (anyUser?.id) reviewerId = anyUser.id;
      }
    }
    if (!Number.isFinite(reviewerId) || reviewerId <= 0) {
      return { success: false, error: "Your reviewer profile is missing. Sign in again before submitting this review." };
    }
    const existingDraft = reviews.find((item) => item.id === String(id))?.isDraft === true;
    if (!existingDraft && getInProgressCount() >= 3) {
      return { success: false, error: "You already have three in-progress reviews. Complete or leave one before starting another." };
    }
    const persistence = await persistCompletedSubmissionReview(supabase, numId, reviewerId, workerVerdicts);
    if (!persistence.success) return persistence;
    localDraftSubmissions.delete(String(id));
    localCompletedSubmissions.set(String(id), {
      status: verdictStatus,
      workerReviews: workerVerdicts,
      unsafeReasons: allUnsafeReasons,
      otherReasonText: combinedNotes,
      timestamp: completionTs,
    });
    reviews = reviews.map((item) => item.id === String(id)
      ? {
          ...item,
          status: verdictStatus,
          isDraft: false,
          workerReviews: workerVerdicts,
          unsafeReasons: allUnsafeReasons,
          otherReasonText: combinedNotes,
          timestamp: completionTs,
          timeDisplay: formatReviewTime({ timestamp: completionTs }),
        }
      : item);
    notify();
    await broadcastNewSubmission(numId);
    return { success: true };
  } else if (String(id).startsWith("rev-")) {
    localDraftSubmissions.delete(String(id));
    localCompletedSubmissions.set(String(id), {
      status: verdictStatus,
      workerReviews: workerVerdicts,
      unsafeReasons: allUnsafeReasons,
      otherReasonText: combinedNotes,
      timestamp: completionTs,
    });
    reviews = reviews.map((item) =>
      item.id === String(id)
        ? {
            ...item,
            status: verdictStatus,
            isDraft: false,
            workerReviews: workerVerdicts,
            unsafeReasons: allUnsafeReasons,
            otherReasonText: combinedNotes,
            timestamp: completionTs,
            timeDisplay: formatReviewTime({ timestamp: completionTs }),
          }
        : item
    );
    notify();
    return { success: true };
  }
  return { success: false, error: "This submission is unavailable." };
}

/**
 * React hook providing reactive access to reviewer reviews
 */
export function useReviews(enabled = true) {
  const [, setTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      // Refetch on focus; the shared subscription and fallback timer only exist while focused.
      void syncReviewsFromSupabase();
    const unsubscribe = subscribeReviews(() => {
      setTick((t) => t + 1);
    });
      return unsubscribe;
    }, [enabled]),
  );

  const pending = getPendingReviews();
  const safe = getSafeReviews();
  const unsafe = getUnsafeReviews();
  const recentPending = getRecentPendingReviews(5);
  const inProgress = getInProgressReviews();

  return {
    allReviews: enabled ? getAllReviews() : [],
    completeSubmissionReview,
    saveDraftSubmissionReview,
    markReviewReviewed,
    markReviewUnsafe,
    pendingReviews: enabled ? pending : [],
    realPendingCount: enabled ? pending.length : 0,
    recentPendingReviews: enabled ? recentPending : [],
    safeReviews: enabled ? safe : [],
    unsafeReviews: enabled ? unsafe : [],
    inProgressReviews: enabled ? inProgress : [],
    inProgressCount: enabled ? inProgress.length : 0,
    syncReviewsFromSupabase,
  };
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
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
export function formatReviewTime(item: {
  timestamp?: number;
  timeDisplay?: string;
}): string {
  if (
    item.timestamp &&
    typeof item.timestamp === "number" &&
    !isNaN(item.timestamp)
  ) {
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
  return item.timeDisplay || "10:42 AM";
}

/**
 * Formats a review timestamp dynamically:
 * - If today: "hh:mm A" (e.g. "06:29 PM" - per user request: "today hoile sudu time tai dekhabe")
 * - If yesterday: "Yesterday, hh:mm A"
 * - If earlier: "DD MMM, hh:mm A" (e.g. "18 Oct, 04:20 PM")
 */
export function formatReviewDateTime(item: {
  timestamp?: number;
  timeDisplay?: string;
}): string {
  if (
    item.timestamp &&
    typeof item.timestamp === "number" &&
    !isNaN(item.timestamp)
  ) {
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
    return item.timeDisplay.replace(/^Today,?\s*/i, "");
  }
  return "10:42 AM";
}
