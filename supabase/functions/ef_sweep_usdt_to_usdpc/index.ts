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

Deno.serve(async (req: Request) => {
  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  if (!org_id) return new Response("ORG_ID missing", { status: 500 });

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
    return new Response(csErr.message, { status: 500 });
  }
  const enabledIds = Array.from(new Set((csRows ?? []).map((r: any) => Number(r.customer_id))));
  if (enabledIds.length === 0) {
    return new Response("ok - no usdpc-enabled customers");
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
    return new Response("no exchange account", { status: 500 });
  }

  let created = 0;
  let skipped = 0;

  for (const customer_id of enabledIds) {
    try {
      // Latest known idle USDT for this customer.
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
      const idleUsdt = Number(balRows?.[0]?.usdt_balance ?? 0);

      // Dust stays as USDT (do not sweep tiny amounts).
      if (idleUsdt < cfg.minOrderUsdt) {
        skipped++;
        continue;
      }

      const sweepUsdt = +idleUsdt.toFixed(2);
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
  return new Response(JSON.stringify({ success: true, created, skipped, target_customer_id: targetCustomerId, force }), {
    headers: { "Content-Type": "application/json" },
  });
});
