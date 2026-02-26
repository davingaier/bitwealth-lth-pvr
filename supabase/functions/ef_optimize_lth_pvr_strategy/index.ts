import { getServiceClient } from "./client.ts";
import { optimizeParameters, generateSmartRanges, validateOptimizationConfig } from "../_shared/lth_pvr_optimizer.ts";
import { runSimulation } from "../_shared/lth_pvr_simulator.ts";
import type { CIBandData } from "../_shared/lth_pvr_simulator.ts";
import type { StrategyConfig } from "../_shared/lth_pvr_strategy_logic.ts";

Deno.serve(async (req) => {
  // CORS for browser/Admin UI access
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const sb = getServiceClient();
    const org_id = Deno.env.get("ORG_ID");

    if (!org_id) {
      return new Response(JSON.stringify({ error: "ORG_ID not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Parse input
    const body = await req.json();
    const {
      variation_id,
      start_date = "2020-01-01",
      end_date = new Date().toISOString().split("T")[0],
      upfront_usd = 10000,
      monthly_usd = 500,
      objective = "cagr",  // nav | cagr | roi | sharpe
      grid_size = 3,       // Number of points per parameter (default: 3 = current ± 20%)
      max_results = 6,     // Top N results to return (default: 6)
      // Optional: manually specify ranges for specific parameters
      b_ranges = null,      // { b1: { min, max, step }, b2: {...}, ... }
      momo_length_range = null,
      momo_threshold_range = null,
    } = body;

    if (!variation_id) {
      return new Response(JSON.stringify({ error: "variation_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Validate objective
    const validObjectives = ["nav", "cagr", "roi", "sharpe"];
    if (!validObjectives.includes(objective)) {
      return new Response(
        JSON.stringify({ error: `Invalid objective: ${objective}. Must be one of: ${validObjectives.join(", ")}` }),
        { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    // ===== Load current variation config from database =====
    const { data: variations, error: varError } = await sb
      .from("strategy_variation_templates")
      .select("*")
      .eq("id", variation_id)
      .eq("org_id", org_id)
      .single();

    if (varError || !variations) {
      return new Response(
        JSON.stringify({ error: `Variation not found: ${variation_id}` }),
        { status: 404, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    const currentConfig: StrategyConfig = {
      B: {
        B1: Number(variations.b1),
        B2: Number(variations.b2),
        B3: Number(variations.b3),
        B4: Number(variations.b4),
        B5: Number(variations.b5),
        B6: Number(variations.b6),
        B7: Number(variations.b7),
        B8: Number(variations.b8),
        B9: Number(variations.b9),
        B10: Number(variations.b10),
        B11: Number(variations.b11),
      },
      bearPauseEnterSigma: Number(variations.bear_pause_enter_sigma),
      bearPauseExitSigma: Number(variations.bear_pause_exit_sigma),
      momentumLength: variations.momo_length ?? 5,
      momentumThreshold: Number(variations.momo_threshold ?? 0),
      enableRetrace: variations.enable_retrace ?? true,
      retraceBase: variations.retrace_base ?? 3,
    };

    // ===== Load CI bands data (with 2-year warmup for retrace flag initialisation) =====
    // Mirrors the warmup logic in ef_bt_execute (v0.6.54) and ef_run_lth_pvr_simulator (v0.6.53).
    const warmupStartDate = (() => {
      const d = new Date(start_date);
      d.setFullYear(d.getFullYear() - 2);
      return d.toISOString().slice(0, 10);
    })();

    const { data: bands, error: bandsError } = await sb
      .from("ci_bands_daily")
      .select("*")
      .eq("org_id", org_id)
      .gte("date", warmupStartDate)
      .lte("date", end_date)
      .order("date", { ascending: true });

    if (bandsError || !bands || bands.length === 0) {
      return new Response(
        JSON.stringify({ error: `No CI bands data found for date range ${start_date} to ${end_date}` }),
        { status: 404, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Transform CI bands data to match simulator interface
    const ciData: CIBandData[] = bands.map((row: any) => ({
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
      price_at_p250: row.price_at_p250,
      bear_pause: row.bear_pause
    }));
    
    console.log(`Loaded ${ciData.length} CI bands records (warmup from ${warmupStartDate}, financial from ${start_date})`);
    console.log(`Last record: ${ciData[ciData.length-1]?.close_date}`);

    // ===== Generate smart ranges if not provided =====
    // Always start with smart defaults, then merge user-specified ranges
    const smartDefaultRanges = { min: 5, max: 5, step: 1 };  // No optimization by default (current value only)  
    const finalRanges = b_ranges || {};  // Use partial user ranges if provided
    const finalMomoLengthRange = momo_length_range ?? { min: 5, max: 5, step: 1 };
    const finalMomoThresholdRange = momo_threshold_range ?? { min: 0.0, max: 0.0, step: 0.01 };

    // ===== Build optimization config =====
    const optConfig = {
      baseConfig: currentConfig,
      b_ranges: finalRanges,
      momo_length_range: finalMomoLengthRange,
      momo_threshold_range: finalMomoThresholdRange,
      objective,
      max_results,
      progress_interval: 0.1,  // Report every 10%
      onProgress: (current: number, total: number, percent: number) => {
        console.log(`Optimization progress: ${current}/${total} (${percent.toFixed(1)}%)`);
      },
    };

    // Validate config
    const validationErrors = validateOptimizationConfig(optConfig);
    if (validationErrors.length > 0) {
      return new Response(
        JSON.stringify({ error: "Invalid optimization config", validation_errors: validationErrors }),
        { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    // ===== Run optimization =====
    const simParams = {
      upfront_usd: upfront_usd,
      monthly_usd: monthly_usd,
      org_id: org_id,
      sim_start_date: start_date,  // warmup rows before this date not counted as financial
    };

    console.log(`Starting optimization for variation ${variations.variation_name}...`);
    console.log(`  Date range: ${start_date} to ${end_date}`);
    console.log(`  Objective: ${objective}`);
    console.log(`  Grid size: ${grid_size}×${grid_size}×... (parameter count varies)`);

    // ===== Run current config as baseline (for comparison) =====
    const baselineResult = runSimulation(currentConfig, ciData, {
      upfront_usd,
      monthly_usd,
      org_id,
      sim_start_date: start_date,
    });

    const optResults = optimizeParameters(optConfig, ciData, simParams);

    // Check if any valid combinations were found
    if (!optResults.best) {
      return new Response(
        JSON.stringify({
          error: "No valid parameter combinations found",
          details: "All combinations violated the monotonicity constraint (B1 >= B2 >= ... >= B11)",
          combinations_tested: optResults.combinations_tested,
          combinations_skipped: optResults.combinations_skipped,
          execution_time_seconds: optResults.execution_time_seconds,
        }),
        { status: 404, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    console.log(`Optimization complete!`);
    console.log(`  Best score: ${optResults.best.objective_value.toFixed(4)}`);
    console.log(`  Combinations tested: ${optResults.combinations_tested}`);
    console.log(`  Combinations skipped: ${optResults.combinations_skipped}`);
    console.log(`  Execution time: ${optResults.execution_time_seconds.toFixed(2)}s`);

    // Helper: extract all summary metrics from a SimulationResult (no daily/ledger arrays)
    const summarise = (r: any) => ({
      final_nav_usd: r.final_nav_usd,
      final_roi_percent: r.final_roi_percent,
      final_cagr_percent: r.final_cagr_percent,
      max_drawdown_percent: r.max_drawdown_percent,
      sharpe_ratio: r.sharpe_ratio,
      cash_drag_percent: r.cash_drag_percent,
      final_btc_balance: r.final_btc_balance,
      final_usdt_balance: r.final_usdt_balance,
      total_contrib_gross_usdt: r.total_contrib_gross_usdt,
      total_platform_fees_usdt: r.total_platform_fees_usdt,
      total_performance_fees_usdt: r.total_performance_fees_usdt,
      total_exchange_fees_btc: r.total_exchange_fees_btc,
    });

    // ===== Build response =====
    const response = {
      success: true,
      variation_id,
      variation_name: variations.variation_name,
      date_range: { start_date, end_date },
      contributions: { upfront_usd, monthly_usd },
      objective,
      grid_size,

      // Current config baseline (unmodified variation, for comparison)
      baseline: {
        config: currentConfig,
        metrics: summarise(baselineResult),
      },

      // Best result found
      best: {
        rank: 1,
        config: optResults.best.config,
        objective_value: optResults.best.objective_value,
        metrics: summarise(optResults.best.simulation),
      },

      // Top N results — all 6 metrics per row, no daily/ledger arrays
      top_results: optResults.top_results.map((r) => ({
        rank: r.rank,
        config: r.config,
        objective_value: r.objective_value,
        metrics: summarise(r.simulation),
      })),

      // Execution stats
      combinations_tested: optResults.combinations_tested,
      combinations_skipped: optResults.combinations_skipped,
      execution_time_seconds: optResults.execution_time_seconds,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (e) {
    console.error("Optimization error:", e);
    return new Response(
      JSON.stringify({ error: e.message || "Optimization failed" }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
});
