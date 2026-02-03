import { getServiceClient } from "./client.ts";
import { logAlert } from "./alerting.ts";

Deno.serve(async ()=>{
  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  if (!org_id) return new Response("ORG_ID missing", {
    status: 500
  });
  const todayStr = new Date().toISOString().slice(0, 10);
  const minQuote = Number(Deno.env.get("MIN_QUOTE_USDT") ?? "0.52"); // VALR placeholder
  
  // Wait for decisions to exist (retry up to 4 times with 1-second delays = 4 seconds max)
  let decs = null;
  let decErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await sb.schema("lth_pvr").from("decisions_daily").select("*").eq("org_id", org_id).eq("trade_date", todayStr).in("action", [
      "BUY",
      "SELL"
    ]);
    decs = result.data;
    decErr = result.error;
    
    if (decErr) return new Response(decErr.message, { status: 500 });
    if (decs && decs.length > 0) break;
    
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
  
  let intentCount = 0;
  let skipCount = 0;
  
  for (const d of decs ?? []){
    try {
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
          await logAlert(
            sb,
            "ef_create_order_intents",
            "warn",
            `Zero BTC balance for SELL order`,
            {
              customer_id: d.customer_id,
              trade_date: d.trade_date,
              btc_balance: bal.btc_balance,
              amount_pct: d.amount_pct
            },
            org_id,
            d.customer_id
          );
          skipCount++;
          continue;
        }
      }
      // 4) Get exchange account for this customer
      const { data: exchAcct, error: exchErr } = await sb
        .from("exchange_accounts")
        .select("exchange_account_id")
        .eq("org_id", org_id)
        .limit(1)
        .single();
      
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
      const idKey = crypto.randomUUID(); // can switch to hash(org,cust,date,side) if you prefer
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
  
  console.info(`ef_create_order_intents: created=${intentCount}, skipped=${skipCount}`);
  return new Response("ok");
});
