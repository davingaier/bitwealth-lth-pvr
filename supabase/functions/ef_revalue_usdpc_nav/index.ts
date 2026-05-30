// ef_revalue_usdpc_nav/index.ts
//
// Daily mark-to-market for USDPC-enabled customers. A client sitting at a cycle
// top can be ~100% USDPC for a year or more with NO trades. The ledger step
// (ef_post_ledger_and_balances) only writes a balances_daily row on days WITH
// activity, so without this job a long-idle client's NAV would never reflect
// USDPC yield / price appreciation (nor BTC price moves).
//
// For each enabled customer this carries the most recent balances forward to
// today's date, re-valued at today's BTC price (from the active bands table)
// and today's USDPC price (from usdpc_prices_daily). It UPSERTs the today row,
// so on a trade day where the ledger already wrote today's row it simply
// refreshes the marks; on an idle day it creates the row.
//
// Scheduled after the trading window closes (e.g. 17:30 UTC) so it never races
// the live pipeline's own balances write.

import { getServiceClient, yyyymmdd } from "./client.ts";
import { logAlert } from "../_shared/alerting.ts";
import { bandsTableForSource } from "../_shared/band_source.ts";

Deno.serve(async () => {
  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  if (!org_id) return new Response("ORG_ID missing", { status: 500 });

  const todayStr = yyyymmdd(new Date());
  const bandsTable = bandsTableForSource("rb");

  // Enabled customers.
  const { data: csRows, error: csErr } = await sb
    .schema("public")
    .from("customer_strategies")
    .select("customer_id")
    .eq("org_id", org_id)
    .eq("strategy_code", "LTH_PVR")
    .eq("usdpc_enabled", true);
  if (csErr) {
    console.error("customer_strategies query failed", csErr);
    return new Response(csErr.message, { status: 500 });
  }
  const enabledIds = Array.from(new Set((csRows ?? []).map((r: any) => Number(r.customer_id))));
  if (enabledIds.length === 0) {
    return new Response("ok - no usdpc-enabled customers");
  }

  // Today's BTC price (last known <= today).
  let btcPx = 0;
  {
    const { data: px } = await sb
      .from(bandsTable)
      .select("btc_price")
      .lte("date", todayStr)
      .order("date", { ascending: false })
      .limit(1);
    btcPx = Number((px as any)?.[0]?.btc_price ?? 0) || 0;
  }
  // Today's USDPC price (last known <= today; default 1.0).
  let usdpcPx = 1;
  {
    const { data: upx } = await sb
      .from("usdpc_prices_daily")
      .select("price_usd")
      .lte("date", todayStr)
      .order("date", { ascending: false })
      .limit(1);
    usdpcPx = Number((upx as any)?.[0]?.price_usd ?? 1) || 1;
  }

  let revalued = 0;
  for (const customer_id of enabledIds) {
    try {
      // Most recent balances at or before today.
      const { data: balRows, error: balErr } = await sb
        .from("balances_daily")
        .select("btc_balance, usdt_balance, usdpc_balance, zar_balance")
        .eq("org_id", org_id)
        .eq("customer_id", customer_id)
        .lte("date", todayStr)
        .order("date", { ascending: false })
        .limit(1);
      if (balErr) {
        await logAlert(sb, "ef_revalue_usdpc_nav", "error",
          `Balance query failed for customer ${customer_id}: ${balErr.message}`,
          { customer_id, error: balErr.message }, org_id, customer_id);
        continue;
      }
      const b = balRows?.[0];
      if (!b) continue; // nothing to carry forward

      const btc = Number(b.btc_balance ?? 0);
      const usdt = Number(b.usdt_balance ?? 0);
      const usdpc = Number(b.usdpc_balance ?? 0);
      const zar = Number(b.zar_balance ?? 0);
      const nav = btc * btcPx + usdt + usdpc * usdpcPx;

      const { error: upErr } = await sb.from("balances_daily").upsert({
        org_id,
        customer_id,
        date: todayStr,
        btc_balance: btc,
        usdt_balance: usdt,
        usdpc_balance: usdpc,
        usdpc_price_usd: usdpcPx,
        zar_balance: zar,
        nav_usd: nav,
        band_source: "rb",
      }, { onConflict: "org_id,customer_id,date" });
      if (upErr) {
        await logAlert(sb, "ef_revalue_usdpc_nav", "error",
          `balances_daily upsert failed for customer ${customer_id}: ${upErr.message}`,
          { customer_id, error: upErr.message }, org_id, customer_id);
        continue;
      }
      revalued++;
    } catch (err) {
      await logAlert(sb, "ef_revalue_usdpc_nav", "error",
        `Revaluation failed for customer ${customer_id}`,
        { customer_id, error: err instanceof Error ? err.message : String(err) }, org_id, customer_id);
    }
  }

  console.info(`ef_revalue_usdpc_nav: revalued=${revalued} customers at btcPx=${btcPx} usdpcPx=${usdpcPx}`);
  return new Response(JSON.stringify({ success: true, revalued, btcPx, usdpcPx }), {
    headers: { "Content-Type": "application/json" },
  });
});
