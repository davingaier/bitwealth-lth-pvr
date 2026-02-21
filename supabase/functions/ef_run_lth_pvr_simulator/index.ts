/**
 * LTH PVR Simulator Edge Function
 * 
 * Runs simulations for one or more strategy variations with configurable parameters.
 * Returns detailed daily results for charting and analysis.
 * 
 * Input Parameters:
 * - variation_ids: Array of UUIDs (optional - defaults to all active variations)
 * - start_date: YYYY-MM-DD (optional - defaults to 2020-01-01)
 * - end_date: YYYY-MM-DD (optional - defaults to today)
 * - upfront_usd: Initial investment (optional - defaults to 10000)
 * - monthly_usd: Monthly recurring investment (optional - defaults to 500)
 * 
 * Response:
 * - results: Array of SimulationResult objects (one per variation)
 * - metadata: org_id, date_range, days, upfront, monthly
 * 
 * @endpoint POST /ef_run_lth_pvr_simulator
 * @version 1.0.0
 * @created 2026-02-21
 */

import { getServiceClient } from "./client.ts";
import { runSimulation, SimulationResult, CIBandData, StrategyConfig } from "../_shared/lth_pvr_simulator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  // CORS preflight support
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  
  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  
  if (!org_id) {
    return new Response(
      JSON.stringify({ error: "ORG_ID not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  
  try {
    // Parse request body
    const body = await req.json().catch(() => ({}));
    
    // Default parameters (website defaults: $10K upfront, $500 monthly, 2020-2025)
    const today = new Date().toISOString().split('T')[0];
    const start_date = body.start_date ?? "2020-01-01";
    const end_date = body.end_date ?? today;
    const upfront_usd = body.upfront_usd ?? 10000;
    const monthly_usd = body.monthly_usd ?? 500;
    const variation_ids = body.variation_ids; // Array of UUIDs or null
    
    console.info(`ef_run_lth_pvr_simulator: start=${start_date}, end=${end_date}, upfront=${upfront_usd}, monthly=${monthly_usd}`);
    
    // Load CI bands data for date range
    const { data: ciData, error: ciErr } = await sb
      .from("ci_bands_daily")
      .select("*")
      .eq("org_id", org_id)
      .gte("date", start_date)
      .lte("date", end_date)
      .order("date", { ascending: true });
    
    if (ciErr) {
      throw new Error(`ci_bands_daily query failed: ${ciErr.message}`);
    }
    
    if (!ciData || ciData.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "No CI bands data found for date range",
          start_date,
          end_date,
          org_id
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Transform CI bands data to match simulator interface
    const ciDataTransformed: CIBandData[] = ciData.map((row: any) => ({
      close_date: row.date,
      btc_price_usd: row.btc_price,
      price_at_mean: row.price_at_mean,
      price_at_m025: row.price_at_m025,
      price_at_m050: row.price_at_m050,
      price_at_m075: row.price_at_m075,
      price_at_m100: row.price_at_m100,
      price_at_p025: row.price_at_p025,
      price_at_p050: row.price_at_p050,
      price_at_p075: row.price_at_p075,
      price_at_p100: row.price_at_p100,
      price_at_p125: row.price_at_p125,
      price_at_p150: row.price_at_p150,
      price_at_p175: row.price_at_p175,
      price_at_p200: row.price_at_p200,
      bear_pause: row.bear_pause
    }));
    
    // Load strategy variations
    let variationQuery = sb
      .from("strategy_variation_templates")
      .select("*")
      .eq("org_id", org_id)
      .eq("is_active", true);
    
    // Filter by variation_ids if provided
    if (variation_ids && Array.isArray(variation_ids) && variation_ids.length > 0) {
      variationQuery = variationQuery.in("id", variation_ids);
    }
    
    const { data: variations, error: varErr } = await variationQuery.order("sort_order", { ascending: true });
    
    if (varErr) {
      throw new Error(`strategy_variation_templates query failed: ${varErr.message}`);
    }
    
    if (!variations || variations.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "No strategy variations found",
          variation_ids,
          org_id
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.info(`ef_run_lth_pvr_simulator: running ${variations.length} variation(s)`);
    
    // Run simulations for each variation
    const results: Array<SimulationResult & { variation_id: string; variation_name: string; display_name: string }> = [];
    
    for (const variation of variations) {
      // Build StrategyConfig from variation
      const config: StrategyConfig = {
        B: {
          B1: Number(variation.b1),
          B2: Number(variation.b2),
          B3: Number(variation.b3),
          B4: Number(variation.b4),
          B5: Number(variation.b5),
          B6: Number(variation.b6),
          B7: Number(variation.b7),
          B8: Number(variation.b8),
          B9: Number(variation.b9),
          B10: Number(variation.b10),
          B11: Number(variation.b11)
        },
        bearPauseEnterSigma: Number(variation.bear_pause_enter_sigma),
        bearPauseExitSigma: Number(variation.bear_pause_exit_sigma),
        momentumLength: variation.momo_length ?? 5,
        momentumThreshold: Number(variation.momo_threshold ?? 0),
        enableRetrace: variation.enable_retrace ?? true,
        retraceBase: variation.retrace_base ?? 3
      };
      
      // Run simulation
      const simResult = runSimulation(config, ciDataTransformed, {
        upfront_usd,
        monthly_usd,
        org_id
      });
      
      // Add variation metadata
      results.push({
        ...simResult,
        variation_id: variation.id,
        variation_name: variation.variation_name,
        display_name: variation.display_name
      });
      
      console.info(`ef_run_lth_pvr_simulator: ${variation.variation_name} - NAV=$${simResult.final_nav_usd.toFixed(2)}, ROI=${simResult.final_roi_percent.toFixed(2)}%, CAGR=${simResult.final_cagr_percent.toFixed(2)}%`);
    }
    
    // Return results
    return new Response(
      JSON.stringify({
        success: true,
        metadata: {
          org_id,
          start_date,
          end_date,
          days: ciDataTransformed.length,
          upfront_usd,
          monthly_usd
        },
        results
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
    
  } catch (e) {
    console.error("ef_run_lth_pvr_simulator error:", e?.message ?? e, e?.stack ?? "");
    
    return new Response(
      JSON.stringify({ 
        error: e?.message ?? "Unknown error",
        stack: e?.stack ?? ""
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
