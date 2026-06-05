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

// ── Live-VALR reconciliation tuning ──────────────────────────────────────────
// balances_daily.usdt_balance is a pure ledger rollup and can silently drift
// from the real VALR available USDT (e.g. USDPC-yield settlement, conversion
// rounding) because the daily pipeline has no live-balance reconciliation step.
// Before sizing a sweep we read the customer's LIVE VALR USDT and, when it
// differs from the recorded balance, book an `adjustment` ledger line so
// balances_daily re-converges to the exchange — then size the sweep off the
// live figure. Only the swept asset (USDT) is reconciled here.
const RECON_EPSILON_USDT = 0.01;   // ignore sub-cent drift
const RECON_MAX_AUTO_USDT = 100;   // auto-heal up to this; larger deltas likely
                                   // signal an un-booked deposit/withdrawal and
                                   // must be investigated, not silently absorbed.

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
  let reconciled = 0;

  for (const customer_id of enabledIds) {
    try {
      // Latest recorded (ledger-derived) USDT for this customer.
      const { data: balRows, error: balErr } = await sb
        .from("balances_daily")
        .select("usdt_balance")
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
      const dbUsdt = Number(balRows?.[0]?.usdt_balance ?? 0);

      // ── Live-VALR reconciliation (credit-only) ─────────────────────────────
      // Read the customer's real VALR available USDT. balances_daily.usdt_balance
      // is re-derived by two INDEPENDENT and mutually-inconsistent processes
      // (ef_post_ledger_and_balances = incremental prev+delta; and
      // carry_forward_daily_balances() = cumulative ledger sum), and for some
      // customers the ledger does not fully reconstruct the balance (large
      // historical snapshot offset). An earlier two-way reconciliation that
      // booked BOTH credits and debits therefore OSCILLATED: it would credit +X
      // one day and, after the balance was re-derived to a transient higher
      // value, debit −X the next — never converging (a limit cycle).
      //
      // Fix: reconcile in ONE direction only. We only ever book a POSITIVE
      // credit when the recorded USDT is BELOW the live VALR balance — i.e. a
      // genuine un-booked inflow (typically a USDPC yield distribution that
      // funds this very sweep). We NEVER auto-book a negative adjustment: if the
      // recorded balance EXCEEDS live, we alert for manual review instead. This
      // is provably stable (each credit is consumed by the sweep conversion that
      // follows, returning USDT to ~0) and cannot oscillate.
      //
      // On any VALR failure we fall back to the recorded figure so a hiccup
      // never blocks the sweep.
      let effectiveUsdt = dbUsdt; // default: conservative, ledger-derived basis
      try {
        const creds = await resolveCustomerCredentials(sb, customer_id);
        const liveBalances = await getAccountBalances(creds.subaccountId, {
          apiKey: creds.apiKey,
          apiSecret: creds.apiSecret,
        });
        const liveUsdt = pickAvailable(liveBalances as any, "USDT");
        const delta = +(liveUsdt - dbUsdt).toFixed(8);

        if (delta > RECON_EPSILON_USDT) {
          // Recorded USDT is BELOW real VALR → genuine un-booked inflow.
          if (delta > RECON_MAX_AUTO_USDT) {
            // Too large to be yield — almost certainly an un-booked deposit that
            // must be booked as a `topup` (and reflected in cost basis), not as
            // a yield credit. Do NOT auto-credit or sweep the excess; alert.
            await logAlert(sb, "ef_sweep_usdt_to_usdpc", "critical",
              `USDT inflow exceeds auto-reconcile cap for customer ${customer_id}: VALR ${liveUsdt.toFixed(2)} vs DB ${dbUsdt.toFixed(2)} (Δ +${delta.toFixed(2)}). Sizing sweep off recorded balance; investigate for an un-booked deposit.`,
              { customer_id, live_usdt: liveUsdt, db_usdt: dbUsdt, delta }, org_id, customer_id);
          } else {
            // Book the genuine inflow once per customer per day (idempotent).
            const { data: existingRecon } = await sb
              .from("ledger_lines")
              .select("ledger_id")
              .eq("org_id", org_id)
              .eq("customer_id", customer_id)
              .eq("trade_date", todayStr)
              .eq("kind", "adjustment")
              .ilike("note", "usdt_yield_recon%")
              .limit(1);

            if (!existingRecon || existingRecon.length === 0) {
              const { error: recErr } = await sb.from("ledger_lines").insert({
                org_id,
                customer_id,
                trade_date: todayStr,
                kind: "adjustment",
                amount_btc: 0,
                amount_usdt: delta, // always positive here
                amount_usdpc: 0,
                amount_zar: 0,
                fee_btc: 0,
                fee_usdt: 0,
                fee_usdpc: 0,
                note: `usdt_yield_recon: un-booked VALR USDT inflow +${delta.toFixed(2)} (VALR ${liveUsdt.toFixed(2)} vs DB ${dbUsdt.toFixed(2)})`,
                conversion_metadata: {
                  source: "ef_sweep_usdt_to_usdpc",
                  reconcile: "usdt_inflow",
                  valr_usdt: liveUsdt,
                  db_usdt: dbUsdt,
                  delta,
                },
              });
              if (recErr) {
                await logAlert(sb, "ef_sweep_usdt_to_usdpc", "error",
                  `USDT inflow credit insert failed for customer ${customer_id}: ${recErr.message}`,
                  { customer_id, live_usdt: liveUsdt, db_usdt: dbUsdt, delta, error: recErr.message }, org_id, customer_id);
              } else {
                reconciled++;
                effectiveUsdt = liveUsdt; // sweep off the now-credited live figure
                await logAlert(sb, "ef_sweep_usdt_to_usdpc", "info",
                  `Booked un-booked USDT inflow for customer ${customer_id}: +${delta.toFixed(2)} (VALR ${liveUsdt.toFixed(2)} vs DB ${dbUsdt.toFixed(2)}).`,
                  { customer_id, live_usdt: liveUsdt, db_usdt: dbUsdt, delta }, org_id, customer_id);
              }
            } else {
              // Already credited today — size off live (lower of risk) safely.
              effectiveUsdt = liveUsdt;
            }
          }
        } else if (delta < -RECON_EPSILON_USDT) {
          // Recorded USDT EXCEEDS real VALR. NEVER auto-debit (that caused the
          // oscillation). Size off the live (lower) figure so we never try to
          // convert USDT the account does not actually hold, and alert so the
          // over-statement can be investigated manually.
          effectiveUsdt = liveUsdt;
          await logAlert(sb, "ef_sweep_usdt_to_usdpc", "warn",
            `Recorded USDT exceeds live VALR for customer ${customer_id}: DB ${dbUsdt.toFixed(2)} vs VALR ${liveUsdt.toFixed(2)} (Δ ${delta.toFixed(2)}). Sizing sweep off live balance; no auto-adjustment booked — review for an over-stated balance.`,
            { customer_id, live_usdt: liveUsdt, db_usdt: dbUsdt, delta }, org_id, customer_id);
        } else {
          // In sync — size off the live figure (== recorded within epsilon).
          effectiveUsdt = liveUsdt;
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

  console.info(`ef_sweep_usdt_to_usdpc: created=${created}, skipped=${skipped}, reconciled=${reconciled}`);

  // When invoked as a forced single-customer sweep from the Admin UI, run the
  // downstream execute -> poll -> post_ledger pass server-side (service-to-service,
  // no CORS) so the browser only ever calls this one function. The daily pipeline
  // run (no force) skips this — the orchestrator handles the sequence itself.
  // A reconcile-only correction (no sweep intent) still needs post_ledger to
  // fold the adjustment line into balances_daily.
  let pipeline: Array<{ step: string; ok: boolean; status: number }> | undefined;
  if (force && (created > 0 || reconciled > 0)) {
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

  return new Response(JSON.stringify({ success: true, created, skipped, reconciled, target_customer_id: targetCustomerId, force, pipeline }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
});
