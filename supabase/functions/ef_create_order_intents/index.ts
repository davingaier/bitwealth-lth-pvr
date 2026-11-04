import { getServiceClient } from "./client.ts";
import { logAlert } from "./alerting.ts";
import { loadUsdpcConfig, sizeUsdpcToUsdt, splitConversionAmount, USDPC_PAIR } from "../_shared/usdpc.ts";

Deno.serve(async (req)=>{
  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  if (!org_id) return new Response("ORG_ID missing", {
    status: 500
  });
  // Optional body: { customer_ids?: number[], trade_date?: 'YYYY-MM-DD' }. The STH_CB chain passes customer_ids so a
  // second run of the day (≈02:05 UTC) does not re-size the LTH_PVR intents created at 00:10.
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body = full run */ }
  const onlyCustomers: Set<number> | null = Array.isArray(body?.customer_ids) ? new Set(body.customer_ids.map(Number)) : null;
  const todayStr = typeof body?.trade_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.trade_date) ? body.trade_date : new Date().toISOString().slice(0, 10);
  const minQuote = Number(Deno.env.get("MIN_QUOTE_USDT") ?? "1.00"); // VALR minimum order size
  const USDPC_MIN_BASE_UNITS = 1;      // VALR USDPC/USDT minBaseAmount
  const USDPC_CONV_SLIPPAGE = 0.003;   // haircut on expected conversion proceeds when sizing the dependent BTC buy

  // --- USDPC support: config, latest price, and per-customer enabled flag ---
  const usdpcCfg = await loadUsdpcConfig(sb);
  let usdpcPrice = 1;
  try {
    const { data: pxRow } = await sb
      .from("usdpc_prices_daily")
      .select("price_usd")
      .order("date", { ascending: false })
      .limit(1);
    usdpcPrice = Number(pxRow?.[0]?.price_usd ?? 1) || 1;
  } catch (_e) {
    usdpcPrice = 1;
  }
  // Set of customer_ids with USDPC sweeping enabled on their live strategy (LTH_PVR or STH_CB).
  const usdpcEnabled = new Set<number>();
  try {
    const { data: csRows } = await sb
      .schema("public")
      .from("customer_strategies")
      .select("customer_id, usdpc_enabled")
      .eq("org_id", org_id)
      .in("strategy_code", ["LTH_PVR", "STH_CB"])
      .eq("usdpc_enabled", true);
    for (const r of csRows ?? []) usdpcEnabled.add(Number(r.customer_id));
  } catch (_e) { /* feature simply stays off if lookup fails */ }
  
  // Wait for decisions to exist (retry up to 4 times with 1-second delays = 4 seconds max).
  // Decisions come from two strategy tables (lth_pvr.decisions_daily for LTH_PVR, sth_cb.decisions_daily for STH_CB);
  // both expose the same sizing contract: action, amount_pct (0..1), price_usd, rule, note.
  // deno-lint-ignore no-explicit-any
  let decs: any[] | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const [lth, scb] = await Promise.all([
      sb.schema("lth_pvr").from("decisions_daily").select("customer_id, trade_date, action, amount_pct, price_usd, rule, note").eq("org_id", org_id).eq("trade_date", todayStr).in("action", ["BUY", "SELL"]),
      sb.schema("sth_cb").from("decisions_daily").select("customer_id, trade_date, action, amount_pct, price_usd, rule, note").eq("org_id", org_id).eq("trade_date", todayStr).in("action", ["BUY", "SELL"]),
    ]);
    if (lth.error) return new Response(lth.error.message, { status: 500 });
    if (scb.error) return new Response(scb.error.message, { status: 500 });
    decs = [
      ...(lth.data ?? []).map((d) => ({ ...d, strategy_code: "LTH_PVR" })),
      ...(scb.data ?? []).map((d) => ({ ...d, strategy_code: "STH_CB" })),
    ];
    if (onlyCustomers) decs = decs.filter((d) => onlyCustomers.has(Number(d.customer_id)));
    if (decs.length > 0) break;
    
    // No decisions yet, wait and retry (stay under 5 second pg_net timeout)
    if (attempt < 3) {
      console.log(`No decisions found, waiting 1 second (attempt ${attempt + 1}/4)...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // If still no decisions after retries, return success (nothing to do)
  if (!decs || decs.length === 0) {
    console.log("No BUY/SELL decisions found after 4 attempts");
    return new Response("ok - no decisions to process");
  }
  
  // Intents already created today (any status). A decision whose intent exists is skipped so re-runs never
  // re-size a live/filled order or re-consume the carry bucket.
  const existingKeys = new Set<string>();
  {
    const { data: ex } = await sb.from("order_intents").select("idempotency_key").eq("org_id", org_id).eq("trade_date", todayStr);
    for (const r of ex ?? []) if (r.idempotency_key) existingKeys.add(String(r.idempotency_key));
  }
  const intentKey = async (customerId: number | string, side: string) => {
    const parts = [org_id, String(customerId), todayStr, side].join('|');
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts));
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  let intentCount = 0;
  let skipCount = 0;
  let existingCount = 0;
  
  for (const d of decs ?? []){
    try {
      if (existingKeys.has(await intentKey(d.customer_id, d.action))) { existingCount++; continue; }
      // 2) latest balance as of trade date
      const { data: lastBal, error: balErr } = await sb.from("balances_daily").select("*").eq("org_id", org_id).eq("customer_id", d.customer_id).lte("date", d.trade_date).order("date", {
        ascending: false
      }).limit(1);
      if (balErr) {
        console.error(balErr);
        await logAlert(
          sb,
          "ef_create_order_intents",
          "error",
          `Balance query failed for customer ${d.customer_id}`,
          {
            customer_id: d.customer_id,
            trade_date: d.trade_date,
            error: balErr.message
          },
          org_id,
          d.customer_id
        );
        continue;
      }
      const bal = lastBal?.[0] ?? {
        usdt_balance: 0,
        btc_balance: 0
      };
      // 3) sizing
      let side = d.action;
      let notional = 0;
      let qtyBase = 0;
      let usdpcPlan: { usdpcToSell: number; shortfall: number; idleUsdt: number } | null = null;
      if (side === "BUY") {
        // reserve-aware available USDT + carry bucket
        const av = await sb.rpc("fn_usdt_available_for_trading", {
          p_org: org_id,
          p_customer: d.customer_id
        });
        const ck = await sb.rpc("fn_carry_peek", {
          p_org: org_id,
          p_customer: d.customer_id,
          p_asset: "USDT"
        });
        
        if (av.error) {
          await logAlert(
            sb,
            "ef_create_order_intents",
            "error",
            `fn_usdt_available_for_trading RPC failed for customer ${d.customer_id}`,
            {
              customer_id: d.customer_id,
              trade_date: d.trade_date,
              error: av.error.message
            },
            org_id,
            d.customer_id
          );
          continue;
        }
        
        const avail = Number(av.data ?? 0) + Number(ck.data ?? 0);
        notional = +(avail * Number(d.amount_pct)).toFixed(2);

        // --- USDPC funding plan (decided BEFORE the BTC intent so the buy is never under-funded) ---
        // Buying power includes the USDPC value; any shortfall vs idle USDT must be raised by selling USDPC first.
        // VALR's USDPC/USDT minimum is 1 unit (not the 5-USDT sweep dust threshold), so small balances convert too.
        // All-in buys (amount_pct ≈ 1) convert the WHOLE USDPC balance; the BTC notional is then capped to what will
        // actually be available (idle USDT + expected conversion proceeds net of fee + a slippage buffer). If no
        // conversion is possible (USDPC < 1 unit) the buy is capped to idle USDT instead of failing on VALR.
        if (usdpcEnabled.has(Number(d.customer_id))) {
          const idleUsdt = Number(bal.usdt_balance ?? 0);
          const usdpcUnits = Number(bal.usdpc_balance ?? 0);
          const shortfall = +(notional - idleUsdt).toFixed(2);
          if (shortfall > 0.01) {
            if (usdpcUnits >= USDPC_MIN_BASE_UNITS) {
              const allIn = Number(d.amount_pct) >= 0.999;
              let toSell: number;
              if (allIn) {
                toSell = usdpcUnits;
              } else {
                const sizing = sizeUsdpcToUsdt(+(shortfall * 1.005).toFixed(2), usdpcUnits, usdpcPrice, usdpcCfg.takerFeeRate);
                toSell = Math.min(usdpcUnits, Math.max(USDPC_MIN_BASE_UNITS, Number(sizing.usdpcToSell)));
              }
              toSell = Math.floor(toSell * 100) / 100; // USDPC/USDT base has 2 decimals on VALR
              const expectUsdt = toSell * usdpcPrice * (1 - usdpcCfg.takerFeeRate);
              const fundable = Math.floor((idleUsdt + expectUsdt * (1 - USDPC_CONV_SLIPPAGE)) * 100) / 100;
              if (fundable < notional) notional = fundable;
              usdpcPlan = { usdpcToSell: toSell, shortfall, idleUsdt };
            } else {
              notional = Math.floor(idleUsdt * 100) / 100;
              await logAlert(sb, "ef_create_order_intents", "info",
                `USDPC ${usdpcUnits.toFixed(4)} below VALR minimum (1 unit); BUY capped to idle USDT ${notional.toFixed(2)}`,
                { customer_id: d.customer_id, trade_date: d.trade_date, usdpc_units: usdpcUnits, notional }, org_id, d.customer_id);
            }
          }
        }

        if (notional < minQuote) {
          // accumulate carry and skip
          await sb.rpc("fn_carry_add", {
            p_org: org_id,
            p_customer: d.customer_id,
            p_amount: notional,
            p_asset: "USDT"
          });
          await logAlert(
            sb,
            "ef_create_order_intents",
            "info",
            `Order below minimum quote (${notional.toFixed(2)} < ${minQuote}), accumulated to carry`,
            {
              customer_id: d.customer_id,
              trade_date: d.trade_date,
              notional,
              min_quote: minQuote,
              action: "accumulated_to_carry"
            },
            org_id,
            d.customer_id
          );
          skipCount++;
          continue;
        }
        const price = Number(d.price_usd);
        qtyBase = +(notional / price).toFixed(8);
        const useFromCarry = Math.min(Number(ck.data ?? 0), notional);
        if (useFromCarry > 0) await sb.rpc("fn_carry_consume", {
          p_org: org_id,
          p_customer: d.customer_id,
          p_amount: useFromCarry,
          p_asset: "USDT"
        });
      } else {
        // SELL % of BTC (amount_pct is stored as decimal 0.0-1.0, not 0-100)
        qtyBase = +(Number(bal.btc_balance) * Number(d.amount_pct)).toFixed(8);
        if (qtyBase <= 0) {
          // Silently skip — a customer with no BTC simply has nothing to sell.
          // This is the normal state for new/unfunded customers and dev/test profiles
          // and was historically alert-spam (681 occurrences/customer pre-dedup).
          // No alert raised; just count and continue.
          skipCount++;
          continue;
        }
        
        // Check if SELL amount meets minimum quote threshold
        const price = Number(d.price_usd);
        notional = +(qtyBase * price).toFixed(2);
        if (notional < minQuote) {
          await logAlert(
            sb,
            "ef_create_order_intents",
            "info",
            `SELL order below minimum quote (${notional.toFixed(2)} < ${minQuote}), skipped`,
            {
              customer_id: d.customer_id,
              trade_date: d.trade_date,
              btc_qty: qtyBase,
              notional,
              min_quote: minQuote,
              action: "skipped_below_minimum"
            },
            org_id,
            d.customer_id
          );
          skipCount++;
          continue;
        }
      }
      // 4) Exchange account for this customer: their own strategy row's account (so the WebSocket monitor and
      //    pipeline views resolve the right subaccount); fall back to the org-level account only if unset.
      let exchAcct: { exchange_account_id: string } | null = null;
      {
        const { data: csAcct } = await sb.schema("public").from("customer_strategies")
          .select("exchange_account_id").eq("org_id", org_id).eq("customer_id", d.customer_id)
          .in("strategy_code", ["LTH_PVR", "STH_CB"]).eq("status", "active").not("exchange_account_id", "is", null)
          .order("created_at", { ascending: false }).limit(1);
        if (csAcct?.[0]?.exchange_account_id) exchAcct = { exchange_account_id: String(csAcct[0].exchange_account_id) };
      }
      let exchErr: { message: string } | null = null;
      if (!exchAcct) {
        const r = await sb
          .from("exchange_accounts")
          .select("exchange_account_id")
          .eq("org_id", org_id)
          .order("created_at", { ascending: true })
          .limit(1)
          .single();
        exchAcct = r.data as { exchange_account_id: string } | null;
        exchErr = r.error;
      }
      
      if (exchErr || !exchAcct) {
        await logAlert(
          sb,
          "ef_create_order_intents",
          "error",
          `No exchange account found for org`,
          {
            customer_id: d.customer_id,
            trade_date: d.trade_date,
            error: exchErr?.message
          },
          org_id,
          d.customer_id
        );
        continue;
      }
      
      // 5) write intent with ALL required fields
      // Use deterministic idempotency key to prevent duplicate intents
      const idKeyParts = [org_id, d.customer_id.toString(), d.trade_date, side].join('|');
      const idKeyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(idKeyParts));
      const idKey = Array.from(new Uint8Array(idKeyHash)).map(b => b.toString(16).padStart(2, '0')).join('');
      
      const ins = await sb.from("order_intents").upsert({
        org_id,
        customer_id: d.customer_id,
        trade_date: d.trade_date,
        pair: "BTC/USDT",
        side,
        amount: qtyBase,
        limit_price: Number(d.price_usd),
        base_asset: "BTC",
        quote_asset: "USDT",
        exchange_account_id: exchAcct.exchange_account_id,
        idempotency_key: idKey,
        reason: d.rule,
        note: d.note
      }, {
        onConflict: "idempotency_key"
      });
      if (ins.error) {
        console.error("intent error", ins.error);
        await logAlert(
          sb,
          "ef_create_order_intents",
          "error",
          `Intent upsert failed: ${ins.error.message}`,
          {
            customer_id: d.customer_id,
            trade_date: d.trade_date,
            side,
            error: ins.error.message
          },
          org_id,
          d.customer_id
        );
      } else {
        intentCount++;

        // --- USDPC pre-buy conversion intent ---
        // The plan was decided in the sizing step above (whole balance for all-in buys, otherwise the shortfall
        // + 0.5 % buffer, never below VALR's 1-unit minimum). Create one SELL USDPC/USDT market intent per chunk so
        // the USDT is available before the dependent BTC buy executes.
        if (side === "BUY" && usdpcPlan) {
          try {
            const { usdpcToSell, shortfall, idleUsdt } = usdpcPlan;
            {
              if (usdpcToSell > 0) {
                // VALR caps a single USDPC SELL at ~46 000 USDPC (base). Split a
                // larger conversion into multiple intents, each its own market
                // order, so all chunks settle before the dependent BTC buy.
                const chunks = splitConversionAmount(usdpcToSell, usdpcCfg.maxBaseUsdpc);
                for (let ci = 0; ci < chunks.length; ci++) {
                  const chunkAmt = chunks[ci];
                  if (!(chunkAmt > 0)) continue;
                  const convKeyParts = [org_id, d.customer_id.toString(), d.trade_date, "USDPC_PREBUY", String(ci)].join("|");
                  const convHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(convKeyParts));
                  const convKey = Array.from(new Uint8Array(convHash)).map(b => b.toString(16).padStart(2, "0")).join("");
                  const convIns = await sb.from("order_intents").upsert({
                    org_id,
                    customer_id: d.customer_id,
                    trade_date: d.trade_date,
                    pair: USDPC_PAIR,
                    side: "SELL", // sell USDPC, receive USDT
                    amount: chunkAmt,
                    limit_price: null, // market order
                    base_asset: "USDPC",
                    quote_asset: "USDT",
                    exchange_account_id: exchAcct.exchange_account_id,
                    idempotency_key: convKey,
                    reason: "usdpc_prebuy_convert",
                    note: chunks.length > 1
                      ? `Fund BTC buy (chunk ${ci + 1}/${chunks.length}): need ${shortfall.toFixed(2)} USDT (idle ${idleUsdt.toFixed(2)})`
                      : `Fund BTC buy: need ${shortfall.toFixed(2)} USDT (idle ${idleUsdt.toFixed(2)})`,
                  }, { onConflict: "idempotency_key" });
                  if (convIns.error) {
                    console.error("usdpc conversion intent error", convIns.error);
                    await logAlert(
                      sb,
                      "ef_create_order_intents",
                      "error",
                      `USDPC conversion intent upsert failed: ${convIns.error.message}`,
                      { customer_id: d.customer_id, trade_date: d.trade_date, shortfall, chunk: ci + 1, chunks: chunks.length, error: convIns.error.message },
                      org_id,
                      d.customer_id,
                    );
                  }
                }
              }
            }
          } catch (convErr) {
            await logAlert(
              sb,
              "ef_create_order_intents",
              "error",
              `USDPC conversion sizing failed for customer ${d.customer_id}`,
              { customer_id: d.customer_id, trade_date: d.trade_date, error: convErr instanceof Error ? convErr.message : String(convErr) },
              org_id,
              d.customer_id,
            );
          }
        }
      }
    } catch (err) {
      console.error(`Intent creation failed for customer ${d.customer_id}:`, err);
      await logAlert(
        sb,
        "ef_create_order_intents",
        "error",
        `Intent creation failed for customer ${d.customer_id}`,
        {
          customer_id: d.customer_id,
          trade_date: d.trade_date,
          error: err instanceof Error ? err.message : String(err)
        },
        org_id,
        d.customer_id
      );
    }
  }
  
  console.info(`ef_create_order_intents: created=${intentCount}, skipped=${skipCount}, already_existing=${existingCount}${onlyCustomers ? `, customer_filter=${[...onlyCustomers].join(",")}` : ""}`);
  return new Response("ok");
});
