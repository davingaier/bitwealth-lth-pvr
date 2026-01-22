import { getServiceClient, yyyymmdd } from "./client.ts";
import { transferToMainAccount } from "../_shared/valrTransfer.ts";
import { logAlert } from "../_shared/alerting.ts";
import Decimal from "npm:decimal.js@10.4.3";

// Minimal shapes we care about from v_fills_with_customer and exchange_funding_events
type FillRow = {
  fill_id: string;
  exchange_order_id: string;
  customer_id: number;
  trade_date: string; // YYYY-MM-DD
  order_side?: string | null;
  intent_side?: string | null;
  fill_qty?: number | string | null;
  fill_price?: number | string | null;
  fee_asset?: string | null;
  fee_qty?: number | string | null;
  intent_id?: string | null;
  base_asset?: string | null;
  quote_asset?: string | null;
};

type FundingRow = {
  funding_id: string;
  customer_id: number;
  kind: string;   // deposit / withdrawal
  asset: string;  // BTC / USDT
  amount: number | string;
  occurred_at: string;
};

Deno.serve(async (req: Request) => {
  try {
    const sb = getServiceClient();
    const org_id = Deno.env.get("ORG_ID");
    if (!org_id) {
      return new Response("ORG_ID missing", { status: 500 });
    }

    // ----------- 0) Resolve date range -----------
    let fromDate = "";
    let toDate = "";

    if (req.method === "POST" || req.method === "PUT") {
      try {
        const body = await req.json().catch(() => null);
        if (body && typeof body === "object") {
          if (typeof body.from_date === "string") fromDate = body.from_date;
          if (typeof body.to_date === "string")   toDate   = body.to_date;
        }
      } catch (e) {
        console.error("Error parsing JSON body", e);
      }
    }

    const todayStr = yyyymmdd(new Date());
    if (!fromDate) fromDate = todayStr;
    if (!toDate)   toDate   = todayStr;

    // normalise (swap if reversed)
    if (fromDate > toDate) {
      const tmp = fromDate;
      fromDate = toDate;
      toDate = tmp;
    }

    console.log(
      `[ef_post_ledger_and_balances] org=${org_id} range=${fromDate}..${toDate}`,
    );

    // ----------------------------------------------------
    // 1) FILLS → ledger_lines (per-fill, idempotent via ref_fill_id)
    // ----------------------------------------------------
    const { data: fills, error: fErr } = await sb
      .from("v_fills_with_customer")
      .select(
        "fill_id, exchange_order_id, customer_id, trade_date, " +
        "order_side, intent_side, fill_qty, fill_price, " +
        "fee_asset, fee_qty, intent_id, base_asset, quote_asset",
      )
      .eq("org_id", org_id)
      .eq("order_status", "filled")
      .gte("trade_date", fromDate)
      .lte("trade_date", toDate);

    if (fErr) {
      console.error("Error fetching fills", fErr);
      return new Response(`Error fetching fills: ${fErr.message}`, {
        status: 500,
      });
    }

    let fillsInserted = 0;

    if ((fills ?? []).length > 0) {
      const fillIds = (fills as FillRow[]).map((r) => r.fill_id);

      const { data: existingLedger, error: exErr } = await sb
        .from("ledger_lines")
        .select("ref_fill_id")
        .eq("org_id", org_id)
        .in("ref_fill_id", fillIds);

      if (exErr) {
        console.error("Error fetching existing ledger_lines for fills", exErr);
        return new Response(
          `Error fetching existing ledger_lines for fills: ${exErr.message}`,
          { status: 500 },
        );
      }

      const existingSet = new Set(
        (existingLedger ?? []).map((x: any) => x.ref_fill_id),
      );

      const toInsert: any[] = [];

      for (const raw of fills as FillRow[]) {
        if (existingSet.has(raw.fill_id)) continue;

        const side = (raw.order_side || raw.intent_side) ?? null;
        if (side !== "BUY" && side !== "SELL") {
          console.warn("Skipping fill with unexpected side", raw);
          continue;
        }

        const qty = Number(raw.fill_qty ?? 0);
        const price = Number(raw.fill_price ?? 0);
        if (!qty || !price) {
          console.warn("Skipping fill with qty/price 0", raw);
          continue;
        }

        const notional = qty * price;
        const feeAsset = raw.fee_asset ?? null;
        const feeQty = Number(raw.fee_qty ?? 0);

        const feeBtc = feeAsset === "BTC" ? feeQty : 0;
        const feeUsdt = feeAsset === "USDT" ? feeQty : 0;

        const isBuy = side === "BUY";
        const amountBtc = isBuy ? qty : -qty;
        const amountUsdt = isBuy ? -notional : notional;

        toInsert.push({
          org_id,
          customer_id: raw.customer_id,
          trade_date: raw.trade_date,
          kind: isBuy ? "buy" : "sell",
          amount_btc: amountBtc,
          amount_usdt: amountUsdt,
          fee_btc: feeBtc,
          fee_usdt: feeUsdt,
          ref_intent_id: raw.intent_id ?? null,
          ref_order_id: raw.exchange_order_id,
          ref_fill_id: raw.fill_id,
        });
      }

      if (toInsert.length > 0) {
        const { error: insErr } = await sb.from("ledger_lines").insert(toInsert);
        if (insErr) {
          console.error("Error inserting ledger_lines from fills", insErr);
          return new Response(
            `Error inserting ledger_lines from fills: ${insErr.message}`,
            { status: 500 },
          );
        }
        fillsInserted = toInsert.length;
      }
    }

    // ----------------------------------------------------
    // 2) FUNDING EVENTS → ledger_lines (topup / withdrawal)
    // ----------------------------------------------------
    let fundingInserted = 0;

    const fromTs = new Date(`${fromDate}T00:00:00.000Z`).toISOString();
    const toTsExclusive = new Date(
      new Date(`${toDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data: funding, error: fundErr } = await sb
      .from("exchange_funding_events")
      .select("funding_id, customer_id, kind, asset, amount, occurred_at")
      .eq("org_id", org_id)
      .gte("occurred_at", fromTs)
      .lt("occurred_at", toTsExclusive);

    if (fundErr) {
      console.error("Error fetching funding events", fundErr);
      return new Response(
        `Error fetching funding events: ${fundErr.message}`,
        { status: 500 },
      );
    }

    if ((funding ?? []).length > 0) {
      const fundingNotes = (funding as FundingRow[]).map(
        (f) => `funding:${f.funding_id}`,
      );

      const { data: existingFundingLedger, error: exFundErr } = await sb
        .from("ledger_lines")
        .select("note")
        .eq("org_id", org_id)
        .in("note", fundingNotes);

      if (exFundErr) {
        console.error(
          "Error fetching existing funding ledger_lines",
          exFundErr,
        );
        return new Response(
          `Error fetching existing funding ledger_lines: ${exFundErr.message}`,
          { status: 500 },
        );
      }

      const existingNotes = new Set(
        (existingFundingLedger ?? []).map((x: any) => x.note),
      );

      const toInsertFunding: any[] = [];

      for (const f of funding as FundingRow[]) {
        const note = `funding:${f.funding_id}`;
        if (existingNotes.has(note)) continue;

        const asset = f.asset;
        const kind = f.kind;
        const tradeDate = yyyymmdd(new Date(f.occurred_at));
        const amount = Number(f.amount ?? 0);
        if (!amount) continue;

        const isDeposit = kind === "deposit";
        let amountBtc: number | string = 0;
        let amountUsdt: number | string = 0;
        let platformFeeBtc: number | string = 0;
        let platformFeeUsdt: number | string = 0;

        if (asset === "BTC") {
          if (isDeposit) {
            // BTC deposits: deduct 0.75% platform fee (using Decimal for precision, keep as string)
            const amountDecimal = new Decimal(amount);
            const feeDecimal = amountDecimal.times(0.0075);
            const netDecimal = amountDecimal.minus(feeDecimal);
            platformFeeBtc = feeDecimal.toFixed(8); // Keep as string to preserve precision
            amountBtc = netDecimal.toFixed(8);
          } else {
            amountBtc = -amount; // withdrawal
          }
        } else if (asset === "USDT") {
          if (isDeposit) {
            // USDT deposits: deduct 0.75% platform fee on NET amount (using Decimal for precision, keep as string)
            const amountDecimal = new Decimal(amount);
            const feeDecimal = amountDecimal.times(0.0075);
            const netDecimal = amountDecimal.minus(feeDecimal);
            platformFeeUsdt = feeDecimal.toFixed(8); // Keep as string to preserve precision
            amountUsdt = netDecimal.toFixed(8);
            console.log(`[PRECISION CHECK] amount=${amount}, fee=${platformFeeUsdt}, net=${amountUsdt}, type=${typeof amountUsdt}`);
          } else {
            amountUsdt = -amount; // withdrawal
          }
        } else {
          console.warn("Skipping funding event with unsupported asset", f);
          continue;
        }

        toInsertFunding.push({
          org_id,
          customer_id: f.customer_id,
          trade_date: tradeDate,
          kind: isDeposit ? "topup" : "withdrawal",
          amount_btc: amountBtc,
          amount_usdt: amountUsdt,
          fee_btc: 0, // VALR exchange fees (not applicable to deposits)
          fee_usdt: 0,
          platform_fee_btc: platformFeeBtc,
          platform_fee_usdt: platformFeeUsdt,
          note,
        });
      }

      if (toInsertFunding.length > 0) {
        const { data: insertedRows, error: insFundErr } = await sb
          .from("ledger_lines")
          .insert(toInsertFunding)
          .select("ledger_id, customer_id, platform_fee_btc, platform_fee_usdt");
        
        if (insFundErr) {
          console.error(
            "Error inserting ledger_lines from funding events",
            insFundErr,
          );
          return new Response(
            `Error inserting ledger_lines from funding events: ${insFundErr.message}`,
            { status: 500 },
          );
        }
        fundingInserted = toInsertFunding.length;

        // Transfer platform fees to BitWealth main account
        for (const row of (insertedRows ?? []) as any[]) {
          const ledgerId = row.ledger_id;
          const customerId = row.customer_id;
          const feeBtc = Number(row.platform_fee_btc ?? 0);
          const feeUsdt = Number(row.platform_fee_usdt ?? 0);

          // Get customer's exchange account info via customer_strategies join
          const { data: customerStrat, error: stratErr } = await sb
            .schema("public")
            .from("customer_strategies")
            .select("exchange_account_id")
            .eq("customer_id", customerId)
            .single();

          if (stratErr || !customerStrat?.exchange_account_id) {
            await logAlert(
              sb,
              "ef_post_ledger_and_balances",
              "error",
              `No customer strategy found for customer ${customerId}`,
              { customer_id: customerId, ledger_id: ledgerId },
              org_id,
              customerId,
            );
            console.error(`No customer strategy for customer ${customerId}`);
            continue;
          }

          const { data: exchangeAcct, error: exAcctErr } = await sb
            .schema("public")
            .from("exchange_accounts")
            .select("subaccount_id")
            .eq("exchange_account_id", customerStrat.exchange_account_id)
            .eq("exchange", "VALR")
            .single();

          if (exAcctErr || !exchangeAcct) {
            await logAlert(
              sb,
              "ef_post_ledger_and_balances",
              "error",
              `No exchange account found for customer ${customerId}`,
              { customer_id: customerId, ledger_id: ledgerId },
              org_id,
              customerId,
            );
            console.error(`No exchange account for customer ${customerId}`);
            continue;
          }

          const subaccountId = exchangeAcct.subaccount_id;
          const mainAccountId = Deno.env.get("VALR_MAIN_ACCOUNT_ID") || "main";

          // Transfer BTC platform fee if > 0
          if (feeBtc > 0) {
            const transferResult = await transferToMainAccount(
              sb,
              {
                fromSubaccountId: subaccountId,
                toAccount: mainAccountId,
                currency: "BTC",
                amount: feeBtc,
                transferType: "platform_fee",
              },
              customerId,
              ledgerId,
            );

            if (!transferResult.success) {
              await logAlert(
                sb,
                "ef_post_ledger_and_balances",
                "error",
                `BTC platform fee transfer failed: ${transferResult.errorMessage}`,
                {
                  customer_id: customerId,
                  ledger_id: ledgerId,
                  amount_btc: feeBtc,
                  error: transferResult.errorMessage,
                },
                org_id,
                customerId,
              );
              console.error(
                `BTC platform fee transfer failed for customer ${customerId}: ${transferResult.errorMessage}`,
              );
            }
          }

          // Transfer USDT platform fee if > 0
          if (feeUsdt > 0) {
            const transferResult = await transferToMainAccount(
              sb,
              {
                fromSubaccountId: subaccountId,
                toAccount: mainAccountId,
                currency: "USDT",
                amount: feeUsdt,
                transferType: "platform_fee",
              },
              customerId,
              ledgerId,
            );

            if (!transferResult.success) {
              await logAlert(
                sb,
                "ef_post_ledger_and_balances",
                "error",
                `USDT platform fee transfer failed: ${transferResult.errorMessage}`,
                {
                  customer_id: customerId,
                  ledger_id: ledgerId,
                  amount_usdt: feeUsdt,
                  error: transferResult.errorMessage,
                },
                org_id,
                customerId,
              );
              console.error(
                `USDT platform fee transfer failed for customer ${customerId}: ${transferResult.errorMessage}`,
              );
            }
          }
        }
      }
    }

    // ----------------------------------------------------
    // 3) Roll balances_daily for all customers with activity
    // ----------------------------------------------------
    let balancesUpserted = 0;

    const { data: activityRows, error: actErr } = await sb
      .from("ledger_lines")
      .select("customer_id, trade_date")
      .eq("org_id", org_id)
      .neq("kind", "fee")
      .gte("trade_date", fromDate)
      .lte("trade_date", toDate);

    if (actErr) {
      console.error("Error fetching ledger activity", actErr);
      return new Response(
        `Error fetching ledger activity: ${actErr.message}`,
        { status: 500 },
      );
    }

    if ((activityRows ?? []).length > 0) {
      const datesSet = new Set<string>();
      const dateToCustomers = new Map<string, Set<number>>();

      for (const row of activityRows as any[]) {
        const d = row.trade_date as string;
        const c = row.customer_id as number;
        if (!d || c == null) continue;

        datesSet.add(d);
        let custSet = dateToCustomers.get(d);
        if (!custSet) {
          custSet = new Set<number>();
          dateToCustomers.set(d, custSet);
        }
        custSet.add(c);
      }

      const sortedDates = Array.from(datesSet).sort();
      const pxCache = new Map<string, number>();
      let lastPx = 0;

      for (const dateStr of sortedDates) {
        // price lookup: last available price <= dateStr
        let px = pxCache.get(dateStr);
        if (px === undefined) {
          const { data: ci, error: ciErr } = await sb
            .from("ci_bands_daily")
            .select("btc_price")
            .lte("date", dateStr)
            .order("date", { ascending: false })
            .limit(1)
            .single();

          if (ciErr) {
            console.error("Error fetching BTC price for", dateStr, ciErr);
          }

          px = Number((ci as any)?.btc_price ?? lastPx ?? 0);
          pxCache.set(dateStr, px);
          lastPx = px;
        }

        const custSet = dateToCustomers.get(dateStr);
        if (!custSet) continue;

        for (const customer_id of custSet) {
          // previous balance
          const { data: prevRows, error: prevErr } = await sb
            .from("balances_daily")
            .select("btc_balance, usdt_balance")
            .eq("org_id", org_id)
            .eq("customer_id", customer_id)
            .lt("date", dateStr)
            .order("date", { ascending: false })
            .limit(1);

          if (prevErr) {
            console.error("Error fetching previous balance", {
              dateStr,
              customer_id,
              prevErr,
            });
            return new Response(
              `Error fetching previous balance: ${prevErr.message}`,
              { status: 500 },
            );
          }

          const prev =
            prevRows?.[0] ?? { btc_balance: 0 as number, usdt_balance: 0 as number };

          // today deltas (including fees)
          const { data: sums, error: sumsErr } = await sb
            .from("ledger_lines")
            .select("amount_btc, amount_usdt, fee_btc, fee_usdt")
            .eq("org_id", org_id)
            .eq("customer_id", customer_id)
            .eq("trade_date", dateStr);

          if (sumsErr) {
            console.error("Error fetching ledger sums", {
              dateStr,
              customer_id,
              sumsErr,
            });
            return new Response(
              `Error fetching ledger sums: ${sumsErr.message}`,
              { status: 500 },
            );
          }

          let dBtc = 0,
            dUsdt = 0,
            fBtc = 0,
            fUsdt = 0;

          for (const s of (sums ?? []) as any[]) {
            dBtc += Number(s.amount_btc ?? 0);
            dUsdt += Number(s.amount_usdt ?? 0);
            fBtc += Number(s.fee_btc ?? 0);
            fUsdt += Number(s.fee_usdt ?? 0);
          }

          const btc = Number(prev.btc_balance ?? 0) + dBtc - fBtc;
          const usdt = Number(prev.usdt_balance ?? 0) + dUsdt - fUsdt;
          const nav = btc * px + usdt;

          const { error: upErr } = await sb.from("balances_daily").upsert(
            {
              org_id,
              customer_id,
              date: dateStr,
              btc_balance: btc,
              usdt_balance: usdt,
              nav_usd: nav,
            },
            { onConflict: "org_id,customer_id,date" },
          );

          if (upErr) {
            console.error("Error upserting balances_daily", {
              dateStr,
              customer_id,
              upErr,
            });
            return new Response(
              `Error upserting balances_daily: ${upErr.message}`,
              { status: 500 },
            );
          }

          balancesUpserted++;
        }
      }
    }

    const payload = {
      status: "ok",
      org_id,
      from_date: fromDate,
      to_date: toDate,
      fills_inserted: fillsInserted,
      funding_inserted: fundingInserted,
      balances_upserted: balancesUpserted,
    };

    return new Response(JSON.stringify(payload, null, 2), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("Unhandled error in ef_post_ledger_and_balances", e);
    return new Response("Internal error in ef_post_ledger_and_balances", {
      status: 500,
    });
  }
});
