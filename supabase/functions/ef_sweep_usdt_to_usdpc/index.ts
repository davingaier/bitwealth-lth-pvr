// ef_sweep_usdt_to_usdpc/index.ts
//
// Post-settlement step in the daily LTH PVR pipeline. After BTC sells have
// settled and the ledger has posted, any idle USDT belonging to a USDPC-enabled
// customer is swept into the yield-bearing USDPC stablecoin so it earns yield
// while waiting to be redeployed into BTC.
//
// It does NOT place exchange orders itself. It creates BUY conversion
// order_intents (pair USDPC/USDT, amount = idle USDT as the QUOTE amount). The
// orchestrator then runs a second execute -> poll -> post_ledger pass which
// executes these as MARKET orders (ef_execute_orders treats USDPC BUY
// conversions as quoteAmount spends) and books the resulting fills.
//
// Idempotent: one sweep intent per customer per trade_date (deterministic
// idempotency_key), so repeated invocations never double-sweep.

import { getServiceClient, yyyymmdd } from "./client.ts";
import { logAlert } from "../_shared/alerting.ts";
import { loadUsdpcConfig, splitConversionAmount, USDPC_PAIR } from "../_shared/usdpc.ts";
import { resolveCustomerCredentials } from "../_shared/valrCredentials.ts";
import { getAccountBalances, pickAvailable } from "../_shared/valrClient.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Live-VALR sizing / divergence alerting ───────────────────────────────────
// balances_daily.usdt_balance is a ledger rollup that can diverge from the real
// VALR available USDT. We therefore size the sweep off the customer's LIVE VALR
// USDT (so we never try to convert funds the account does not actually hold).
//
// We deliberately do NOT inject any reconciling ledger line. Doing so caused two
// production incidents on customer 49: the ledger already reconstructs the real
// balance on its own, so an injected `adjustment` double-books — and because
// balances_daily is re-derived by two inconsistent processes (incremental
// ef_post_ledger_and_balances vs cumulative carry_forward_daily_balances), the
// injected line then oscillated / inflated the balance on later days. The ledger
// is the source of truth; divergences are surfaced via alerts for manual review.
const RECON_EPSILON_USDT  = 0.01;  // ignore sub-cent drift when alerting
const RECON_EPSILON_USDPC = 1.00;  // alert if live vs DB USDPC diverges by ≥ 1 unit

