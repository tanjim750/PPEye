// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Supabase Edge Function: send-push-notification
 *
 * Delivers high-priority OS lock-screen push notifications via Expo Push API
 * when mobile devices are locked, in Doze/power-saver mode, or when the app is killed.
 *
 * Supports:
 * 1. Database Webhook on `ppe_submissions` INSERT -> Notifies all active INTERNAL Reviewers
 * 2. Database Webhook on `submission_reviews` INSERT/UPDATE -> Notifies the submitting Vendor
 * 3. Direct client/server invocation via `supabase.functions.invoke('send-push-notification', ...)`
 */

interface WebhookPayload {
  type?: "INSERT" | "UPDATE" | "DELETE";
  table?: string;
  schema?: string;
  record?: Record<string, any>;
  old_record?: Record<string, any>;
  // Direct invocation fields
  user_id?: number | string;
  recipient_user_id?: number | string;
  submitted_by?: number | string;
  role?: "reviewer" | "vendor";
  tokens?: string[];
  submission_id?: number | string;
  title?: string;
  body?: string;
  data?: Record<string, any>;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH_LIMIT = 100;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isValidExpoToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token.trim())
  );
}

function toPositiveInt(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const num = Number(String(val).trim());
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : null;
}

async function collectTokensForUserIds(
  supabase: any,
  rawUserIds: unknown[],
  excludeUserId?: number | null
): Promise<string[]> {
  const userIds = Array.from(
    new Set(
      rawUserIds
        .map((id) => toPositiveInt(id))
        .filter((id): id is number => id !== null && id !== excludeUserId)
    )
  );
  if (userIds.length === 0) return [];

  const tokens = new Set<string>();

  // 1. Multi-device active tokens from public.user_push_tokens
  try {
    const { data: tokenRows, error: tokenErr } = await supabase
      .from("user_push_tokens")
      .select("push_token")
      .in("user_id", userIds)
      .eq("is_active", true);

    if (!tokenErr && Array.isArray(tokenRows)) {
      for (const row of tokenRows) {
        if (isValidExpoToken(row?.push_token)) {
          tokens.add(row.push_token.trim());
        }
      }
    }
  } catch {
    // Gracefully fall back if user_push_tokens migration hasn't run yet
  }

  // 2. Legacy / mirrored column on public.users
  const { data: userRows } = await supabase
    .from("users")
    .select("id, expo_push_token")
    .in("id", userIds)
    .eq("is_active", true)
    .not("expo_push_token", "is", null);

  if (Array.isArray(userRows)) {
    for (const u of userRows) {
      if (isValidExpoToken(u?.expo_push_token)) {
        tokens.add(u.expo_push_token.trim());
      }
    }
  }

  return Array.from(tokens);
}

async function collectReviewerTokens(
  supabase: any,
  excludeUserId?: number | null
): Promise<string[]> {
  // IMPORTANT: Postgres enum `user_category` is strictly uppercase ('INTERNAL' | 'EXTERNAL')
  const { data: reviewers, error } = await supabase
    .from("users")
    .select("id, expo_push_token")
    .eq("category", "INTERNAL")
    .eq("is_active", true);

  if (error || !Array.isArray(reviewers) || reviewers.length === 0) {
    if (error) {
      console.error("[send-push-notification] Reviewer lookup error:", error.message);
    }
    return [];
  }

  const reviewerIds = reviewers
    .map((r: any) => toPositiveInt(r.id))
    .filter((id): id is number => id !== null && id !== excludeUserId);

  const tokens = new Set<string>(await collectTokensForUserIds(supabase, reviewerIds, excludeUserId));

  for (const r of reviewers) {
    const rid = toPositiveInt(r.id);
    if (rid !== excludeUserId && isValidExpoToken(r?.expo_push_token)) {
      tokens.add(r.expo_push_token.trim());
    }
  }

  return Array.from(tokens);
}

