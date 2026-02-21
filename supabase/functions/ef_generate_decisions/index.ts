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
    
    // Active customers with their strategy variations (Phase 2: Load from database)
    // Note: Must query customer_strategies and strategy_variation_templates separately
    // because they're in different schemas (public vs lth_pvr) and PostgREST doesn't auto-detect cross-schema FKs
    let custs = null;
    let variationsMap = new Map();
    {
      // Step 1: Get active LTH_PVR customers
      const { data: cs, error: csErr } = await sb
        .schema("public")
        .from("customer_strategies")
        .select("customer_id, strategy_variation_id")
        .eq("org_id", org_id)
        .eq("strategy_code", "LTH_PVR")
        .eq("live_enabled", true);
      
      if (csErr) throw new Error(`customer_strategies query failed: ${csErr.message}`);
      
      // Step 2: Filter by registration_status='active' from customer_details
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
        
        // Step 3: Get strategy variations for these customers
        const variationIds = Array.from(new Set(custs.map(c => c.strategy_variation_id).filter(Boolean)));
        if (variationIds.length > 0) {
          const { data: variations, error: varErr } = await sb
            .schema("lth_pvr")
            .from("strategy_variation_templates")
            .select("*")
            .in("id", variationIds);
          
          if (varErr) throw new Error(`strategy_variation_templates query failed: ${varErr.message}`);
          
          // Build variations map for quick lookup
          for (const v of variations ?? []) {
            variationsMap.set(String(v.id), v);
          }
        }
      } else {
        custs = [];
      }
    }
    console.info(`ef_generate_decisions: ${signalStr} px=${px} roc5=${roc5.toFixed(4)} custs=${custs?.length ?? 0}`);
    
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
      return new Response(JSON.stringify({ ok: true, wrote: 0, reason: "no_active_customers" }), { headers: { "Content-Type": "application/json" }});
    }
    
    // Get default production config for computeBearPauseAt (uses first customer's variation as proxy)
    // All customers currently use same variation (progressive), so this is safe
    const firstCustomer = custs[0];
    const defaultVariation = variationsMap.get(String(firstCustomer.strategy_variation_id));
    if (!defaultVariation) {
      throw new Error(`Customer ${firstCustomer.customer_id} has no strategy_variation_id assigned or variation not found`);
    }
    
    const defaultConfig: StrategyConfig = {
      B: {
        B1: Number(defaultVariation.b1 ?? 0.22796),
        B2: Number(defaultVariation.b2 ?? 0.21397),
        B3: Number(defaultVariation.b3 ?? 0.19943),
        B4: Number(defaultVariation.b4 ?? 0.18088),
        B5: Number(defaultVariation.b5 ?? 0.12229),
        B6: Number(defaultVariation.b6 ?? 0.00157),
        B7: Number(defaultVariation.b7 ?? 0.00200),
        B8: Number(defaultVariation.b8 ?? 0.00441),
        B9: Number(defaultVariation.b9 ?? 0.01287),
        B10: Number(defaultVariation.b10 ?? 0.03300),
        B11: Number(defaultVariation.b11 ?? 0.09572),
      },
      bearPauseEnterSigma: Number(defaultVariation.bear_pause_enter_sigma ?? 2.0),
      bearPauseExitSigma: Number(defaultVariation.bear_pause_exit_sigma ?? -1.0),
      momentumLength: Number(defaultVariation.momentum_length ?? 5),
      momentumThreshold: Number(defaultVariation.momentum_threshold ?? 0.0),
      enableRetrace: defaultVariation.enable_retrace ?? true,
      retraceBase: Number(defaultVariation.retrace_base ?? 3),
    };
    
    // Compute bear pause state (used for all customers since they share same variation)
    const pauseNow = await computeBearPauseAt(sb, org_id, signalStr, defaultConfig);
    
    let wrote = 0;
    for (const c of custs ?? []){
      try {
        // Build config from strategy_variation_templates (Phase 2: Database-driven)
        const variation = variationsMap.get(String(c.strategy_variation_id));
        if (!variation) {
          console.warn(`Customer ${c.customer_id} has no strategy_variation - skipping`);
          continue;
        }
        
        const config: StrategyConfig = {
          B: {
            B1: Number(variation.b1 ?? 0.22796),
            B2: Number(variation.b2 ?? 0.21397),
            B3: Number(variation.b3 ?? 0.19943),
            B4: Number(variation.b4 ?? 0.18088),
            B5: Number(variation.b5 ?? 0.12229),
            B6: Number(variation.b6 ?? 0.00157),
            B7: Number(variation.b7 ?? 0.00200),
            B8: Number(variation.b8 ?? 0.00441),
            B9: Number(variation.b9 ?? 0.01287),
            B10: Number(variation.b10 ?? 0.03300),
            B11: Number(variation.b11 ?? 0.09572),
          },
          bearPauseEnterSigma: Number(variation.bear_pause_enter_sigma ?? 2.0),
          bearPauseExitSigma: Number(variation.bear_pause_exit_sigma ?? -1.0),
          momentumLength: Number(variation.momentum_length ?? 5),
          momentumThreshold: Number(variation.momentum_threshold ?? 0.0),
          enableRetrace: variation.enable_retrace ?? true,
          retraceBase: Number(variation.retrace_base ?? 3),
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
