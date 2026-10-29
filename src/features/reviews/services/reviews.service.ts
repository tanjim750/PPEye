import { supabase } from "@/services/supabase/client";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState } from "react-native";
import { authStore } from "@/stores/auth.store";
import { createRefCountedSubscription } from "@/services/realtime/refCountedSubscription";
import { computeReviewsSignature } from "./reviewSignature";
import { persistCompletedSubmissionReview, persistReviewerDraft } from "./reviewPersistence";
import { isDemoMode } from "@/constants/devMode";
import { broadcastReviewVerdictAlert } from "@/services/notifications/notification.service";

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

let reviews: ReviewItem[] = [];

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
let lastSyncTimestamp = 0;
const REVIEWS_SYNC_COOLDOWN_MS = 6000; // 6-second cooldown for routine focus syncs
let reviewsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeReviewsSyncPromise: Promise<void> | null = null;

export function debouncedSyncReviews() {
  if (reviewsDebounceTimer) clearTimeout(reviewsDebounceTimer);
  reviewsDebounceTimer = setTimeout(() => {
    void syncReviewsWhileFocused();
  }, 400);
}

export async function syncReviewsFromSupabase(options?: { force?: boolean }) {
  if (authStore.user && authStore.user.category !== "INTERNAL" && authStore.user.role !== "reviewer") return;

  const now = Date.now();
  // Throttle routine focus syncs unless explicitly forced (e.g. pull-to-refresh)
  if (!options?.force && now - lastSyncTimestamp < REVIEWS_SYNC_COOLDOWN_MS) {
    return activeReviewsSyncPromise || Promise.resolve();
  }

  if (isSyncing) {
    hasPendingSync = true;
    return activeReviewsSyncPromise || Promise.resolve();
  }
  isSyncing = true;
  lastSyncTimestamp = now;

  activeReviewsSyncPromise = (async () => {
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

    // Update with fresh Supabase submissions
    const nextReviews = sortReviewsWithRealFirst(mappedItems);
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
    activeReviewsSyncPromise = null;
    if (hasPendingSync) {
      hasPendingSync = false;
      setTimeout(() => {
        void syncReviewsFromSupabase();
      }, 100);
    }
  }
  })();

  return activeReviewsSyncPromise;
}

const LIVE_SYNC_CHANNEL_NAME = "ppe_live_sync";
let liveSyncChannel: ReturnType<typeof supabase.channel> | null = null;

export function getLiveSyncChannel() {
  if (!liveSyncChannel) {
    if (typeof supabase?.getChannels === 'function') {
      const existing = supabase.getChannels().find(
        (c) => c.topic === `realtime:${LIVE_SYNC_CHANNEL_NAME}`
      );
      if (existing) {
        if ((existing as any).state === 'joined' || (existing as any).state === 'joining') {
          liveSyncChannel = existing as any;
          realtimeSubscribed = true;
          return liveSyncChannel;
        }
        try {
          void supabase.removeChannel(existing);
        } catch {}
      }
    }

    liveSyncChannel = supabase.channel(LIVE_SYNC_CHANNEL_NAME, {
      config: {
        broadcast: { ack: true, self: true },
      },
    });

    // Attach listeners BEFORE subscribing so incoming broadcasts and DB events are never missed.
    // Realtime events are debounced so multiple table inserts coalesce into a single sync call!
    liveSyncChannel
      .on("broadcast", { event: "new_submission" }, (payload) => {
        debouncedSyncReviews();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ppe_submissions" },
        () => {
          debouncedSyncReviews();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ppe_images" },
        () => {
          debouncedSyncReviews();
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "ppe_reviews" }, () => { debouncedSyncReviews(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "ppe_review_reasons" }, () => { debouncedSyncReviews(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "submission_reviews" }, () => { debouncedSyncReviews(); })
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
    if (!channel) return;
    const payload = { submissionId, timestamp: Date.now() };

    const canPush =
      typeof (channel as any).canPush === "function"
        ? (channel as any).canPush()
        : Boolean((channel as any).channelAdapter?.canPush?.() ?? channel.state === "joined");

    if (canPush) {
      try {
        await channel.send({
          type: "broadcast",
          event: "new_submission",
          payload,
        });
      } catch (wsErr) {
        if (typeof (channel as any).httpSend === "function") {
          await (channel as any).httpSend("new_submission", payload).catch(() => {});
        }
      }
    } else if (typeof (channel as any).httpSend === "function") {
      // WebSocket is not connected or still connecting: use explicit httpSend to avoid deprecation warning
      try {
        await (channel as any).httpSend("new_submission", payload);
      } catch (httpErr) {
        // Fallback to channel.send if httpSend fails
        await channel.send({
          type: "broadcast",
          event: "new_submission",
          payload,
        }).catch(() => {});
      }
    } else {
      await channel.send({
        type: "broadcast",
        event: "new_submission",
        payload,
      }).catch(() => {});
    }

    // Immediate local sync on sending device
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
    // Do NOT destroy liveSyncChannel on temporary screen unmounts so background realtime sync stays connected
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
    const workerSummary = workerVerdicts
      .map((w) => `Worker #${w.sequenceNo}: ${w.status === 'safe' ? 'Safe' : `Unsafe (${(w.unsafeReasons || []).join(', ') || 'Violation'})`}`)
      .join('; ');

    notify();
    await broadcastNewSubmission(numId);
    const targetRev = reviews.find((r) => r.id === String(id));
    void broadcastReviewVerdictAlert({
      submissionId: numId,
      siteName: targetRev?.location || 'Site',
      vendorName: targetRev?.vendor,
      verdict: verdictStatus,
      hasUnsafe,
      workerCount: workerVerdicts.length,
      workerSummary,
      unsafeReasons: allUnsafeReasons,
      notes: combinedNotes,
    });
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
    const workerSummary = workerVerdicts
      .map((w) => `Worker #${w.sequenceNo}: ${w.status === 'safe' ? 'Safe' : `Unsafe (${(w.unsafeReasons || []).join(', ') || 'Violation'})`}`)
      .join('; ');
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
    const localTargetRev = reviews.find((r) => r.id === String(id));
    void broadcastReviewVerdictAlert({
      submissionId: id,
      siteName: localTargetRev?.location || 'Site',
      vendorName: localTargetRev?.vendor,
      verdict: verdictStatus,
      hasUnsafe,
      workerCount: workerVerdicts.length,
      workerSummary,
      unsafeReasons: allUnsafeReasons,
      notes: combinedNotes,
    });
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
