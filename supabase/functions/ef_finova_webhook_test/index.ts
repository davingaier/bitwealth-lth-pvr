// ef_finova_webhook_test/index.ts
//
// TEMPORARY capture endpoint for the Finova/KYCDD integration.
//
// Purpose: record the exact webhook payload Finova POSTs when a client finishes
// the onboarding workflow, so we can finalise the field mapping and confirm the
// signature format before building the real ef_finova_webhook. Used for a one-off
// test with customer 60.
//
// It does NOT verify the signature and does NOT touch customer_details — it only
// stores what it receives into public.finova_webhook_capture and returns HTTP 200
// (so Finova's retry logic does not fire).
//
// Deploy (public, no JWT so Finova can POST without a Supabase token):
//   supabase functions deploy ef_finova_webhook_test --project-ref wqnmxpooabmedvtackji --no-verify-jwt
//
// CLEANUP: throwaway. Delete this function + drop public.finova_webhook_capture
// once the sample payload is captured and the mapping is finalised.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-signature-sha256",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  // Simple health check so the URL can be verified in a browser.
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, message: "Finova webhook capture endpoint is live. POST here." }),
      { status: 200, headers: CORS },
    );
  }

  try {
    // Read the RAW body first — this is exactly what Finova signed, and what we
    // will later HMAC-verify in the real webhook.
    const rawBody = await req.text();

    // Collect all headers for inspection.
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Best-effort parse (payload is JSON per Finova settings).
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      // leave parsed = null; raw_body is still stored
    }

    const sb = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await sb.from("finova_webhook_capture").insert({
      method: req.method,
      content_type: req.headers.get("content-type"),
      signature: req.headers.get("x-signature-sha256"),
      source_ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
      byte_length: rawBody.length,
      headers,
      raw_body: rawBody,
      parsed,
    });

    if (error) {
      // Log for our own debugging, but still return 200 so Finova does not retry
      // against a test endpoint. We can see failures in the function logs.
      console.error("finova_webhook_capture insert failed:", error);
    }

    return new Response(JSON.stringify({ received: true }), { status: 200, headers: CORS });
  } catch (e) {
    console.error("ef_finova_webhook_test error:", e);
    // Return 200 regardless — this is a capture-only test endpoint.
    return new Response(JSON.stringify({ received: true }), { status: 200, headers: CORS });
  }
});
