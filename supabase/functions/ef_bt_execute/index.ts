import { getServiceClient } from "./client.ts";
import { bucketLabel, decideTrade } from "./lth_pvr_logic.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function syncBearPauseFromRow(prev, row) {
  const next = {
    bear_pause: false,
    was_above_p1: false,
    was_above_p15: false,
    r1_armed: false,
    r15_armed: false,
    ...prev || {}
  };
  if (!row || typeof row.bear_pause === "undefined" || row.bear_pause === null) {
    return next;
  }
  const prevPause = !!next.bear_pause;
  const nowPause = !!row.bear_pause;
  // When we *enter* bear pause on this row, clear retrace eligibility
  if (!prevPause && nowPause) {
    next.was_above_p1 = false;
    next.was_above_p15 = false;
    next.r1_armed = false;
    next.r15_armed = false;
  }
  next.bear_pause = nowPause;
  return next;
}
// Helper to safely coerce values to numbers
const toNum = (v, def = 0)=>{
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
// Compute simple ROC_n using btc_price_usd on close_date axis
function computeRocSeries(rows, len) {
  const out = new Array(rows.length).fill(0);
  if (len <= 0) return out;
  for(let i = 0; i < rows.length; i++){
    if (i < len) continue;
    const pxNow = toNum(rows[i].btc_price_usd, 0);
    const pxPrev = toNum(rows[i - len].btc_price_usd, 0);
    if (pxNow > 0 && pxPrev > 0) {
      out[i] = pxNow / pxPrev - 1;
    }
  }
  return out;
}
// Helper to insert arrays in manageable chunks
async function bulkInsert(sb, table, rows) {
  const chunkSize = 500;
  for(let i = 0; i < rows.length; i += chunkSize){
    const chunk = rows.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    const { error } = await sb.from(table).insert(chunk);
    if (error) throw new Error(`insert into ${table} failed: ${error.message}`);
  }
}
// ROI / CAGR helpers – based on *gross* contributions
function computeRoi(nav, contribGrossCum) {
  if (contribGrossCum <= 0) return 0;
  return (nav / contribGrossCum - 1) * 100;
}
function computeCagr(nav, contribGrossCum, firstDate, tradeDate) {
  if (contribGrossCum <= 0 || !firstDate) return 0;
  const t0 = new Date(firstDate).getTime();
  const t1 = new Date(tradeDate).getTime();
  const days = (t1 - t0) / (1000 * 3600 * 24);
  if (!Number.isFinite(days) || days <= 0) return 0;
  const ratio = nav / contribGrossCum;
  if (ratio <= 0) return 0;
  const years = days / 365;
  if (years <= 0) return 0;
  return (Math.pow(ratio, 1 / years) - 1) * 100;
}

Deno.serve(async (req)=>{
  // CORS preflight support
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  const sb = getServiceClient();
  // use lth_pvr_bt schema explicitly for all BT tables/views
  const sbBt = sb.schema ? sb.schema("lth_pvr_bt") : sb;
  let bt_run_id;
  try {
    const body = await req.json().catch(()=>({}));
    bt_run_id = body?.bt_run_id;
    if (!bt_run_id) {
      return new Response("bt_run_id required", {
        status: 400,
        headers: corsHeaders
      });
    }
    // Load run row
    const { data: runRows, error: runErr } = await sbBt.from("bt_runs").select("*").eq("bt_run_id", bt_run_id).limit(1);
    if (runErr) throw new Error(`bt_runs query failed: ${runErr.message}`);
    const run = runRows?.[0];
    if (!run) throw new Error(`bt_run_id ${bt_run_id} not found`);
    const org_id = run.org_id ?? Deno.env.get("ORG_ID") ?? null;
    if (!org_id) throw new Error("missing org_id on bt_runs and ORG_ID env");
    // Load params
    const { data: paramRows, error: paramErr } = await sbBt.from("bt_params").select("*").eq("bt_run_id", bt_run_id).limit(1);
    if (paramErr) throw new Error(`bt_params query failed: ${paramErr.message}`);
    const params = paramRows?.[0];
    if (!params) throw new Error(`bt_params missing for bt_run_id ${bt_run_id}`);
    const start_date = params.start_date;
    const end_date = params.end_date;
    if (!start_date || !end_date) {
      throw new Error("start_date and end_date required in bt_params");
    }
    // Interpret fees as basis points (e.g. 8 bps = 0.08%)
    const tradeFeeRate = toNum(params.maker_bps_trade, 0) / 10000;  // VALR BTC/USDT exchange fee (8 bps, charged in BTC)
    const contribFeeRate = toNum(params.maker_bps_contrib, 0) / 10000;  // VALR USDT/ZAR exchange fee (18 bps, charged in USDT)
    const platformFeeRate = toNum(params.platform_fee_pct, 0);  // BitWealth platform fee (0.75%, charged on contributions)
    const performanceFeeRate = toNum(params.performance_fee_pct, 0);  // BitWealth performance fee (10%, high-water mark)
    const upfront = toNum(params.upfront_contrib_usdt, 0);
    const monthly = toNum(params.monthly_contrib_usdt, 0);
    const momoLen = Math.max(1, Math.trunc(toNum(params.momo_len, 5)));

    // Default LTH PVR band percentages (fraction of balance used per trade).
    // 🔁 Adjust these to your canonical B1–B11 values.
    const defaultBands = {
      B1: 0.22796,
      B2: 0.21397,
      B3: 0.19943,
      B4: 0.18088,
      B5: 0.12229,
      B6: 0.00157,
      B7: 0.002,
      B8: 0.00441,
      B9: 0.01287,
      B10: 0.033,
      B11: 0.09572
    };

    let B = {
      B1: toNum(params.b1, 0),
      B2: toNum(params.b2, 0),
      B3: toNum(params.b3, 0),
      B4: toNum(params.b4, 0),
      B5: toNum(params.b5, 0),
      B6: toNum(params.b6, 0),
      B7: toNum(params.b7, 0),
      B8: toNum(params.b8, 0),
      B9: toNum(params.b9, 0),
      B10: toNum(params.b10, 0),
      B11: toNum(params.b11, 0)
    };

    const allZeroBands = Object.values(B).every((v) => !v || v === 0);

    if (allZeroBands) {
      // Use our defaults when the bt_params row has no band values yet
      B = { ...defaultBands };

      // Persist defaults + enable_retrace so bt_params reflects what the sim used
      const enableRetrace =
        params.enable_retrace === null || typeof params.enable_retrace === "undefined"
          ? true
          : !!params.enable_retrace;

      await sbBt
        .from("bt_params")
        .update({
          b1: B.B1,
          b2: B.B2,
          b3: B.B3,
          b4: B.B4,
          b5: B.B5,
          b6: B.B6,
          b7: B.B7,
          b8: B.B8,
          b9: B.B9,
          b10: B.B10,
          b11: B.B11,
          enable_retrace: enableRetrace
        })
        .eq("bt_run_id", bt_run_id);

      params.enable_retrace = enableRetrace;
    } else if (params.enable_retrace === null || typeof params.enable_retrace === "undefined") {
      // Bands exist but enable_retrace is still null – default it to TRUE
      await sbBt
        .from("bt_params")
        .update({ enable_retrace: true })
        .eq("bt_run_id", bt_run_id);

      params.enable_retrace = true;
    }

    // Load ALL price/band rows for the date range.
    // PostgREST defaults to 1 000 rows, so we page until we’ve got everything.
    const pageSize = 1000;
    let from = 0;
    let prices = [];
    while(true){
      const { data, error } = await sbBt.from("v_backtest_prices").select("*").eq("org_id", org_id).gte("close_date", start_date).lte("close_date", end_date).order("close_date", {
        ascending: true
      }).range(from, from + pageSize - 1); // 0-based, inclusive
      if (error) {
        throw new Error(`v_backtest_prices query failed: ${error.message}`);
      }
      if (!data || data.length === 0) {
        break; // no more pages
      }
      prices = prices.concat(data);
      if (data.length < pageSize) {
        break; // last page
      }
      from += pageSize;
    }
    if (!prices.length) {
      throw new Error("no rows in v_backtest_prices for given date range / org");
    }
    // Pre-compute ROC series
    const rocSeries = computeRocSeries(prices, momoLen);
    // LTH PVR state
    let btcBal = 0;
    let usdtBal = 0;
    let contribGrossCum = 0;
    let contribFeeCum = 0;  // VALR USDT/ZAR fees (18 bps)
    let contribNetCum = 0;
    let platformFeesCum = 0;  // BitWealth platform fees (0.75%)
    let performanceFeesCum = 0;  // BitWealth performance fees (10% with high-water mark)
    let highWaterMark = 0;  // For performance fee calculation
    let hwmContribNetCum = 0; // Track cumulative NET contributions at last HWM update
    let exchangeFeesBtcCum = 0;  // VALR BTC/USDT fees in BTC
    let exchangeFeesUsdtCum = 0;  // VALR USDT/ZAR fees in USDT
    let firstContribDate = null;
    let lastMonthForPerfFee = null;  // Track monthly performance fee calculation
    // Std DCA state
    let stdBtcBal = 0;
    let stdUsdtBal = 0;
    let stdContribGrossCum = 0;
    let stdContribFeeCum = 0;
    let stdContribNetCum = 0;
    let stdExchangeFeesBtcCum = 0;  // VALR BTC/USDT fees
    let stdExchangeFeesUsdtCum = 0;  // VALR USDT/ZAR fees
    let stdFirstContribDate = null;
    const resultsDaily = [];
    const ledgerRows = [];
    const orderRows = [];
    const stdBalances = [];
    const stdLedger = [];
    let lthState = {
      bear_pause: false,
      was_above_p1: false,
      was_above_p15: false,
      r1_armed: false,
      r15_armed: false
    };
    let lastMonth = null;
    // Contribution helpers
    let platformFeeToday = 0;  // Track daily platform fees for correct aggregation
    let exchangeFeeBtcToday = 0;  // Track daily BTC exchange fees
    let exchangeFeeUsdtToday = 0;  // Track daily USDT exchange fees
    let stdExchangeFeeBtcToday = 0;  // Track daily Standard DCA BTC exchange fees
    let stdExchangeFeeUsdtToday = 0;  // Track daily Standard DCA USDT exchange fees
    const applyContribLth = (row, gross)=>{
      if (gross <= 0) return 0;
      // Step 1: Deduct VALR USDT/ZAR exchange fee (18 bps) - conversion happens first
      const exchangeFee = gross * contribFeeRate;
      const afterExchangeFee = gross - exchangeFee;
      // Step 2: Deduct BitWealth platform fee (0.75% of remaining)
      const platformFee = afterExchangeFee * platformFeeRate;
      const net = afterExchangeFee - platformFee;
      
      usdtBal += net;
      contribGrossCum += gross;
      contribFeeCum += exchangeFee;
      platformFeesCum += platformFee;
      platformFeeToday += platformFee;  // Accumulate today's platform fees
      exchangeFeesUsdtCum += exchangeFee;
      exchangeFeeUsdtToday += exchangeFee;  // Track daily USDT fees
      contribNetCum += net;
      const tradeDate = row.close_date; // simulate on CI close date
      const closeDate = row.close_date;
      if (!firstContribDate) firstContribDate = tradeDate;
      ledgerRows.push({
        bt_run_id,
        org_id,
        trade_date: tradeDate,
        close_date: closeDate,
        kind: "contrib",
        amount_btc: 0,
        amount_usdt: gross,
        fee_btc: 0,
        fee_usdt: 0,
        note: "Contribution"
      });
      if (exchangeFee > 0) {
        ledgerRows.push({
          bt_run_id,
          org_id,
          trade_date: tradeDate,
          close_date: closeDate,
          kind: "fee",
          amount_btc: 0,
          amount_usdt: 0,
          fee_btc: 0,
          fee_usdt: exchangeFee,
          note: "VALR USDT/ZAR exchange fee"
        });
      }
      if (platformFee > 0) {
        ledgerRows.push({
          bt_run_id,
          org_id,
          trade_date: tradeDate,
          close_date: closeDate,
          kind: "fee",
          amount_btc: 0,
          amount_usdt: 0,
          fee_btc: 0,
          fee_usdt: platformFee,
          note: "BitWealth platform fee"
        });
      }
      return net;
    };
    const applyContribStd = (row, gross)=>{
      if (gross <= 0) return 0;
      // STD_DCA benchmark: only VALR exchange fees (NO BitWealth fees)
      const exchangeFee = gross * contribFeeRate;  // VALR USDT/ZAR fee (18 bps)
      const net = gross - exchangeFee;
      
      stdUsdtBal += net;
      stdContribGrossCum += gross;
      stdContribFeeCum += exchangeFee;
      stdExchangeFeesUsdtCum += exchangeFee;
      stdExchangeFeeUsdtToday += exchangeFee;  // Track daily USDT fees
      stdContribNetCum += net;
      const tradeDate = row.close_date; // simulate on CI close date
      if (!stdFirstContribDate) stdFirstContribDate = tradeDate;
      // std_dca_ledger is kept for buys/fees only (no explicit contrib rows)
      return net;
    };
    // Clear previous rows for this run
    await sbBt.from("bt_ledger").delete().eq("bt_run_id", bt_run_id);
    await sbBt.from("bt_results_daily").delete().eq("bt_run_id", bt_run_id);
    await sbBt.from("bt_orders").delete().eq("bt_run_id", bt_run_id);
    await sbBt.from("bt_std_dca_balances").delete().eq("bt_run_id", bt_run_id);
    await sbBt.from("bt_std_dca_ledger").delete().eq("bt_run_id", bt_run_id);
    // Main loop over CI close_date (simulation date)
    for(let i = 0; i < prices.length; i++){
      const row = prices[i];
      const tradeDate = row.close_date; // align with Python back-tester
      const closeDate = row.close_date;
      const px = toNum(row.btc_price_usd, 0);
      const monthKey = tradeDate.slice(0, 7); // YYYY-MM
      // Reset daily fee trackers
      platformFeeToday = 0;
      exchangeFeeBtcToday = 0;
      exchangeFeeUsdtToday = 0;
      stdExchangeFeeBtcToday = 0;
      stdExchangeFeeUsdtToday = 0;
      // Contributions: upfront on first day, monthly on first day of month
      let grossContribToday = 0;
      if (i === 0 && upfront > 0) grossContribToday += upfront;
      if (monthly > 0 && monthKey !== lastMonth) grossContribToday += monthly;
      lastMonth = monthKey;
      if (grossContribToday > 0) {
        applyContribLth(row, grossContribToday);
        const netStd = applyContribStd(row, grossContribToday);
        // Std DCA: invest net contribution immediately on that trade_date
        if (netStd > 0 && px > 0) {
          const tradeUsdt = netStd;
          const tradeBtcGross = tradeUsdt / px;
          const feeBtc = tradeBtcGross * tradeFeeRate;  // VALR BTC/USDT exchange fee in BTC
          const btcNet = tradeBtcGross - feeBtc;
          stdUsdtBal -= tradeUsdt;
          stdBtcBal += btcNet;
          stdExchangeFeesBtcCum += feeBtc;  // Track cumulative BTC fees
          stdExchangeFeeBtcToday += feeBtc;  // Track daily BTC fees
          stdLedger.push({
            bt_run_id,
            org_id,
            trade_date: tradeDate,
            close_date: closeDate,
            usdt_spent: tradeUsdt,
            btc_bought: btcNet,
            price_used: px,
            fee_btc: feeBtc
          });
        }
      }
      // LTH PVR decision
      const roc5 = rocSeries[i] ?? 0;
      // Sync precomputed bear_pause from CI view into state
      lthState = syncBearPauseFromRow(lthState, row);
      const decision = decideTrade(px, row, roc5, lthState, B);
      lthState = decision.state || lthState;
      if (decision.action === "BUY" && decision.pct > 0 && px > 0) {
        const baseUsdt = usdtBal;
        const tradeUsdt = baseUsdt * decision.pct;
        if (tradeUsdt > 0) {
          const tradeBtcGross = tradeUsdt / px;
          const feeBtc = tradeBtcGross * tradeFeeRate;  // VALR BTC/USDT exchange fee in BTC
          const btcNet = tradeBtcGross - feeBtc;
          usdtBal -= tradeUsdt;
          btcBal += btcNet;
          exchangeFeesBtcCum += feeBtc;  // Track cumulative BTC fees
          exchangeFeeBtcToday += feeBtc;  // Track daily BTC fees
          ledgerRows.push({
            bt_run_id,
            org_id,
            trade_date: tradeDate,
            close_date: closeDate,
            kind: "buy",
            amount_btc: btcNet,
            amount_usdt: tradeUsdt,
            fee_btc: 0,
            fee_usdt: 0,
            note: decision.rule
          });
          if (feeBtc > 0) {
            ledgerRows.push({
              bt_run_id,
              org_id,
              trade_date: tradeDate,
              close_date: closeDate,
              kind: "fee",
              amount_btc: 0,
              amount_usdt: 0,
              fee_btc: feeBtc,
              fee_usdt: 0,
              note: "VALR BTC/USDT trade fee (BUY)"
            });
          }
          orderRows.push({
            bt_run_id,
            org_id,
            trade_date: tradeDate,
            close_date: closeDate,
            side: "BUY",
            price: px,
            qty: tradeBtcGross,
            fee_asset: "BTC",
            fee_qty: feeBtc
          });
        }
      } else if (decision.action === "SELL" && decision.pct > 0 && px > 0) {
        const baseBtc = btcBal;
        const tradeBtcGross = baseBtc * decision.pct;
        if (tradeBtcGross > 0) {
          const feeBtc = tradeBtcGross * tradeFeeRate;  // VALR BTC/USDT exchange fee in BTC
          const grossUsdt = tradeBtcGross * px;
          btcBal -= tradeBtcGross + feeBtc;
          usdtBal += grossUsdt;
          exchangeFeesBtcCum += feeBtc;  // Track cumulative BTC fees
          exchangeFeeBtcToday += feeBtc;  // Track daily BTC fees
          ledgerRows.push({
            bt_run_id,
            org_id,
            trade_date: tradeDate,
            close_date: closeDate,
            kind: "sell",
            amount_btc: tradeBtcGross,
            amount_usdt: grossUsdt,
            fee_btc: 0,
            fee_usdt: 0,
            note: decision.rule
          });
          if (feeBtc > 0) {
            ledgerRows.push({
              bt_run_id,
              org_id,
              trade_date: tradeDate,
              close_date: closeDate,
              kind: "fee",
              amount_btc: 0,
              amount_usdt: 0,
              fee_btc: feeBtc,
              fee_usdt: 0,
              note: "VALR BTC/USDT trade fee (SELL)"
            });
          }
          orderRows.push({
            bt_run_id,
            org_id,
            trade_date: tradeDate,
            close_date: closeDate,
            side: "SELL",
            price: px,
            qty: tradeBtcGross,
            fee_asset: "BTC",
            fee_qty: feeBtc
          });
        }
      }
      // Monthly performance fee calculation (high-water mark)
      // Only runs on the first day of a new month (when month changes)
      let performanceFeeThisMonth = 0;
      const isNewMonth = (monthKey !== lastMonthForPerfFee);
      const isNotFirstMonth = (lastMonthForPerfFee !== null);
      
      if (isNewMonth && isNotFirstMonth) {
        // Month boundary: calculate performance fee on NAV gains above high-water mark
        const currentNav = usdtBal + btcBal * px;
        const contribSinceHWM = contribNetCum - hwmContribNetCum;
        const navForPerfFee = currentNav - contribSinceHWM;
        
        if (navForPerfFee > highWaterMark && performanceFeeRate > 0) {
          const profitAboveHWM = navForPerfFee - highWaterMark;
          performanceFeeThisMonth = profitAboveHWM * performanceFeeRate;
          // Deduct performance fee from USDT balance
          usdtBal -= performanceFeeThisMonth;
          performanceFeesCum += performanceFeeThisMonth;
          // Record performance fee in ledger
          ledgerRows.push({
            bt_run_id,
            org_id,
            trade_date: tradeDate,
            close_date: closeDate,
            kind: "fee",
            amount_btc: 0,
            amount_usdt: 0,
            fee_btc: 0,
            fee_usdt: performanceFeeThisMonth,
            note: "BitWealth performance fee (10% on profit above high-water mark, net of new contributions)"
          });
          
          // Update high-water mark after charging fee (to NAV after fee)
          const navAfterFee = usdtBal + btcBal * px;
          highWaterMark = navAfterFee - contribSinceHWM;
          hwmContribNetCum = contribNetCum;
        } else if (navForPerfFee > highWaterMark) {
          // Update high-water mark even if no fee charged (new peak reached)
          highWaterMark = navForPerfFee;
          hwmContribNetCum = contribNetCum;
        }
        // If navForPerfFee <= highWaterMark, don't update (still below peak)
      }
      lastMonthForPerfFee = monthKey;
      
      // Initialize high-water mark on first day ONLY (after all trading activity)
      if (i === 0) {
        const initialNav = usdtBal + btcBal * px;
        highWaterMark = initialNav;
        hwmContribNetCum = contribNetCum;
      }
      
      // LTH daily NAV + performance (AFTER performance fee deduction)
      const nav = usdtBal + btcBal * px;
      const totalRoi = computeRoi(nav, contribGrossCum);
      const cagr = computeCagr(nav, contribGrossCum, firstContribDate, tradeDate);
      const band_bucket = bucketLabel(px, row);

      resultsDaily.push({
        bt_run_id,
        org_id,
        close_date: closeDate,
        trade_date: tradeDate,
        action: decision.action,
        amount_pct: decision.pct,
        rule: decision.rule,
        note: decision.note,
        btc_balance: btcBal,
        usdt_balance: usdtBal,
        nav_usd: nav,
        price_usd: px,
        band_bucket,
        contrib_gross_usdt_cum: contribGrossCum,
        contrib_fee_usdt_cum: contribFeeCum,
        contrib_net_usdt_cum: contribNetCum,
        total_roi_percent: totalRoi,
        cagr_percent: cagr,
        platform_fees_paid_usdt: platformFeeToday,
        performance_fees_paid_usdt: performanceFeeThisMonth,
        exchange_fees_paid_btc: exchangeFeeBtcToday,
        exchange_fees_paid_usdt: exchangeFeeUsdtToday,
        high_water_mark_usdt: highWaterMark
      });
      // Std DCA daily NAV + performance
      const stdNav = stdUsdtBal + stdBtcBal * px;
      const stdRoi = computeRoi(stdNav, stdContribGrossCum);
      const stdCagr = computeCagr(stdNav, stdContribGrossCum, stdFirstContribDate, tradeDate);

      stdBalances.push({
        bt_run_id,
        org_id,
        close_date: closeDate,
        trade_date: tradeDate,
        btc_balance: stdBtcBal,
        usdt_balance: stdUsdtBal,
        nav_usd: stdNav,
        contrib_gross_usdt_cum: stdContribGrossCum,
        contrib_fee_usdt_cum: stdContribFeeCum,
        contrib_net_usdt_cum: stdContribNetCum,
        total_roi_percent: stdRoi,
        cagr_percent: stdCagr,
        total_exchange_fees_btc: stdExchangeFeeBtcToday,
        total_exchange_fees_usdt: stdExchangeFeeUsdtToday
      });
    }
    // Persist all results
    await bulkInsert(sbBt, "bt_ledger", ledgerRows);
    await bulkInsert(sbBt, "bt_orders", orderRows);
    await bulkInsert(sbBt, "bt_results_daily", resultsDaily);
    await bulkInsert(sbBt, "bt_std_dca_ledger", stdLedger);
    await bulkInsert(sbBt, "bt_std_dca_balances", stdBalances);
    const lastDaily = resultsDaily[resultsDaily.length - 1];
    const lastStd = stdBalances[stdBalances.length - 1];
    await sbBt.from("bt_runs").update({
      status: "ok",
      finished_at: new Date().toISOString(),
      error: null
    }).eq("bt_run_id", bt_run_id);
    const summary = {
      lth_pvr: lastDaily ? {
        final_nav_usd: lastDaily.nav_usd,
        final_roi_percent: lastDaily.total_roi_percent,
        final_cagr_percent: lastDaily.cagr_percent
      } : null,
      std_dca: lastStd ? {
        final_nav_usd: lastStd.nav_usd,
        final_roi_percent: lastStd.total_roi_percent,
        final_cagr_percent: lastStd.cagr_percent
      } : null
    };
    return new Response(JSON.stringify({
      status: "ok",
      bt_run_id,
      summary
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    console.error("ef_bt_execute error:", e?.message ?? e, e?.stack ?? "");
    if (bt_run_id) {
      await sbBt.from("bt_runs").update({
        status: "error",
        finished_at: new Date().toISOString(),
        error: String(e?.message ?? e ?? "unknown")
      }).eq("bt_run_id", bt_run_id);
    }
    return new Response(`error: ${e?.message ?? "unknown"}`, {
      status: 500,
      headers: corsHeaders
    });
  }
});
