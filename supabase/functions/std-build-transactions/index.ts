// supabase/functions/std-build-transactions/index.ts
// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* CORS */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

/* ENV */
const URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL");
const KEY = Deno.env.get("Secret Key");
if (!URL || !KEY) throw new Error("Missing SB_URL/Secret Key");
const sb = createClient(URL, KEY);

/* Your schema column name */
const BTC_DATE_COL = "btc_date_closing";  // <-- exact column name in your table

/* Config */
const APPLY_UPFRONT_USD_ON_DAY1 = true;

/* Helpers */
const ydayUTC = () => { const d=new Date(Date.now()-86400000); return d.toISOString().slice(0,10); };
const toDate = (s:string)=> new Date(s+"T00:00:00Z");
const addDays = (s:string,n:number)=>{ const d=toDate(s); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const daysInMonth = (iso:string)=>{ const d=toDate(iso); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).getUTCDate(); };
const N = (x:any,d=0)=>{ const n=Number(x); return Number.isFinite(n)?n:d; };
const R = (n:number,dp:number)=>{ const m=10**dp; return Math.round(n*m)/m; };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { for_date, force_from_date, dry_run } = await req.json().catch(()=>({}));
    const dateTo = (for_date || ydayUTC()) as string;

    // Active customers
    const { data: customers, error: cErr } = await sb
      .from("customer_details")
      .select("customer_id, trade_start_date, upfront_contribution_zar, recurring_contribution_zar, upfront_contribution_btc, customer_status")
      .eq("customer_status","Active");
    if (cErr) throw new Error("customers: "+cErr.message);

    const custs = (customers||[]).map(c=>({
      id: Number(c.customer_id),
      start: String(c.trade_start_date).slice(0,10),
      upfrontZ: N(c.upfront_contribution_zar,0),
      recurZ:   N(c.recurring_contribution_zar,0),
      upfrontB: N(c.upfront_contribution_btc,0),
    }));

    // Prices for the date range
    async function loadPrices(fromIncl:string,toIncl:string){
      const { data, error } = await sb
        .from("daily_data")
        .select("date_closing, btc_closing_price_usd")
        .gte("date_closing", fromIncl)
        .lte("date_closing", toIncl);
      if (error) throw new Error("prices: "+error.message);
      const m = new Map<string, number>();
      (data||[]).forEach((r:any)=> m.set(String(r.date_closing).slice(0,10), N(r.btc_closing_price_usd,0)));
      return m;
    }

    const results:any[] = [];
    let totalRows = 0;

    for (const c of custs) {
      // last std row (to continue balances)
      const { data: lastRow, error: lErr } = await sb
        .from("std_dca_customer_transactions")
        .select("transaction_date, closing_balance_usd, closing_balance_btc")
        .eq("customer_id", c.id)
        .order("transaction_date",{ascending:false})
        .limit(1);
      if (lErr) throw new Error("lastStd: "+lErr.message);
      const last = lastRow?.[0]?.transaction_date ? String(lastRow[0].transaction_date).slice(0,10) : null;
      let prevUsd: number | null = lastRow?.[0] ? N(lastRow[0].closing_balance_usd, null as any) : null;
      let prevBtc: number | null = lastRow?.[0] ? N(lastRow[0].closing_balance_btc, null as any) : null;

      const logicalFrom = last ? addDays(last,1) : addDays(c.start,1);
      const fromDate = force_from_date ? String(force_from_date).slice(0,10) : logicalFrom;
      if (toDate(fromDate) > toDate(dateTo)) {
        results.push({ customer_id: c.id, fromDate, toDate: dateTo, inserted: 0, note: "up-to-date" });
        continue;
      }

      const needFromDc = addDays(fromDate,-1);
      const prices = await loadPrices(needFromDc, dateTo);

      const rows:any[] = [];
      let invested = 0;

      for (let dc=needFromDc; toDate(dc) <= toDate(dateTo); dc = addDays(dc,1)){
        const price = prices.get(dc) ?? 0;
        const td = addDays(dc,1);
        if (toDate(td) < toDate(fromDate)) continue;

        const dim = daysInMonth(dc);
        const daily = dim ? (c.recurZ / dim) : 0;

        const isFirst = (prevUsd==null && prevBtc==null);
        const upfrontUsd = (APPLY_UPFRONT_USD_ON_DAY1 && isFirst) ? c.upfrontZ : 0;

        const obUsd = (prevUsd ?? 0) + daily + upfrontUsd;
        const obBtc = (prevBtc ?? c.upfrontB);

        const spendUsd = daily + upfrontUsd;          // <- goes to buy_usd
        const buyBtc = price ? (spendUsd/price) : 0;

        const cbUsd = obUsd - spendUsd;
        const cbBtc = obBtc + buyBtc;

        invested += spendUsd;

        rows.push({
          customer_id: c.id,
          transaction_date: td,
          [BTC_DATE_COL]: dc,                          // btc_date_closing
          btc_closing_price_usd: R(price,8),
          signal_type: "buy",
          daily_dca_usd: R(daily,2),
          buy_usd: R(spendUsd,2),                      // <- matches your schema name
          opening_balance_usd: R(obUsd,2),
          closing_balance_usd: R(cbUsd,2),
          opening_balance_btc: R(obBtc,8),
          closing_balance_btc: R(cbBtc,8),
          total_dca_invested_usd: R(invested,2),
        });

        prevUsd = cbUsd; prevBtc = cbBtc;
      }

      if (!dry_run && rows.length){
        const { error: upErr } = await sb
          .from("std_dca_customer_transactions")
          .upsert(rows, { onConflict: `customer_id,transaction_date,${BTC_DATE_COL}` });
        if (upErr) throw new Error("upsert: "+upErr.message);
        totalRows += rows.length;
      }

      results.push({ customer_id: c.id, fromDate, toDate: dateTo, rows: rows.length, inserted: dry_run?0:rows.length, dry_run: !!dry_run });
    }

    return new Response(JSON.stringify({ ok:true, dateTo, totalRows, results }), { headers: CORS });

  } catch (e:any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status:500, headers: CORS });
  }
});
