// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function — create-daily-rules (v8)
// Fully aligned to advanced_btc_dca.py (rules + ladders + latches)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
/* ---------- CORS ---------- */ const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, prefer, x-client-info",
  Vary: "Origin",
  "Content-Type": "application/json"
};
const json = (p, s = 200)=>new Response(JSON.stringify(p), {
    status: s,
    headers: CORS
  });
/* ---------- ENV ---------- */ const URL = Deno.env.get("SUPABASE_URL");
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!URL || !KEY) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
/* ---------- date utils ---------- */ const toISO = (d)=>d.toISOString().slice(0, 10);
const addDays = (iso, n)=>{
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
};
const maxISO = (a, b)=>a > b ? a : b;
const minISO = (a, b)=>a < b ? a : b;
/* ---------- helpers ---------- */ function gateByGap(signal, gapDays) {
  const out = [];
  let last = -1_000_000_000;
  signal.forEach((v, i)=>{
    if (v && i - last >= gapDays) {
      out.push(true);
      last = i;
    } else out.push(false);
  });
  return out;
}
/** Ladder with cadence reset and HOLD on non-qual days */ function ladderStreakGapReset(base, step, maxv, trigger, gapDays) {
  const n = trigger.length;
  const vals = [];
  let bumps = 0;
  for(let i = 0; i < n; i++){
    if (trigger[i]) {
      const j = i - gapDays;
      if (j < 0 || !trigger[j]) bumps = 0; // cadence broken -> reset
      vals.push(Math.min(maxv, base + bumps * step));
      bumps += 1; // next qualified day
    } else {
      // HOLD value on non-qual days
      vals.push(Math.min(maxv, base + bumps * step));
    }
  }
  return vals;
}
/* ---------- paging ---------- */ async function pageDaily(sb, fromDate) {
  const PAGE = 1000;
  let start = 0;
  const rows = [];
  for(;;){
    const { data, error } = await sb.from("daily_data").select("date_closing, btc_closing_price_usd, smoothed_risk_score, omega_score, sab_below_neg_1sd, sab_below_neg_2sd, omega_on_off").gte("date_closing", fromDate).order("date_closing", {
      ascending: true
    }).range(start, start + PAGE - 1);
    if (error) throw error;
    rows.push(...data ?? []);
    if ((data ?? []).length < PAGE) break;
    start += PAGE;
  }
  return rows;
}
async function lastRuleDate(sb, cid) {
  const { data, error } = await sb.from("adv_dca_buy_sell_rules").select("date_closing").eq("customer_id", cid).order("date_closing", {
    ascending: false
  }).limit(1);
  if (error) throw error;
  return data?.[0]?.date_closing ? String(data[0].date_closing).slice(0, 10) : null;
}
/* ---------- handler ---------- */ Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: CORS
  });
  if (req.method !== "POST") return json({
    ok: false,
    error: "Method not allowed"
  }, 405);
  const body = await req.json().catch(()=>({}));
  const dryRun = !!(body.dry_run ?? body.dryRun);
  const forceFrom = body.force_from_date ? String(body.force_from_date).slice(0, 10) : null;
  const sb = createClient(URL, KEY, {
    auth: {
      persistSession: false
    }
  });
  try {
    // Active customers
    const { data: custs } = await sb.from("customer_details").select("customer_id, trade_start_date, customer_status").eq("customer_status", "Active");
    const active = (custs ?? []).map((c)=>({
        id: Number(c.customer_id),
        start: String(c.trade_start_date).slice(0, 10)
      }));
    if (!active.length) return json({
      ok: true,
      customers: 0,
      inserted: 0,
      preview: []
    });
    // Newest thresholds
    const { data: omegaCfg } = await sb.from("adv_dca_omega_thresholds").select("id, buy_threshold, sell_threshold, buy_base, buy_step, buy_max, sell_base, sell_step, sell_max, buy_days_between, sell_days_between").order("id", {
      ascending: false
    }).limit(1).single();
    const { data: sabCfg } = await sb.from("adv_dca_sab_thresholds").select("id, buy_threshold").order("id", {
      ascending: false
    }).limit(1).single();
    const omegaCfgId = Number(omegaCfg.id);
    const sabCfgId = Number(sabCfg.id);
    // Determine per-customer start and global history seed
    let globalSeedFrom = "9999-12-31";
    let globalFrom = "9999-12-31";
    const fromByCustomer = {};
    for (const c of active){
      const firstEligible = addDays(c.start, -1); // day before first trade day
      globalSeedFrom = minISO(globalSeedFrom, firstEligible);
      const last = await lastRuleDate(sb, c.id);
      const next = last ? maxISO(addDays(last, 1), firstEligible) : firstEligible;
      const f = forceFrom ? maxISO(forceFrom, next) : next;
      fromByCustomer[c.id] = f;
      globalFrom = minISO(globalFrom, f);
    }
    if (globalSeedFrom === "9999-12-31") globalSeedFrom = "1900-01-01";
    if (globalFrom === "9999-12-31") globalFrom = "1900-01-01";
    // Load history
    const histAll = await pageDaily(sb, globalSeedFrom);
    const rowsToInsert = [];
    const preview = [];
    for (const c of active){
      const hist = histAll.filter((r)=>String(r.date_closing).slice(0, 10) >= addDays(c.start, -1)).map((r)=>({
          date: String(r.date_closing).slice(0, 10),
          price: Number(r.btc_closing_price_usd ?? 0),
          risk: Number(r.smoothed_risk_score ?? NaN),
          omega: Number(r.omega_score ?? NaN),
          sabNeg1: Number(r.sab_below_neg_1sd ?? NaN),
          sabNeg2: Number(r.sab_below_neg_2sd ?? NaN),
          omegaOn: !!r.omega_on_off
        }));
      if (!hist.length) continue;
      // SAB signals (Python parity)
      const sab_buy_signal = hist.map((h)=>h.risk < Number(sabCfg.buy_threshold));
      const sab_price_below_buy_signal = hist.map((h)=>Number.isFinite(h.sabNeg2) && Number.isFinite(h.price) ? h.price < h.sabNeg2 : false);
      // Latch sab_dca_unpause_buy_signal
      const sab_unpause = [];
      let prev = false;
      hist.forEach((h, i)=>{
        const buy = sab_buy_signal[i];
        const below = sab_price_below_buy_signal[i];
        let curr = buy && (below || prev);
        if (i === 0 && !h.omegaOn && buy) curr = true;
        sab_unpause.push(curr);
        prev = curr;
      });
      // Ω signals + cadence
      const ob = hist.map((h)=>h.omega <= Number(omegaCfg.buy_threshold));
      const os = hist.map((h)=>h.omega >= Number(omegaCfg.sell_threshold));
      const buyGap = Number(omegaCfg.buy_days_between);
      const sellGap = Number(omegaCfg.sell_days_between);
      const obGapOk = gateByGap(ob, buyGap);
      const osGapOk = gateByGap(os, sellGap);
      // Ladders (gap-reset, hold)
      const buyPct = ladderStreakGapReset(Number(omegaCfg.buy_base), Number(omegaCfg.buy_step), Number(omegaCfg.buy_max), obGapOk, buyGap);
      const sellPct = ladderStreakGapReset(Number(omegaCfg.sell_base), Number(omegaCfg.sell_step), Number(omegaCfg.sell_max), osGapOk, sellGap);
      // Insert from each customer's “from” date
      const from = fromByCustomer[c.id];
      hist.forEach((h, i)=>{
        if (h.date < from) return;
        rowsToInsert.push({
          customer_id: c.id,
          date_closing: h.date,
          // thresholds used
          sab_threshold_id: sabCfgId,
          omega_threshold_id: omegaCfgId,
          // write back price & omega_on_off for traceability
          btc_closing_price_usd: h.price,
          omega_on_off: h.omegaOn,
          // SAB flags
          sab_buy_signal: sab_buy_signal[i],
          sab_price_below_buy_signal: sab_price_below_buy_signal[i],
          sab_dca_unpause_buy_signal: sab_unpause[i],
          // Ω flags
          omega_buy_signal: ob[i],
          omega_sell_signal: os[i],
          omega_buy_days_between_signal: obGapOk[i],
          omega_sell_days_between_signal: osGapOk[i],
          // ladders
          omega_buy_step_percent: buyPct[i],
          omega_sell_step_percent: sellPct[i]
        });
        preview.push({
          customer_id: c.id,
          date_closing: h.date,
          sab_buy_signal: sab_buy_signal[i],
           sab_price_below_buy_signal: sab_price_below_buy_signal[i],
          sab_unpause: sab_unpause[i],
          omega_buy_signal: ob[i],
          omega_buy_gap_ok: obGapOk[i],
          omega_buy_pct: buyPct[i],
        });
      });
    }
    let inserted = 0;
    if (!dryRun && rowsToInsert.length) {
      const { error } = await sb.from("adv_dca_buy_sell_rules").upsert(rowsToInsert, {
        onConflict: "customer_id,date_closing"
      });
      if (error) throw error;
      inserted = rowsToInsert.length;
    }
    // support an optional preview limit coming from the UI
    const prevLimit = Math.max(1, Math.min(2000, Number(body.preview_limit ?? body.previewLimit ?? 100) // default 100
    ));
    return json({
      ok: true,
      version: "create-daily-rules v8",
      dryRun,
      customers: active.length,
      to_insert: rowsToInsert.length,
      inserted,
      preview: preview.slice(0, prevLimit),
      sample: preview.slice(0, 50)
    });
  } catch (e) {
    console.error("create-daily-rules failed", e);
    return json({
      ok: false,
      error: String(e?.message || e)
    }, 500);
  }
});