Deno.serve(async (req: Request) => {
  // Allow the Admin UI to invoke the forced single-customer sweep from the browser.
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  if (!org_id) return new Response("ORG_ID missing", { status: 500, headers: CORS });

  // Optional request body:
  //   { customer_id?: number, force?: boolean }
  // - customer_id: restrict the sweep to a single customer (admin "force" action
  //   from the Pending Conversions card). Omitted → the normal daily all-customer
  //   sweep run by the pipeline orchestrator.
  // - force: when true, the idempotency key is made unique per invocation so a
  //   fresh sweep intent is created even if the customer already swept today.
  //   This is required for the manual force-convert button: a customer (e.g. one
  //   who converted ZAR→USDT after the morning sweep ran) has already-executed
  //   sweep intents under today's deterministic keys; without force we would
  //   upsert-collide onto those executed rows. force is ONLY honoured together
  //   with an explicit customer_id to keep the daily run fully idempotent.
  let targetCustomerId: number | null = null;
  let force = false;
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json().catch(() => null);
      if (body && typeof body === "object") {
        if (body.customer_id != null && Number.isFinite(Number(body.customer_id))) {
          targetCustomerId = Number(body.customer_id);
        }
        if (body.force === true) force = true;
      }
    }
  } catch (_e) { /* ignore — treat as the default daily run */ }
  // Guard: force only applies to a single explicitly-targeted customer.
  if (force && targetCustomerId == null) force = false;

  const todayStr = yyyymmdd(new Date());
  const cfg = await loadUsdpcConfig(sb);

  // Enabled customers for the LTH_PVR strategy.
  let csQuery = sb
    .schema("public")
    .from("customer_strategies")
    .select("customer_id")
    .eq("org_id", org_id)
    .eq("strategy_code", "LTH_PVR")
    .eq("usdpc_enabled", true);
  if (targetCustomerId != null) csQuery = csQuery.eq("customer_id", targetCustomerId);
  const { data: csRows, error: csErr } = await csQuery;

  if (csErr) {
    console.error("customer_strategies query failed", csErr);
    return new Response(csErr.message, { status: 500, headers: CORS });
  }
  const enabledIds = Array.from(new Set((csRows ?? []).map((r: any) => Number(r.customer_id))));
  if (enabledIds.length === 0) {
    return new Response(JSON.stringify({ success: true, created: 0, skipped: 0, target_customer_id: targetCustomerId, force }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  // Single org-level exchange account (mirrors ef_create_order_intents).
  const { data: exchAcct, error: exchErr } = await sb
    .from("exchange_accounts")
    .select("exchange_account_id")
    .eq("org_id", org_id)
    .limit(1)
    .single();
  if (exchErr || !exchAcct) {
    console.error("No exchange account for org", exchErr);
    return new Response("no exchange account", { status: 500, headers: CORS });
  }

  let created = 0;
  let skipped = 0;

  for (const customer_id of enabledIds) {
    try {
      // Latest recorded (ledger-derived) USDT for this customer.
      const { data: balRows, error: balErr } = await sb
        .from("balances_daily")
        .select("usdt_balance, usdpc_balance")
        .eq("org_id", org_id)
        .eq("customer_id", customer_id)
        .order("date", { ascending: false })
        .limit(1);
      if (balErr) {
        await logAlert(sb, "ef_sweep_usdt_to_usdpc", "error",
          `Balance query failed for customer ${customer_id}: ${balErr.message}`,
          { customer_id, error: balErr.message }, org_id, customer_id);
        continue;
      }
      const dbUsdt  = Number(balRows?.[0]?.usdt_balance  ?? 0);
      const dbUsdpc = Number(balRows?.[0]?.usdpc_balance ?? 0);

      // ── Size off LIVE VALR; alert on divergence (no ledger writes) ──────────
      // Read the customer's real VALR available USDT and size the sweep off it,
      // so we never attempt to convert funds the account does not actually hold.
      // We do NOT book any reconciling ledger line: the ledger already
      // reconstructs the real balance, and injecting an `adjustment` double-books
      // (and, given balances_daily's dual incremental/cumulative derivation,
      // inflates the balance on later days). Divergence is surfaced via an alert
      // for manual review only. On any VALR failure we fall back to the recorded
      // figure so a hiccup never blocks the sweep.
      let effectiveUsdt = dbUsdt; // default: conservative, ledger-derived basis
      try {
        const creds = await resolveCustomerCredentials(sb, customer_id);
        const liveBalances = await getAccountBalances(creds.subaccountId, {
          apiKey: creds.apiKey,
          apiSecret: creds.apiSecret,
        });
        const liveUsdt  = pickAvailable(liveBalances as any, "USDT");
        const liveUsdpc = pickAvailable(liveBalances as any, "USDPC");
        const deltaUsdt  = +(liveUsdt  - dbUsdt).toFixed(8);
        const deltaUsdpc = +(liveUsdpc - dbUsdpc).toFixed(8);

        // Always size the actual sweep off the live (real) figure.
        effectiveUsdt = liveUsdt;

        if (Math.abs(deltaUsdt) > RECON_EPSILON_USDT) {
          // Recorded ledger balance and live VALR disagree. Surface it for manual
          // review — but never auto-correct the ledger from here.
          await logAlert(sb, "ef_sweep_usdt_to_usdpc", "warn",
            `Recorded USDT differs from live VALR for customer ${customer_id}: DB ${dbUsdt.toFixed(2)} vs VALR ${liveUsdt.toFixed(2)} (Δ ${deltaUsdt.toFixed(2)}). Sweep sized off live balance; no ledger adjustment booked — review if persistent.`,
            { customer_id, live_usdt: liveUsdt, db_usdt: dbUsdt, delta: deltaUsdt }, org_id, customer_id);
        }

        if (Math.abs(deltaUsdpc) > RECON_EPSILON_USDPC) {
          // USDPC on VALR doesn't match the ledger-derived balance. This most
          // commonly means a manual USDPC buy/sell was executed directly on VALR
          // without going through the pipeline. Alert for manual review; no
          // ledger adjustment is ever written from here.
          await logAlert(sb, "ef_sweep_usdt_to_usdpc", "warn",
            `Recorded USDPC differs from live VALR for customer ${customer_id}: DB ${dbUsdpc.toFixed(4)} vs VALR ${liveUsdpc.toFixed(4)} (Δ ${deltaUsdpc.toFixed(4)}). No ledger adjustment booked — review ledger for un-booked conversions.`,
            { customer_id, live_usdpc: liveUsdpc, db_usdpc: dbUsdpc, delta: deltaUsdpc }, org_id, customer_id);
        }
      } catch (recEx) {
        // Live balance unavailable — fall back to the recorded figure.
        await logAlert(sb, "ef_sweep_usdt_to_usdpc", "warn",
          `Live VALR balance unavailable for customer ${customer_id}; sweeping off recorded balance. ${recEx instanceof Error ? recEx.message : String(recEx)}`,
          { customer_id, db_usdt: dbUsdt }, org_id, customer_id);
      }

      // Dust stays as USDT (do not sweep tiny amounts).
      if (effectiveUsdt < cfg.minOrderUsdt) {
        skipped++;
        continue;
      }

      const sweepUsdt = +effectiveUsdt.toFixed(2);
      // VALR caps a single USDPC BUY at ~10 000 USDT (quote). Split larger
      // sweeps into multiple intents, each its own market order.
      const chunks = splitConversionAmount(sweepUsdt, cfg.maxQuoteUsdt, 2);
      // A forced manual sweep gets a unique key suffix so it never upsert-collides
      // with the customer's already-executed daily sweep intents (same
      // org/customer/date/chunk). The daily run keeps the deterministic key.
      const forceTag = force ? `|FORCE|${Date.now()}` : "";
      let chunkErr = false;
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunkUsdt = chunks[ci];
        if (!(chunkUsdt > 0)) continue;
        const keyParts = [org_id, customer_id.toString(), todayStr, "USDPC_SWEEP", String(ci) + forceTag].join("|");
        const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyParts));
        const idKey = Array.from(new Uint8Array(keyHash)).map((b) => b.toString(16).padStart(2, "0")).join("");

        const ins = await sb.from("order_intents").upsert({
          org_id,
          customer_id,
          trade_date: todayStr,
          pair: USDPC_PAIR,
          side: "BUY", // buy USDPC, spend USDT (quote)
          amount: chunkUsdt, // QUOTE amount (USDT) — executor uses quoteAmount for USDPC BUY
          limit_price: null, // market order
          base_asset: "USDPC",
          quote_asset: "USDT",
          exchange_account_id: exchAcct.exchange_account_id,
          idempotency_key: idKey,
          reason: "usdpc_sweep",
          note: chunks.length > 1
            ? `Sweep idle USDT into USDPC (chunk ${ci + 1}/${chunks.length}: ${chunkUsdt.toFixed(2)} of ${sweepUsdt.toFixed(2)})`
            : `Sweep ${sweepUsdt.toFixed(2)} idle USDT into USDPC`,
        }, { onConflict: "idempotency_key" });

        if (ins.error) {
          chunkErr = true;
          await logAlert(sb, "ef_sweep_usdt_to_usdpc", "error",
            `Sweep intent upsert failed for customer ${customer_id}: ${ins.error.message}`,
            { customer_id, sweepUsdt, chunk: ci + 1, chunks: chunks.length, error: ins.error.message }, org_id, customer_id);
        }
      }
      if (chunkErr) continue;
      created++;
    } catch (err) {
      await logAlert(sb, "ef_sweep_usdt_to_usdpc", "error",
        `Sweep failed for customer ${customer_id}`,
        { customer_id, error: err instanceof Error ? err.message : String(err) }, org_id, customer_id);
    }
  }

  console.info(`ef_sweep_usdt_to_usdpc: created=${created}, skipped=${skipped}`);

  // When invoked as a forced single-customer sweep from the Admin UI, run the
  // downstream execute -> poll -> post_ledger pass server-side (service-to-service,
  // no CORS) so the browser only ever calls this one function. The daily pipeline
  // run (no force) skips this — the orchestrator handles the sequence itself.
  let pipeline: Array<{ step: string; ok: boolean; status: number }> | undefined;
  if (force && created > 0) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const callEf = async (name: string) => {
      const r = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      return { step: name, ok: r.ok, status: r.status };
    };
    pipeline = [];
    for (const name of ["ef_execute_orders", "ef_poll_orders", "ef_post_ledger_and_balances"]) {
      try {
        const res = await callEf(name);
        pipeline.push(res);
        if (!res.ok) {
          console.error(`forced sweep step ${name} failed (${res.status})`);
          break;
        }
      } catch (err) {
        console.error(`forced sweep step ${name} error:`, err);
        pipeline.push({ step: name, ok: false, status: 0 });
        break;
      }
    }
  }

  return new Response(JSON.stringify({ success: true, created, skipped, target_customer_id: targetCustomerId, force, pipeline }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
});
