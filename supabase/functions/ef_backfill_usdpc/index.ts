// ef_backfill_usdpc/index.ts
//
// Phase 7 — USDPC rollout. On-demand backfill for a portfolio that has just
// been opted into the USDPC yield stablecoin. The regular daily pipeline already
// sweeps idle USDT into USDPC via ef_sweep_usdt_to_usdpc -> execute -> poll ->
// post_ledger, so a freshly-enabled customer would be backfilled on the next
// pipeline run anyway. This function lets an admin trigger that same sweep
// sequence immediately (out-of-band) without re-running the decision pipeline,
// so a customer's existing idle USDT starts earning yield right away.
//
// Request body (all optional):
//   { customer_id?: number }   // informational only — the sweep step itself
//                              // processes ALL usdpc-enabled customers with
//                              // idle USDT >= the dust threshold; it is
//                              // idempotent (one sweep intent per customer/day).
//
// Every step is idempotent, so repeated invocations never double-convert.

import { getServiceClient } from "./client.ts";
import { logAlert } from "../_shared/alerting.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (initError: any) {
    return new Response(
      JSON.stringify({ success: false, error: "Failed to initialize Supabase client", details: initError.message }),
      { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const org_id = Deno.env.get("ORG_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!org_id || !supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ success: false, error: "Missing ORG_ID / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const customerId = body.customer_id != null ? Number(body.customer_id) : null;

  const callEf = async (name: string) => {
    const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  };

  // Sweep idle USDT -> USDPC, then execute / poll / book the resulting fills.
  // Identical to the sweep pass embedded in ef_resume_pipeline, but runnable
  // on its own so an admin can backfill without re-running daily decisions.
  const sweepSequence = [
    "ef_sweep_usdt_to_usdpc",
    "ef_execute_orders",
    "ef_poll_orders",
    "ef_post_ledger_and_balances",
  ];

  const results: Array<Record<string, unknown>> = [];
  let failed = false;

  for (const name of sweepSequence) {
    try {
      const r = await callEf(name);
      results.push({ step: name, status: r.status, success: r.ok, response: r.text.substring(0, 200) });
      if (!r.ok) {
        await logAlert(sb, "ef_backfill_usdpc", "error",
          `USDPC backfill step ${name} failed`,
          { customer_id: customerId, step: name, response: r.text.substring(0, 500) }, org_id, customerId ?? undefined);
        failed = true;
        break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ step: name, success: false, error: msg });
      await logAlert(sb, "ef_backfill_usdpc", "error",
        `USDPC backfill step ${name} threw`,
        { customer_id: customerId, step: name, error: msg }, org_id, customerId ?? undefined);
      failed = true;
      break;
    }
  }

  return new Response(
    JSON.stringify({ success: !failed, customer_id: customerId, results }),
    { status: failed ? 500 : 200, headers: { ...corsHeaders, "content-type": "application/json" } },
  );
});
