import { getServiceClient } from "./client.ts";
import { bucketLabel, decideTrade, computeBearPauseAt, StrategyConfig } from "../_shared/lth_pvr_strategy_logic.ts";
import { logAlert } from "../_shared/alerting.ts";

// --- Helpers -------------------------------------------------
async function getCI(sb: any, dateStr: string) {
  const { data, error } = await sb.from("ci_bands_daily").select("*").eq("date", dateStr).order("fetched_at", {
    ascending: false
  }).limit(1);
  if (error) throw new Error(`CI query failed: ${error.message}`);
  return data && data[0] ? data[0] : null;
}
// --- Handler -------------------------------------------------
Deno.serve(async (_req: any)=>{
  const started = Date.now();
  try {
    const sb = getServiceClient(); // lth_pvr schema
    const org_id = Deno.env.get("ORG_ID");
    if (!org_id) {
      console.error("ORG_ID missing");
      return new Response("ORG_ID missing", {
        status: 500
      });
    }
    // signal = yesterday (UTC); trade = today
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const signalDate = new Date(today.getTime() - 24 * 3600 * 1000);
    const signalStr = signalDate.toISOString().slice(0, 10);
    const tradeStr = today.toISOString().slice(0, 10);
    // CI + momentum
    const ci = await getCI(sb, signalStr);
    if (!ci) {
      console.error(`CI bands unavailable for ${signalStr}`);
      await logAlert(
        sb,
        "ef_generate_decisions",
        "error",
        `CI bands unavailable for ${signalStr}`,
        { signal_date: signalStr, trade_date: tradeStr },
        org_id
      );
      return new Response(`CI bands unavailable for ${signalStr}`, {
        status: 500
      });
    }
    const { data: hist, error: hErr } = await sb.from("ci_bands_daily").select("date, btc_price").lte("date", signalStr).order("date", {
      ascending: false
    }).limit(6);
    if (hErr) throw new Error(`CI history query failed: ${hErr.message}`);
    let roc5 = 0;
    if (hist && hist.length >= 6) {
      const pxT = Number(hist[0].btc_price ?? 0);
      const pxT5 = Number(hist[5].btc_price ?? 0);
      roc5 = pxT5 > 0 ? pxT / pxT5 - 1 : 0;
    }
    const px = Number(ci.btc_price ?? 0);
    
    // CRITICAL: Log actual CI bands data to track price source
    console.info(`ef_generate_decisions CI BANDS: date=${signalStr} btc_price=${ci.btc_price} px=${px} ci_obj=`, JSON.stringify(ci));
    
    // PROGRESSIVE VARIATION CONFIG (hard-coded until Phase 2 database schema)
    // TODO: Load from lth_pvr.strategy_variation_templates in Phase 2
    const PROGRESSIVE_CONFIG: StrategyConfig = {
      B: {
        B1: 0.22796,
        B2: 0.21397,
        B3: 0.19943,
        B4: 0.18088,
        B5: 0.12229,
        B6: 0.00157,
        B7: 0.00200,
        B8: 0.00441,
        B9: 0.01287,
        B10: 0.03300,
        B11: 0.09572,
      },
      bearPauseEnterSigma: 2.0,
      bearPauseExitSigma: -1.0,
      momentumLength: 5,
      momentumThreshold: 0.0,
      enableRetrace: true,
      retraceBase: 3, // Current production: uses Base 3 for retrace buys
    };
    
    // If we start mid-pause and there's no prior state, we need today's pause flag.
    const pauseNow = await computeBearPauseAt(sb, org_id, signalStr, PROGRESSIVE_CONFIG);
    // Active customers for this org (public.customer_strategies)
    // CRITICAL: Only process customers with registration_status='active'
    let custs = null;
    {
      // Query customer_strategies with live_enabled=true (consolidated table)
      const { data: cs, error: csErr } = await sb
        .schema("public")
        .from("customer_strategies")
        .select("customer_id, strategy_version_id")
        .eq("org_id", org_id)
        .eq("live_enabled", true);
      
      if (csErr) throw new Error(`customer_strategies query failed: ${csErr.message}`);
      
      // Filter by registration_status='active' from customer_details (public schema)
      if (cs && cs.length > 0) {
        const customerIds = cs.map(c => c.customer_id);
        const { data: activeCustomers, error: cdErr } = await sb
          .schema("public")
          .from("customer_details")
          .select("customer_id")
          .in("customer_id", customerIds)
          .eq("registration_status", "active");
        
        if (cdErr) throw new Error(`customer_details query failed: ${cdErr.message}`);
        
        // Only include customers that are in 'active' status
        const activeIds = new Set(activeCustomers?.map(c => c.customer_id) ?? []);
        custs = cs.filter(c => activeIds.has(c.customer_id));
      } else {
        custs = [];
      }
    }
    console.info(`ef_generate_decisions: ${signalStr} px=${px} roc5=${roc5.toFixed(4)} pauseNow=${pauseNow} custs=${custs?.length ?? 0}`);
    
    // Alert if no active customers found
    if (!custs || custs.length === 0) {
      await logAlert(
        sb,
        "ef_generate_decisions",
        "info",
        `No active customers found for org ${org_id}`,
        { signal_date: signalStr, trade_date: tradeStr },
        org_id
      );
    }
    
    // Strategy versions map
    const svIds = Array.from(new Set((custs ?? []).map((c: any)=>c.strategy_version_id).filter(Boolean)));
    const svMap = new Map();
    if (svIds.length) {
      const { data: svs, error: svErr } = await sb.from("strategy_versions").select("strategy_version_id,b1,b2,b3,b4,b5,b6,b7,b8,b9,b10,b11").in("strategy_version_id", svIds);
      if (svErr) throw new Error(`strategy_versions query failed: ${svErr.message}`);
      for (const s of svs ?? [])svMap.set(String(s.strategy_version_id), s);
    }
    // NOTE: strategy_versions table support maintained for backward compatibility
    // TODO: Deprecate in Phase 2 when strategy_variation_templates is implemented
    const DEFAULT_B = PROGRESSIVE_CONFIG.B;
    
    let wrote = 0;
    for (const c of custs ?? []){
      try {
        // Build config from strategy_versions (legacy) or use Progressive defaults
        const sv = svMap.get(String(c.strategy_version_id)) ?? {};
        const config: StrategyConfig = {
          B: {
            B1: Number(sv.b1 ?? DEFAULT_B.B1),
            B2: Number(sv.b2 ?? DEFAULT_B.B2),
            B3: Number(sv.b3 ?? DEFAULT_B.B3),
            B4: Number(sv.b4 ?? DEFAULT_B.B4),
            B5: Number(sv.b5 ?? DEFAULT_B.B5),
            B6: Number(sv.b6 ?? DEFAULT_B.B6),
            B7: Number(sv.b7 ?? DEFAULT_B.B7),
            B8: Number(sv.b8 ?? DEFAULT_B.B8),
            B9: Number(sv.b9 ?? DEFAULT_B.B9),
            B10: Number(sv.b10 ?? DEFAULT_B.B10),
            B11: Number(sv.b11 ?? DEFAULT_B.B11),
          },
          bearPauseEnterSigma: PROGRESSIVE_CONFIG.bearPauseEnterSigma,
          bearPauseExitSigma: PROGRESSIVE_CONFIG.bearPauseExitSigma,
          momentumLength: PROGRESSIVE_CONFIG.momentumLength,
          momentumThreshold: PROGRESSIVE_CONFIG.momentumThreshold,
          enableRetrace: PROGRESSIVE_CONFIG.enableRetrace,
          retraceBase: PROGRESSIVE_CONFIG.retraceBase,
        };
        // prior state (< signal date)
        const { data: prevs, error: pErr } = await sb.from("customer_state_daily").select("bear_pause,was_above_p1,was_above_p15,r1_armed,r15_armed").eq("org_id", org_id).eq("customer_id", c.customer_id).lt("date", signalStr).order("date", {
          ascending: false
        }).limit(1);
        if (pErr) throw new Error(`customer_state_daily query failed: ${pErr.message}`);
        const prev = prevs?.[0] ? {
          bear_pause: !!prevs[0].bear_pause,
          was_above_p1: !!prevs[0].was_above_p1,
          was_above_p15: !!prevs[0].was_above_p15,
          r1_armed: !!prevs[0].r1_armed,
          r15_armed: !!prevs[0].r15_armed
        } : {
          // No previous state: seed from historical pause computation
          bear_pause: !!pauseNow,
          was_above_p1: false,
          was_above_p15: false,
          r1_armed: true,
          r15_armed: true
        };
        const { action, pct, rule, note, state } = decideTrade(px, ci, roc5, prev, config);
        const band_bucket = bucketLabel(px, ci);
        // decisions upsert
        const up = await sb.from("decisions_daily").upsert({
          org_id,
          customer_id: c.customer_id,
          signal_date: signalStr,
          trade_date: tradeStr,
          price_usd: px,
          band_bucket,
          action,
          amount_pct: Number.isFinite(pct) && pct >= 0 ? pct : 0,
          rule,
          note,
          strategy_version_id: c.strategy_version_id
        }, {
          onConflict: "org_id,customer_id,trade_date"
        });
        if (up.error) throw new Error(`decisions_daily upsert failed: ${up.error.message}`);
        // state upsert (best-effort)
        const st = await sb.from("customer_state_daily").upsert({
          org_id,
          customer_id: c.customer_id,
          date: signalStr,
          bear_pause: !!state.bear_pause,
          was_above_p1: !!state.was_above_p1,
          was_above_p15: !!state.was_above_p15,
          r1_armed: !!state.r1_armed,
          r15_armed: !!state.r15_armed
        }, {
          onConflict: "org_id,customer_id,date"
        });
        if (st.error) console.error("state upsert err", st.error);
        wrote++;
      } catch (err) {
        console.error(`Decision generation failed for customer ${c.customer_id}:`, err);
        await logAlert(
          sb,
          "ef_generate_decisions",
          "error",
          `Decision generation failed for customer ${c.customer_id}`,
          {
            customer_id: c.customer_id,
            signal_date: signalStr,
            trade_date: tradeStr,
            error: err instanceof Error ? err.message : String(err)
          },
          org_id,
          c.customer_id
        );
      }
    }
    console.info(`ef_generate_decisions done: wrote=${wrote} in ${Date.now() - started}ms`);
    
    // VALIDATION: Check if written decisions match CI bands price (sanity check)
    try {
      const { data: writtenDecisions, error: vErr } = await sb
        .from("decisions_daily")
        .select("customer_id, price_usd")
        .eq("org_id", org_id)
        .eq("trade_date", tradeStr)
        .limit(1);
      
      if (!vErr && writtenDecisions && writtenDecisions.length > 0) {
        const decisionPrice = Number(writtenDecisions[0].price_usd);
        const ciBandsPrice = px;
        const pctDiff = ciBandsPrice > 0 ? Math.abs((decisionPrice / ciBandsPrice - 1) * 100) : 0;
        
        console.info(`ef_generate_decisions VALIDATION: decision_price=${decisionPrice} ci_bands_price=${ciBandsPrice} diff=${pctDiff.toFixed(2)}%`);
        
        if (pctDiff > 2.0) {
          await logAlert(
            sb,
            "ef_generate_decisions",
            "error",
            `Price discrepancy detected: decision price ${decisionPrice} differs from CI bands price ${ciBandsPrice} by ${pctDiff.toFixed(2)}%`,
            {
              decision_price: decisionPrice,
              ci_bands_price: ciBandsPrice,
              signal_date: signalStr,
              trade_date: tradeStr,
              pct_diff: pctDiff
            },
            org_id
          );
        }
      }
    } catch (valErr) {
      console.error("Price validation failed:", valErr);
    }
    
    return new Response("ok");
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const errStack = e instanceof Error ? e.stack : "";
    console.error("ef_generate_decisions error:", errMsg, errStack);
    // Log top-level pipeline failure
    try {
      const sb = getServiceClient();
      const org_id = Deno.env.get("ORG_ID");
      await logAlert(
        sb,
        "ef_generate_decisions",
        "error",
        "Decision generation pipeline failed",
        { error: errMsg },
        org_id
      );
    } catch (alertErr) {
      console.error("Failed to log pipeline error alert:", alertErr);
    }
    return new Response(`error: ${errMsg}`, {
      status: 500
    });
  }
});
