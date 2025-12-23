// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL");
const KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!URL || !KEY) throw new Error("Missing SB_URL/SB_SERVICE_ROLE_KEY");
const sb = createClient(URL, KEY);

// --- utils ---
const ydayUTC = () => { const d=new Date(Date.now()-86400000); return d.toISOString().slice(0,10); };
const toDate = (s:string)=> new Date(s+"T00:00:00Z");
const addDays = (s:string,n:number)=>{ const d=toDate(s); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const daysInMonth = (iso:string)=>{ const d=toDate(iso); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).getUTCDate(); };
const N = (x:any,d=0)=>{ const n=Number(x); return Number.isFinite(n)?n:d; };
const B = (x:any)=> !!x;
const R = (n:number,dp:number)=>{ const m=10**dp; return Math.round(n*m)/m; };

// load daily_data prices (fallback if rules row has no price)
async function loadPrices(fromIncl:string, toIncl:string): Promise<Map<string, number>> {
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
      tradeStart: String(c.trade_start_date).slice(0,10),
      upfrontZ: N(c.upfront_contribution_zar,0),
      recurZ:   N(c.recurring_contribution_zar,0),
      upfrontB: N(c.upfront_contribution_btc,0),
    }));

    async function lastTxDate(cid:number){
      const { data, error } = await sb
        .from("adv_dca_customer_transactions")
        .select("transaction_date")
        .eq("customer_id", cid)
        .order("transaction_date",{ascending:false})
        .limit(1);
      if (error) throw new Error("lastTx: "+error.message);
      return data?.[0]?.transaction_date ? String(data[0].transaction_date).slice(0,10) : null;
    }

    // Select '*' to avoid column-not-found; we’ll probe fields at runtime.
    async function loadRules(cid:number, fromDate:string, toDateStr:string){
      const dayBeforeFrom = addDays(fromDate,-1);
      const { data, error } = await sb
        .from("adv_dca_buy_sell_rules")
        .select("*")
        .eq("customer_id", cid)
        .gte("date_closing", dayBeforeFrom)
        .lte("date_closing", toDateStr)
        .order("date_closing",{ascending:true});
      if (error) throw new Error("rules: "+error.message);
      return (data||[]).map((r:any)=>({ ...r, date_closing: String(r.date_closing).slice(0,10) }));
    }

    const results:any[] = [];

    for (const cust of custs){
      const last = await lastTxDate(cust.id);
      const startCandidate = last ? addDays(last,1) : addDays(cust.tradeStart,1);
      const fromDate = force_from_date ? String(force_from_date).slice(0,10) : startCandidate;
      if (toDate(fromDate) > toDate(dateTo)) {
        results.push({ customer_id: cust.id, fromDate, toDate: dateTo, rows: 0, inserted: 0, note: "up-to-date" });
        continue;
      }

      const rules = await loadRules(cust.id, fromDate, dateTo);
      if (!rules.length) {
        results.push({ customer_id: cust.id, fromDate, toDate: dateTo, rows: 0, inserted: 0, note: "no rules in range" });
        continue;
      }

      // price fallback
      const priceMap = await loadPrices(addDays(fromDate,-1), dateTo);

      // seed from last tx if present
      let prevUsd:number|null=null, prevBtc:number|null=null;
      if (last){
        const { data: prev, error: pErr } = await sb
          .from("adv_dca_customer_transactions")
          .select("closing_balance_usd, closing_balance_btc")
          .eq("customer_id", cust.id)
          .eq("transaction_date", last)
          .limit(1);
        if (pErr) throw new Error("seed: "+pErr.message);
        if (prev?.length){ prevUsd=N(prev[0].closing_balance_usd,null as any); prevBtc=N(prev[0].closing_balance_btc,null as any); }
      }

      const toInsert:any[] = [];

      for (const r of rules){
        const dc = r.date_closing;
        const td = addDays(dc,1);
        if (toDate(td) < toDate(fromDate) || toDate(td) > toDate(dateTo)) continue;

        const price = N(r.btc_closing_price_usd ?? r.btc_close_usd ?? r.close_usd ?? priceMap.get(dc) ?? 0, 0);
        const dim = daysInMonth(dc);
        const dailyDcaUsd = dim ? (cust.recurZ / dim) : 0;

        const obUsd = (prevUsd==null ? (cust.upfrontZ + dailyDcaUsd) : (prevUsd + dailyDcaUsd));
        const obBtc = (prevBtc==null ? cust.upfrontB : prevBtc);

        // probe rule fields safely (default false/0)
        const omegaOn   = B(r.omega_on_off ?? r.omega_enabled);
        const obuy      = B(r.omega_buy_signal ?? r.omega_buy);
        const osell     = B(r.omega_sell_signal ?? r.omega_sell);
        const obuyGap   = B(r.omega_buy_days_between_signal ?? r.omega_buy_gap_ok ?? true);
        const osellGap  = B(r.omega_sell_days_between_signal ?? r.omega_sell_gap_ok ?? true);
        const obuyPct   = N(r.omega_buy_step_percent ?? r.omega_buy_step_pct ?? 0, 0);
        const osellPct  = N(r.omega_sell_step_percent ?? r.omega_sell_step_pct ?? 0, 0);

        const sabBuy    = B(r.sab_buy_signal ?? r.std_buy_signal ?? false);
        const sabUnpause= B(r.sab_dca_unpause_buy_signal ?? true);

        let omega_buy_usd=0, omega_sell_usd=0, sab_buy_usd=0, source_signal="omega";

        if (omegaOn){
          if (obuy && obuyGap)  omega_buy_usd  = obuyPct  * obUsd;          // percent-of-USD balance
          if (osell && osellGap) omega_sell_usd = osellPct * obBtc * price; // percent-of-BTC * price
          source_signal = "omega";
        } else {
          if (sabBuy && sabUnpause) sab_buy_usd = obUsd; // full spend
          source_signal = "sab";
        }

        const cbUsd = obUsd - omega_buy_usd - sab_buy_usd + omega_sell_usd;

        const buy_btc  = price ? (omega_buy_usd/price) : 0;
        const sell_btc = price ? (omega_sell_usd/price) : 0;
        const sab_btc  = price ? (sab_buy_usd/price)  : 0;
        const cbBtc    = obBtc + buy_btc + sab_btc - sell_btc;

        const signal_type = (omega_sell_usd>0) ? "sell" : ((omega_buy_usd>0 || sab_buy_usd>0) ? "buy" : null);

        toInsert.push({
          customer_id: cust.id,
          transaction_date: td,
          date_closing: dc,
          signal_type, source_signal,

          daily_dca_usd:       R(dailyDcaUsd,2),
          opening_balance_usd: R(obUsd,2),
          closing_balance_usd: R(cbUsd,2),
          opening_balance_btc: R(obBtc,8),
          closing_balance_btc: R(cbBtc,8),

          btc_closing_price_usd: R(price,8),

          omega_buy_usd:  R(omega_buy_usd,2),
          omega_sell_usd: R(omega_sell_usd,2),
          sab_buy_usd:    R(sab_buy_usd,2),

          omega_buy_btc:  R(buy_btc,8),
          omega_sell_btc: R(sell_btc,8),
          sab_buy_btc:    R(sab_btc,8),
        });

        prevUsd = cbUsd; prevBtc = cbBtc;
      }

      if (!dry_run && toInsert.length){
        const { error: upErr } = await sb
          .from("adv_dca_customer_transactions")
          .upsert(toInsert, { onConflict: "customer_id,transaction_date,date_closing" });
        if (upErr) throw new Error("upsert: "+upErr.message);
      }

      results.push({ customer_id: cust.id, rows: toInsert.length, inserted: dry_run?0:toInsert.length, fromDate, toDate: dateTo, dry_run: !!dry_run });
    }

    const totalRows = results.reduce((s,r)=>s+(r.inserted||0),0);
    return new Response(JSON.stringify({ ok:true, dateTo, totalRows, results }), { headers: CORS });

  } catch (e:any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status:500, headers: CORS });
  }
});
