import { getServiceClient } from "./client.ts";
Deno.serve(async ()=>{
  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  if (!org_id) return new Response("ORG_ID missing", {
    status: 500
  });
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const ms = monthStart.toISOString().slice(0, 10);
  const me = monthEnd.toISOString().slice(0, 10);
  const endPlus = new Date(monthEnd.getTime() + 86400000).toISOString();
  // customers with fee config
  const { data: cfgs, error } = await sb.from("lth_pvr.fee_configs").select("*").eq("org_id", org_id);
  if (error) return new Response(error.message, {
    status: 500
  });
  for (const cfg of cfgs ?? []){
    // nav_start (<= monthStart last), nav_end (<= monthEnd last)
    const { data: ns } = await sb.from("lth_pvr.balances_daily").select("nav_usd").eq("org_id", org_id).eq("customer_id", cfg.customer_id).lte("date", ms).order("date", {
      ascending: false
    }).limit(1);
    const { data: ne } = await sb.from("lth_pvr.balances_daily").select("nav_usd").eq("org_id", org_id).eq("customer_id", cfg.customer_id).lte("date", me).order("date", {
      ascending: false
    }).limit(1);
    const nav_start = +(ns?.[0]?.nav_usd ?? 0);
    const nav_end = +(ne?.[0]?.nav_usd ?? 0);
    // net flows (USDT) in-month
    const { data: flows } = await sb.from("lth_pvr.exchange_funding_events").select("kind, amount").eq("org_id", org_id).eq("customer_id", cfg.customer_id).eq("asset", "USDT").gte("occurred_at", monthStart.toISOString()).lt("occurred_at", endPlus);
    let net_flows = 0;
    for (const f of flows ?? []){
      if (f.kind === "deposit") net_flows += Number(f.amount ?? 0);
      if (f.kind === "withdrawal") net_flows -= Number(f.amount ?? 0);
    }
    const profit = nav_end - nav_start - net_flows;
    const fee_due = profit > 0 ? +(profit * Number(cfg.fee_rate ?? 0.10)).toFixed(2) : 0;
    // upsert monthly fee record
    const up = await sb.from("lth_pvr.fees_monthly").upsert({
      org_id,
      customer_id: cfg.customer_id,
      month_start: ms,
      month_end: me,
      nav_start,
      nav_end,
      net_flows,
      fee_rate: cfg.fee_rate,
      fee_paid_usdt: 0,
      arrears_usdt: 0,
      status: "pending"
    }, {
      onConflict: "org_id,customer_id,month_start,month_end"
    }).select("fee_id").single();
    if (up.error) {
      console.error(up.error);
      continue;
    }
    const fee_id = up.data.fee_id;
    if (fee_due <= 0) continue;
    // available USDT (excludes reserve)
    const av = await sb.rpc("fn_usdt_available_for_trading", {
      p_org: org_id,
      p_customer: cfg.customer_id
    });
    let remaining = fee_due;
    if (cfg.settlement_mode === "invoice_only") {
      // Invoice-only: no auto-deduction, just create/open invoice at full fee_due
      const inv = await sb
        .from("lth_pvr.fee_invoices")
        .insert({
          org_id,
          customer_id: cfg.customer_id,
          fee_id,
          invoice_date: me,          // 'YYYY-MM-DD' string; Postgres will cast to date
          amount_usdt: fee_due,
          status: "open"
        })
        .select("invoice_id")
        .single();
       if (inv.error) {
        console.error("fee_invoices insert error", inv.error);
        // still mark as invoiced so we don’t keep retrying the same month
        await sb
          .from("lth_pvr.fees_monthly")
          .update({
            status: "invoiced",
            invoiced_at: new Date().toISOString(),
            note: "Invoice insert failed – see logs"
          })
          .eq("fee_id", fee_id);
      } else {
        await sb
          .from("lth_pvr.fees_monthly")
          .update({
            status: "invoiced",
            invoiced_at: new Date().toISOString()
          })
          .eq("fee_id", fee_id);
      }

      continue;
    }
    // 1) USDT deduction

    const takeUsdt = Math.min(remaining, Number(av.data ?? 0));
    if (takeUsdt > 0) {
      await sb.from("lth_pvr.ledger_lines").insert({
        org_id,
        customer_id: cfg.customer_id,
        date: me,
        kind: "fee",
        amount_usdt: takeUsdt,
        note: "Performance fee (USDT)"
      });
      remaining = +(remaining - takeUsdt).toFixed(2);
    }
    // 2) Optional auto-sell BTC for the rest
    if (remaining > 0 && cfg.settlement_mode === "usdt_or_sell_btc") {
      const { data: ci } = await sb.from("lth_pvr.ci_bands_daily").select("btc_price").order("date", {
        ascending: false
      }).limit(1).single();
      const price = Number(ci?.btc_price ?? 0);
      // find customer trade fee bps from their latest strategy_version
      const { data: csv } = await sb.from("lth_pvr.customer_strategies").select("strategy_version_id").eq("org_id", org_id).eq("customer_id", cfg.customer_id).order("effective_from", {
        ascending: false
      }).limit(1);
      const svId = csv?.[0]?.strategy_version_id;
      const { data: sv } = await sb.from("lth_pvr.strategy_versions").select("trade_fee_bps").eq("strategy_version_id", svId).limit(1);
      const tradeFee = Number(sv?.[0]?.trade_fee_bps ?? 10) / 10000;
      if (price > 0) {
        const qty = +(remaining / (price * (1 - tradeFee))).toFixed(8);
        await sb.from("lth_pvr.ledger_lines").insert({
          org_id,
          customer_id: cfg.customer_id,
          date: me,
          kind: "sell",
          amount_btc: -qty,
          amount_usdt: +(qty * price).toFixed(2),
          fee_btc: +(qty * tradeFee).toFixed(8),
          note: "Auto-sell to cover fee"
        });
        remaining = 0;
      }
    }
    await sb.from("lth_pvr.fees_monthly").update({
      fee_paid_usdt: +(fee_due - remaining).toFixed(2),
      arrears_usdt: +remaining.toFixed(2),
      status: remaining > 0 ? "arrears" : "settled",
      settled_at: new Date().toISOString()
    }).eq("fee_id", fee_id);
  }
  return new Response("ok");
});
