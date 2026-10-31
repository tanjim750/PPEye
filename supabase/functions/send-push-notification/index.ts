import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Isolated Supabase Edge Function: send-push-notification
 * 
 * Triggered by Supabase Database Webhook on:
 * 1. ppe_submissions INSERT (notifies Reviewers of new inspection)
 * 2. submission_reviews INSERT/UPDATE (notifies Vendor of Safe/Unsafe verdict)
 * 3. Or generic payload { user_id, title, body, data }
 */

interface WebhookPayload {
  type?: 'INSERT' | 'UPDATE' | 'DELETE';
  table?: string;
  schema?: string;
  record?: Record<string, any>;
  old_record?: Record<string, any>;
  // Or direct invocation payload
  user_id?: number | string;
  title?: string;
  body?: string;
  data?: Record<string, any>;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

serve(async (req: Request) => {
  // CORS Headers
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const payload: WebhookPayload = await req.json();
    console.log("[send-push-notification] Received payload:", JSON.stringify(payload));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let targetTokens: string[] = [];
    let title = "PPEye Safety Alert";
    let body = "You have a new update.";
    let notificationData: Record<string, any> = {};

    // -------------------------------------------------------------
    // Case 1: New Submission -> Notify All Active Reviewers (Internal)
    // -------------------------------------------------------------
    if (payload.table === "ppe_submissions" && payload.type === "INSERT") {
      const sub = payload.record || {};
      title = "New PPE Submission";
      body = `Site ${sub.site_name || 'inspection'} submitted for safety review.`;
      notificationData = {
        type: "NEW_SUBMISSION",
        submissionId: sub.id,
        siteName: sub.site_name,
      };

      // Query all internal reviewers with an active push token
      const { data: reviewers } = await supabase
        .from("users")
        .select("expo_push_token")
        .eq("category", "internal")
        .not("expo_push_token", "is", null);

      if (reviewers && reviewers.length > 0) {
        targetTokens = reviewers
          .map((r: any) => r.expo_push_token)
          .filter((t: any) => typeof t === "string" && t.startsWith("ExponentPushToken"));
      }
    }

    // -------------------------------------------------------------
    // Case 2: Review Verdict -> Notify The Submitting Vendor (External)
    // -------------------------------------------------------------
    else if (payload.table === "submission_reviews" && (payload.type === "INSERT" || payload.type === "UPDATE")) {
      const rev = payload.record || {};
      const isSafe = rev.verdict === "SAFE" || rev.verdict === "safe" || rev.final_status === "reviewed";

      title = isSafe ? "PPE Verified: Safe" : "Action Required: Unsafe Worker";
      body = isSafe
        ? "Your PPE submission has been reviewed and verified Safe."
        : "Safety violations were flagged on your submission. Please resubmit.";
      notificationData = {
        type: isSafe ? "REVIEW_SAFE" : "REVIEW_UNSAFE",
        submissionId: rev.submission_id,
      };

      // Fetch the vendor user who submitted this inspection
      if (rev.submission_id) {
        const { data: subData } = await supabase
          .from("ppe_submissions")
          .select("submitted_by, vendor_profile_id")
          .eq("id", rev.submission_id)
          .maybeSingle();

        if (subData?.submitted_by) {
          const { data: vendorUser } = await supabase
            .from("users")
            .select("expo_push_token")
            .eq("id", subData.submitted_by)
            .maybeSingle();

          if (vendorUser?.expo_push_token && vendorUser.expo_push_token.startsWith("ExponentPushToken")) {
            targetTokens.push(vendorUser.expo_push_token);
          }
        }
      }
    }

    // -------------------------------------------------------------
    // Case 3: Direct User Push Invocation
    // -------------------------------------------------------------
    else if (payload.user_id) {
      title = payload.title || title;
      body = payload.body || body;
      notificationData = payload.data || {};

      const { data: targetUser } = await supabase
        .from("users")
        .select("expo_push_token")
        .eq("id", payload.user_id)
        .maybeSingle();

      if (targetUser?.expo_push_token && targetUser.expo_push_token.startsWith("ExponentPushToken")) {
        targetTokens.push(targetUser.expo_push_token);
      }
    }

    // Deduplicate tokens
    targetTokens = Array.from(new Set(targetTokens));

    if (targetTokens.length === 0) {
      console.log("[send-push-notification] No valid Expo push tokens found. Exiting gracefully.");
      return new Response(JSON.stringify({ success: true, message: "No tokens found to notify" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Construct Expo Push Notification Packets
    const messages = targetTokens.map((token) => ({
      to: token,
      sound: "default",
      priority: "high",
      channelId: "ppeye_alerts",
      title,
      body,
      data: notificationData,
    }));

    console.log(`[send-push-notification] Sending ${messages.length} push notification(s) to Expo...`);

    const expoRes = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    const expoData = await expoRes.json();
    console.log("[send-push-notification] Expo Response:", JSON.stringify(expoData));

    return new Response(JSON.stringify({ success: true, expoResponse: expoData }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    console.error("[send-push-notification] Error:", err);
    return new Response(JSON.stringify({ success: false, error: err?.message || String(err) }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});