async function pruneUnregisteredTokens(supabase: any, deadTokens: string[]): Promise<void> {
  if (deadTokens.length === 0) return;
  const nowIso = new Date().toISOString();
  try {
    await supabase
      .from("user_push_tokens")
      .update({ is_active: false, updated_at: nowIso })
      .in("push_token", deadTokens);
  } catch {}
  try {
    await supabase
      .from("users")
      .update({ expo_push_token: null, updated_at: nowIso })
      .in("expo_push_token", deadTokens);
  } catch {}
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const payload: WebhookPayload = await req.json();
    console.log("[send-push-notification] Received payload:", JSON.stringify(payload));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const tokenSet = new Set<string>();
    let title = "PPEye Safety Alert";
    let body = "You have a new safety update.";
    let notificationData: Record<string, any> = {};

    // -------------------------------------------------------------
    // Case 1: Database Webhook — New Submission -> Notify INTERNAL Reviewers
    // -------------------------------------------------------------
    if (payload.table === "ppe_submissions" && payload.type === "INSERT") {
      const sub = payload.record || {};
      const senderId = toPositiveInt(sub.submitted_by ?? sub.metadata?.submittedBy);
      const siteName = sub.site_name || "Site";

      title = "New PPE Submission";
      body = `Site ${siteName} submitted for safety review.`;
      notificationData = {
        type: "NEW_SUBMISSION",
        submissionId: sub.id,
        siteName,
        verdict: "pending",
      };

      const reviewerTokens = await collectReviewerTokens(supabase, senderId);
      reviewerTokens.forEach((t) => tokenSet.add(t));
    }

    // -------------------------------------------------------------
    // Case 2: Database Webhook — Review Verdict -> Notify Submitting Vendor
    // -------------------------------------------------------------
    else if (
      payload.table === "submission_reviews" &&
      (payload.type === "INSERT" || payload.type === "UPDATE")
    ) {
      const rev = payload.record || {};
      const isSafe =
        rev.verdict === "SAFE" ||
        rev.verdict === "safe" ||
        rev.final_status === "reviewed";

      let siteName = "Site";
      let submittedById: number | null = null;

      if (rev.submission_id) {
        const { data: subData } = await supabase
          .from("ppe_submissions")
          .select("submitted_by, site_name, metadata")
          .eq("id", rev.submission_id)
          .maybeSingle();

        if (subData) {
          siteName = subData.site_name || siteName;
          submittedById = toPositiveInt(
            subData.submitted_by ?? subData.metadata?.submittedBy
          );
        }
      }

      title = isSafe
        ? "PPE Review Completed"
        : "Action Required: Unsafe Workers Flagged";
      body = isSafe
        ? `${siteName} — Verdict: All Safe. All workers approved.`
        : `${siteName} — Verdict: Unsafe. Safety violations flagged; tap to fix & resubmit.`;
      notificationData = isSafe
        ? {
            type: "REVIEW_SAFE",
            submissionId: rev.submission_id,
            siteName,
            verdict: "safe",
            allSafe: true,
          }
        : {
            type: "REVIEW_UNSAFE",
            submissionId: rev.submission_id,
            siteName,
            verdict: "unsafe",
            route: "ActionRequired",
          };

      if (submittedById) {
        const reviewerId = toPositiveInt(rev.reviewed_by);
        const vendorTokens = await collectTokensForUserIds(
          supabase,
          [submittedById],
          reviewerId
        );
        vendorTokens.forEach((t) => tokenSet.add(t));
      }
    }

    // -------------------------------------------------------------
    // Case 3: Direct Invocation (from notification.service.ts or custom callers)
    // -------------------------------------------------------------
    else {
      const incomingData = payload.data || {};
      const subId =
        payload.submission_id ??
        incomingData.submissionId ??
        incomingData.submission_id;
      let siteName = incomingData.siteName ?? incomingData.site_name;
      const verdict =
        incomingData.verdict ??
        incomingData.status ??
        (incomingData.type === "REVIEW_SAFE"
          ? "safe"
          : incomingData.type === "REVIEW_UNSAFE"
            ? "unsafe"
            : undefined);

      title =
        payload.title ||
        (payload.role === "reviewer" ? "New PPE Submission" : "PPE Review Completed");
      body = payload.body || body;

      // 3A. Explicit token override
      if (Array.isArray(payload.tokens)) {
        for (const t of payload.tokens) {
          if (isValidExpoToken(t)) tokenSet.add(t.trim());
        }
      }

      // 3B. Reviewer role broadcast
      if (payload.role === "reviewer") {
        const senderId = toPositiveInt(
          payload.submitted_by ?? incomingData.submitted_by
        );
        const revTokens = await collectReviewerTokens(supabase, senderId);
        revTokens.forEach((t) => tokenSet.add(t));
      } else {
        // 3C. Targeted Vendor User ID (supports user_id, recipient_user_id, or submitted_by)
        let targetVendorUserId = toPositiveInt(
          payload.user_id ??
            payload.recipient_user_id ??
            payload.submitted_by ??
            incomingData.submitted_by
        );

        // 3D. Fallback lookup from ppe_submissions by submission_id
        if ((!targetVendorUserId || !siteName) && subId) {
          const numericSubId = toPositiveInt(subId);
          if (numericSubId) {
            const { data: subData } = await supabase
              .from("ppe_submissions")
              .select("submitted_by, site_name, metadata")
              .eq("id", numericSubId)
              .maybeSingle();

            if (subData) {
              if (!siteName && subData.site_name) {
                siteName = subData.site_name;
              }
              if (!targetVendorUserId) {
                targetVendorUserId = toPositiveInt(
                  subData.submitted_by ?? subData.metadata?.submittedBy
                );
              }
            }
          }
        }

        if (targetVendorUserId) {
          const vendorTokens = await collectTokensForUserIds(supabase, [
            targetVendorUserId,
          ]);
          vendorTokens.forEach((t) => tokenSet.add(t));
        }
      }

      notificationData = {
        ...incomingData,
        ...(subId !== undefined ? { submissionId: subId } : {}),
        ...(siteName ? { siteName } : {}),
        ...(verdict ? { verdict } : {}),
      };
    }

    const targetTokens = Array.from(tokenSet);
    if (targetTokens.length === 0) {
      console.log("[send-push-notification] No active Expo push tokens found.");
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No tokens found to notify" }),
        {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    };
    if (EXPO_ACCESS_TOKEN) {
      headers.Authorization = `Bearer ${EXPO_ACCESS_TOKEN}`;
    }

    const allTickets: any[] = [];
    const deadTokens: string[] = [];

    for (let i = 0; i < targetTokens.length; i += EXPO_BATCH_LIMIT) {
      const batchTokens = targetTokens.slice(i, i + EXPO_BATCH_LIMIT);
      const messages = batchTokens.map((token) => ({
        to: token,
        title,
        body,
        priority: "high",
        sound: "default",
        channelId: "default",
        ttl: 86400,
        data: notificationData,
      }));

      console.log(
        `[send-push-notification] Dispatching batch of ${messages.length} notification(s) to Expo...`
      );

      const expoRes = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(messages),
      });

      const expoJson = await expoRes.json();
      const tickets = Array.isArray(expoJson?.data) ? expoJson.data : [];
      allTickets.push(...tickets);

      tickets.forEach((ticket: any, idx: number) => {
        if (
          ticket?.status === "error" &&
          ticket?.details?.error === "DeviceNotRegistered" &&
          batchTokens[idx]
        ) {
          deadTokens.push(batchTokens[idx]);
        }
      });
    }

    if (deadTokens.length > 0) {
      console.log(
        `[send-push-notification] Pruning ${deadTokens.length} unregistered token(s).`
      );
      await pruneUnregisteredTokens(supabase, deadTokens);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: targetTokens.length,
        pruned: deadTokens.length,
        tickets: allTickets,
      }),
      {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err: any) {
    console.error("[send-push-notification] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || String(err) }),
      {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
