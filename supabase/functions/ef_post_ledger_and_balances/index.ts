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

    // ----------- 0) Fetch VALR minimum transfer thresholds -----------
    const { data: configRows, error: configErr } = await sb
      .from("system_config")
      .select("config_key, config_value")
      .in("config_key", ["valr_min_transfer_btc", "valr_min_transfer_usdt"]);

    if (configErr) {
      console.error("Error fetching system_config", configErr);
      return new Response(`Error fetching system_config: ${configErr.message}`, {
        status: 500,
      });
    }

    const minBtc = Number(
      (configRows ?? []).find((r: any) => r.config_key === "valr_min_transfer_btc")?.config_value ?? "0.0001"
    );
    const minUsdt = Number(
      (configRows ?? []).find((r: any) => r.config_key === "valr_min_transfer_usdt")?.config_value ?? "1.00"
    );

    console.log(`[ef_post_ledger_and_balances] VALR thresholds: BTC ${minBtc}, USDT ${minUsdt}`);

    // ----------- 1) Resolve date range -----------
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
    
    // Debug: Log all fills with fee data
    console.log(`[ef_post_ledger_and_balances] Retrieved ${fills?.length || 0} fills from view`);
    fills?.forEach(f => {
      console.log(`[ef_post_ledger_and_balances] View data for fill ${f.fill_id}: fee_asset=${f.fee_asset}, fee_qty=${f.fee_qty}, typeof(fee_qty)=${typeof f.fee_qty}`);
    });

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

        // Ensure fees are properly extracted (fix for fee recording bug)
        const feeBtc = feeAsset === "BTC" ? feeQty : 0;
        const feeUsdt = feeAsset === "USDT" ? feeQty : 0;
        
        // Enhanced debug logging for fee extraction
        console.log(`[ef_post_ledger_and_balances] Fill ${raw.fill_id}: raw.fee_asset=${JSON.stringify(raw.fee_asset)}, raw.fee_qty=${JSON.stringify(raw.fee_qty)}, feeAsset=${feeAsset}, feeQty=${feeQty}, feeBtc=${feeBtc}, feeUsdt=${feeUsdt}, typeof(raw.fee_qty)=${typeof raw.fee_qty}`);
        
        if (feeQty === 0 && raw.fee_qty !== 0 && raw.fee_qty !== null) {
          console.error(`[ef_post_ledger_and_balances] WARNING: feeQty is 0 but raw.fee_qty is ${raw.fee_qty}!`);
        }

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

      // Query platform fee rates for all customers with funding events
      const customerIds = Array.from(new Set((funding as FundingRow[]).map(f => f.customer_id)));
      const { data: customerStrategies, error: stratErr } = await sb
        .schema("public")
        .from("customer_strategies")
        .select("customer_id, platform_fee_rate")
        .in("customer_id", customerIds);

      if (stratErr) {
        console.error("Error fetching customer strategies", stratErr);
        return new Response(
          `Error fetching customer strategies: ${stratErr.message}`,
          { status: 500 },
        );
      }

      // Create lookup map for platform fee rates (default to 0.75% if not found)
      const feeRateMap = new Map<number, number>();
      for (const strat of customerStrategies ?? []) {
        const rate = parseFloat(strat.platform_fee_rate ?? "0.0075");
        feeRateMap.set(strat.customer_id, rate);
      }

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
            // BTC deposits: record GROSS amount (what VALR credited), calculate platform fee separately
            const platformFeeRate = feeRateMap.get(f.customer_id) ?? 0.0075;
            const amountDecimal = new Decimal(amount);
            const feeDecimal = amountDecimal.times(platformFeeRate);
            platformFeeBtc = feeDecimal.toFixed(8); // Keep as string to preserve precision
            amountBtc = amountDecimal.toFixed(8); // Record GROSS amount from VALR
          } else {
            // Withdrawal: amount from funding event is NEGATIVE (after v0.6.31 fix), preserve it
            amountBtc = amount;
          }
        } else if (asset === "USDT") {
          if (isDeposit) {
            // USDT deposits: record GROSS amount (what VALR credited), calculate platform fee separately
            const platformFeeRate = feeRateMap.get(f.customer_id) ?? 0.0075;
            const amountDecimal = new Decimal(amount);
            const feeDecimal = amountDecimal.times(platformFeeRate);
            platformFeeUsdt = feeDecimal.toFixed(8); // Keep as string to preserve precision
            amountUsdt = amountDecimal.toFixed(8); // Record GROSS amount from VALR
            console.log(`[PRECISION CHECK] amount=${amount}, fee=${platformFeeUsdt}, gross=${amountUsdt}, type=${typeof amountUsdt}`);
          } else {
            // Withdrawal: amount from funding event is NEGATIVE (after v0.6.31 fix), preserve it
            amountUsdt = amount;
          }
        } else if (asset === "ZAR") {
          // ZAR transactions (zar_deposit, zar_balance, zar_withdrawal) are informational only
          // They track fiat movement but don't affect crypto ledger balances
          // Crypto withdrawals are recorded separately via paired USDT/BTC withdrawal events
          console.log(`  ℹ️  Skipping ZAR transaction (informational only): ${kind} ${amount} ZAR`);
          continue;
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

          // Transfer BTC platform fee (with threshold checking)
          if (feeBtc > 0) {
            if (feeBtc >= minBtc) {
              // Fee meets minimum - transfer immediately
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
              } else {
                // Transfer successful - trigger auto-conversion to USDT
                console.log(
                  `[ef_post_ledger_and_balances] BTC fee ${feeBtc} transferred successfully, triggering conversion to USDT`,
                );

                try {
                  const conversionResponse = await fetch(
                    `${Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL")}/functions/v1/ef_convert_platform_fee_btc`,
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                      },
                      body: JSON.stringify({
                        btc_amount: feeBtc,
                        customer_id: customerId,
                        transfer_id: transferResult.transferId,
                      }),
                    },
                  );

                  if (conversionResponse.ok) {
                    const conversionResult = await conversionResponse.json();
                    console.log(
                      `[ef_post_ledger_and_balances] BTC→USDT conversion successful: ${conversionResult.btc_sold} BTC → $${conversionResult.usdt_received} USDT`,
                    );
                  } else {
                    const errorText = await conversionResponse.text();
                    console.error(
                      `[ef_post_ledger_and_balances] BTC→USDT conversion failed: ${errorText}`,
                    );
                    await logAlert(
                      sb,
                      "ef_post_ledger_and_balances",
                      "warn",
                      `BTC platform fee conversion failed (fee transferred but not converted)`,
                      {
                        customer_id: customerId,
                        btc_amount: feeBtc,
                        error: errorText,
                      },
                      org_id,
                      customerId,
                    );
                  }
                } catch (convError) {
                  console.error(
                    `[ef_post_ledger_and_balances] Error triggering BTC conversion:`,
                    convError,
                  );
                  await logAlert(
                    sb,
                    "ef_post_ledger_and_balances",
                    "warn",
                    `BTC platform fee conversion error: ${convError.message}`,
                    {
                      customer_id: customerId,
                      btc_amount: feeBtc,
                      error: convError.message,
                    },
                    org_id,
                    customerId,
                  );
                }
              }
            } else {
              // Fee below minimum - accumulate it
              console.log(
                `[ef_post_ledger_and_balances] BTC fee ${feeBtc} < ${minBtc}, accumulating for customer ${customerId}`,
              );

              try {
                // Check if customer already has accumulated fees
                const { data: existingAccum, error: fetchErr } = await sb
                  .from("customer_accumulated_fees")
                  .select("accumulated_btc, accumulated_usdt, accumulated_zar")
                  .eq("customer_id", customerId)
                  .eq("org_id", org_id)
                  .maybeSingle();

                if (fetchErr) {
                  throw new Error(`Failed to fetch accumulated fees: ${fetchErr.message}`);
                }

                if (existingAccum) {
                  // Update existing record
                  const newBtc = Number(existingAccum.accumulated_btc || 0) + feeBtc;
                  const { error: updateErr } = await sb
                    .from("customer_accumulated_fees")
                    .update({
                      accumulated_btc: newBtc,
                      last_updated_at: new Date().toISOString(),
                    })
                    .eq("customer_id", customerId)
                    .eq("org_id", org_id);

                  if (updateErr) {
                    throw new Error(`Failed to update accumulated BTC: ${updateErr.message}`);
                  }

                  console.log(
                    `[ef_post_ledger_and_balances] Updated accumulated BTC for customer ${customerId}: ${newBtc}`,
                  );

                  // Check if accumulated total now >= minimum (batch transfer)
                  if (newBtc >= minBtc) {
                    console.log(
                      `[ef_post_ledger_and_balances] Accumulated BTC ${newBtc} >= ${minBtc}, batch transferring for customer ${customerId}`,
                    );

                    const batchResult = await transferToMainAccount(
                      sb,
                      {
                        fromSubaccountId: subaccountId,
                        toAccount: mainAccountId,
                        currency: "BTC",
                        amount: newBtc,
                        transferType: "fee_batch",
                      },
                      customerId,
                      null, // No specific ledger_id for batch transfer
                    );

                    if (batchResult.success) {
                      // Clear accumulated BTC and increment transfer count
                      const { error: clearErr } = await sb
                        .from("customer_accumulated_fees")
                        .update({
                          accumulated_btc: 0,
                          last_transfer_attempt_at: new Date().toISOString(),
                          transfer_count: (existingAccum.transfer_count || 0) + 1,
                        })
                        .eq("customer_id", customerId)
                        .eq("org_id", org_id);

                      if (clearErr) {
                        console.error(
                          `Failed to clear accumulated BTC for customer ${customerId}: ${clearErr.message}`,
                        );
                      } else {
                        // Create ledger entry for batch transfer out
                        await sb.from("ledger_lines").insert({
                          org_id,
                          customer_id: customerId,
                          trade_date: yyyymmdd(new Date()),
                          kind: "transfer",
                          amount_btc: -newBtc,
                          amount_usdt: 0,
                          note: `Fee batch transfer: ${batchResult.transferId}`,
                        });
                        
                        console.log(
                          `[ef_post_ledger_and_balances] Batch transferred ${newBtc} BTC for customer ${customerId}`,
                        );
                      }

                      // Trigger auto-conversion to USDT after successful batch transfer
                      try {
                        const conversionResponse = await fetch(
                          `${Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL")}/functions/v1/ef_convert_platform_fee_btc`,
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                            },
                            body: JSON.stringify({
                              btc_amount: newBtc,
                              customer_id: customerId,
                              transfer_id: batchResult.transferId,
                            }),
                          },
                        );

                        if (conversionResponse.ok) {
                          const conversionResult = await conversionResponse.json();
                          console.log(
                            `[ef_post_ledger_and_balances] Batch BTC→USDT conversion successful: ${conversionResult.btc_sold} BTC → $${conversionResult.usdt_received} USDT`,
                          );
                        } else {
                          const errorText = await conversionResponse.text();
                          console.error(
                            `[ef_post_ledger_and_balances] Batch BTC→USDT conversion failed: ${errorText}`,
                          );
                        }
                      } catch (convError) {
                        console.error(
                          `[ef_post_ledger_and_balances] Error triggering batch BTC conversion:`,
                          convError,
                        );
                      }
                    } else {
                      await logAlert(
                        sb,
                        "ef_post_ledger_and_balances",
                        "error",
                        `BTC batch transfer failed: ${batchResult.errorMessage}`,
                        {
                          customer_id: customerId,
                          accumulated_btc: newBtc,
                          error: batchResult.errorMessage,
                        },
                        org_id,
                        customerId,
                      );
                      console.error(
                        `BTC batch transfer failed for customer ${customerId}: ${batchResult.errorMessage}`,
                      );
                    }
                  }
                } else {
                  // Insert new record
                  const { error: insertErr } = await sb
                    .from("customer_accumulated_fees")
                    .insert({
                      customer_id: customerId,
                      org_id: org_id,
                      accumulated_btc: feeBtc,
                      accumulated_usdt: 0,
                      accumulated_zar: 0,
                      last_updated_at: new Date().toISOString(),
                      transfer_count: 0,
                    });

                  if (insertErr) {
                    throw new Error(`Failed to insert accumulated BTC: ${insertErr.message}`);
                  }

                  console.log(
                    `[ef_post_ledger_and_balances] Inserted accumulated BTC for customer ${customerId}: ${feeBtc}`,
                  );
                }
              } catch (e) {
                await logAlert(
                  sb,
                  "ef_post_ledger_and_balances",
                  "error",
                  `BTC fee accumulation error: ${e.message}`,
                  {
                    customer_id: customerId,
                    ledger_id: ledgerId,
                    amount_btc: feeBtc,
                    error: e.message,
                  },
                  org_id,
                  customerId,
                );
                console.error(
                  `BTC fee accumulation error for customer ${customerId}: ${e.message}`,
                );
              }
            }
          }

          // Transfer USDT platform fee (with threshold checking)
          if (feeUsdt > 0) {
            // First, check for any accumulated fees
            let totalUsdtToTransfer = feeUsdt;
            let accumulatedAmount = 0;
            
            try {
              const { data: existingAccum, error: fetchErr } = await sb
                .from("customer_accumulated_fees")
                .select("accumulated_usdt")
                .eq("customer_id", customerId)
                .eq("org_id", org_id)
                .maybeSingle();

              if (!fetchErr && existingAccum) {
                accumulatedAmount = Number(existingAccum.accumulated_usdt || 0);
                totalUsdtToTransfer = feeUsdt + accumulatedAmount;
                console.log(
                  `[ef_post_ledger_and_balances] Customer ${customerId} has accumulated USDT ${accumulatedAmount}, total to transfer: ${totalUsdtToTransfer}`,
                );
              }
            } catch (e) {
              console.error(`Error checking accumulated USDT for customer ${customerId}:`, e);
            }
            
            if (totalUsdtToTransfer >= minUsdt) {
              // Total meets minimum - transfer immediately
              const transferResult = await transferToMainAccount(
                sb,
                {
                  fromSubaccountId: subaccountId,
                  toAccount: mainAccountId,
                  currency: "USDT",
                  amount: totalUsdtToTransfer,
                  transferType: accumulatedAmount > 0 ? "fee_batch" : "platform_fee",
                },
                customerId,
                ledgerId,
              );

              if (transferResult.success) {
                // Create ledger entry for transfer out
                await sb.from("ledger_lines").insert({
                  org_id,
                  customer_id: customerId,
                  trade_date: yyyymmdd(new Date()),
                  kind: "transfer",
                  amount_btc: 0,
                  amount_usdt: -totalUsdtToTransfer,
                  note: `Platform fee transfer: ${transferResult.transferId}`,
                });
                
                // Clear accumulated fees if any were included
                if (accumulatedAmount > 0) {
                  await sb
                    .from("customer_accumulated_fees")
                    .update({
                      accumulated_usdt: 0,
                      last_transfer_attempt_at: new Date().toISOString(),
                    })
                    .eq("customer_id", customerId)
                    .eq("org_id", org_id);
                }
                
                console.log(
                  `[ef_post_ledger_and_balances] Transferred ${totalUsdtToTransfer} USDT for customer ${customerId} (current: ${feeUsdt}, accumulated: ${accumulatedAmount})`,
                );
              } else {
                await logAlert(
                  sb,
                  "ef_post_ledger_and_balances",
                  "error",
                  `USDT platform fee transfer failed: ${transferResult.errorMessage}`,
                  {
                    customer_id: customerId,
                    ledger_id: ledgerId,
                    amount_usdt: totalUsdtToTransfer,
                    current_fee: feeUsdt,
                    accumulated: accumulatedAmount,
                    error: transferResult.errorMessage,
                  },
                  org_id,
                  customerId,
                );
                console.error(
                  `USDT platform fee transfer failed for customer ${customerId}: ${transferResult.errorMessage}`,
                );
              }
            } else {
              // Fee below minimum - accumulate it
              console.log(
                `[ef_post_ledger_and_balances] USDT fee ${feeUsdt} < ${minUsdt}, accumulating for customer ${customerId}`,
              );

              try {
                // Check if customer already has accumulated fees
                const { data: existingAccum, error: fetchErr } = await sb
                  .from("customer_accumulated_fees")
                  .select("accumulated_btc, accumulated_usdt, accumulated_zar, transfer_count")
                  .eq("customer_id", customerId)
                  .eq("org_id", org_id)
                  .maybeSingle();

                if (fetchErr) {
                  throw new Error(`Failed to fetch accumulated fees: ${fetchErr.message}`);
                }

                if (existingAccum) {
                  // Update existing record
                  const newUsdt = Number(existingAccum.accumulated_usdt || 0) + feeUsdt;
                  const { error: updateErr } = await sb
                    .from("customer_accumulated_fees")
                    .update({
                      accumulated_usdt: newUsdt,
                      last_updated_at: new Date().toISOString(),
                    })
                    .eq("customer_id", customerId)
                    .eq("org_id", org_id);

                  if (updateErr) {
                    throw new Error(`Failed to update accumulated USDT: ${updateErr.message}`);
                  }

                  console.log(
                    `[ef_post_ledger_and_balances] Updated accumulated USDT for customer ${customerId}: ${newUsdt}`,
                  );

                  // Check if accumulated total now >= minimum (batch transfer)
                  if (newUsdt >= minUsdt) {
                    console.log(
                      `[ef_post_ledger_and_balances] Accumulated USDT ${newUsdt} >= ${minUsdt}, batch transferring for customer ${customerId}`,
                    );

                    const batchResult = await transferToMainAccount(
                      sb,
                      {
                        fromSubaccountId: subaccountId,
                        toAccount: mainAccountId,
                        currency: "USDT",
                        amount: newUsdt,
                        transferType: "fee_batch",
                      },
                      customerId,
                      null, // No specific ledger_id for batch transfer
                    );

                    if (batchResult.success) {
                      // Clear accumulated USDT and increment transfer count
                      const { error: clearErr } = await sb
                        .from("customer_accumulated_fees")
                        .update({
                          accumulated_usdt: 0,
                          last_transfer_attempt_at: new Date().toISOString(),
                          transfer_count: (existingAccum.transfer_count || 0) + 1,
                        })
                        .eq("customer_id", customerId)
                        .eq("org_id", org_id);

                      if (clearErr) {
                        console.error(
                          `Failed to clear accumulated USDT for customer ${customerId}: ${clearErr.message}`,
                        );
                      } else {
                        // Create ledger entry for batch transfer out
                        await sb.from("ledger_lines").insert({
                          org_id,
                          customer_id: customerId,
                          trade_date: yyyymmdd(new Date()),
                          kind: "transfer",
                          amount_btc: 0,
                          amount_usdt: -newUsdt,
                          note: `Fee batch transfer: ${batchResult.transferId}`,
                        });
                      
                        console.log(
                          `[ef_post_ledger_and_balances] Batch transferred ${newUsdt} USDT for customer ${customerId}`,
                        );
                      }
                    } else {
                      await logAlert(
                        sb,
                        "ef_post_ledger_and_balances",
                        "error",
                        `USDT batch transfer failed: ${batchResult.errorMessage}`,
                        {
                          customer_id: customerId,
                          accumulated_usdt: newUsdt,
                          error: batchResult.errorMessage,
                        },
                        org_id,
                        customerId,
                      );
                      console.error(
                        `USDT batch transfer failed for customer ${customerId}: ${batchResult.errorMessage}`,
                      );
                    }
                  }
                } else {
                  // Insert new record
                  const { error: insertErr } = await sb
                    .from("customer_accumulated_fees")
                    .insert({
                      customer_id: customerId,
                      org_id: org_id,
                      accumulated_btc: 0,
                      accumulated_usdt: feeUsdt,
                      accumulated_zar: 0,
                      last_updated_at: new Date().toISOString(),
                      transfer_count: 0,
                    });

                  if (insertErr) {
                    throw new Error(`Failed to insert accumulated USDT: ${insertErr.message}`);
                  }

                  console.log(
                    `[ef_post_ledger_and_balances] Inserted accumulated USDT for customer ${customerId}: ${feeUsdt}`,
                  );
                }
              } catch (e) {
                await logAlert(
                  sb,
                  "ef_post_ledger_and_balances",
                  "error",
                  `USDT fee accumulation error: ${e.message}`,
                  {
                    customer_id: customerId,
                    ledger_id: ledgerId,
                    amount_usdt: feeUsdt,
                    error: e.message,
                  },
                  org_id,
                  customerId,
                );
                console.error(
                  `USDT fee accumulation error for customer ${customerId}: ${e.message}`,
                );
              }
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

    // ----------- FINAL: Check for accumulated fees ready for batch transfer -----------
    console.log("[ef_post_ledger_and_balances] === BATCH TRANSFER CHECK START ===");
    
    // Log to alerts for debugging
    await logAlert(
      sb,
      "ef_post_ledger_and_balances",
      "info",
      `Batch transfer check: thresholds BTC=${minBtc}, USDT=${minUsdt}`,
      { org_id, minBtc, minUsdt },
      org_id,
      null,
    );
    
    const { data: customersWithFees, error: feeQueryErr } = await sb
      .from("customer_accumulated_fees")
      .select("customer_id, accumulated_btc, accumulated_usdt, transfer_count")
      .eq("org_id", org_id)
      .or(`accumulated_btc.gte.${minBtc},accumulated_usdt.gte.${minUsdt}`);

    if (feeQueryErr) {
      console.error("[ef_post_ledger_and_balances] Error querying accumulated fees:", feeQueryErr);
      await logAlert(
        sb,
        "ef_post_ledger_and_balances",
        "error",
        `Batch transfer query error: ${feeQueryErr.message}`,
        { error: feeQueryErr },
        org_id,
        null,
      );
    }
    
    await logAlert(
      sb,
      "ef_post_ledger_and_balances",
      "info",
      `Batch transfer: found ${customersWithFees?.length || 0} customers`,
      { count: customersWithFees?.length || 0 },
      org_id,
      null,
    );

    if (customersWithFees && customersWithFees.length > 0) {
      console.log(`Found ${customersWithFees.length} customer(s) with fees ready for transfer`);

      for (const customer of customersWithFees) {
        const customerId = customer.customer_id;
        
        await logAlert(
          sb,
          "ef_post_ledger_and_balances",
          "info",
          `Processing batch transfer for customer ${customerId}`,
          { customer_id: customerId, accumulated_btc: customer.accumulated_btc },
          org_id,
          customerId,
        );

        // Get exchange account via customer_strategies
        const { data: customerStrat, error: stratErr } = await sb
          .schema("lth_pvr")
          .from("customer_strategies")
          .select("exchange_account_id")
          .eq("customer_id", customerId)
          .eq("live_enabled", true)
          .maybeSingle();

        if (stratErr || !customerStrat) {
          console.warn(`No customer strategy found for customer ${customerId}`);
          await logAlert(
            sb,
            "ef_post_ledger_and_balances",
            "warn",
            `No customer strategy found for customer ${customerId}`,
            { customer_id: customerId, error: stratErr },
            org_id,
            customerId,
          );
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
          console.warn(`No exchange account found for customer ${customerId}`);
          continue;
        }

        const subaccountId = exchangeAcct.subaccount_id;
        const mainAccountId = Deno.env.get("VALR_MAIN_ACCOUNT_ID") || "main";

        // Batch transfer BTC if threshold met
        if (customer.accumulated_btc >= minBtc) {
          console.log(
            `[BATCH] Transferring ${customer.accumulated_btc} BTC for customer ${customerId}`,
          );

          const batchResult = await transferToMainAccount(
            sb,
            {
              fromSubaccountId: subaccountId,
              toAccount: mainAccountId,
              currency: "BTC",
              amount: customer.accumulated_btc,
              transferType: "fee_batch",
            },
            customerId,
            null,
          );

          if (batchResult.success) {
            await sb
              .from("customer_accumulated_fees")
              .update({
                accumulated_btc: 0,
                last_transfer_attempt_at: new Date().toISOString(),
                transfer_count: (customer.transfer_count || 0) + 1,
              })
              .eq("customer_id", customerId)
              .eq("org_id", org_id);
            console.log(`[BATCH] BTC transfer successful for customer ${customerId}`);
            
            // Create ledger entry for batch transfer out
            await sb.from("ledger_lines").insert({
              org_id,
              customer_id: customerId,
              trade_date: yyyymmdd(new Date()),
              kind: "transfer",
              amount_btc: -customer.accumulated_btc,
              amount_usdt: 0,
              note: `Fee batch transfer: ${batchResult.transferId}`,
            });
            
            // Create ledger entry for batch transfer out
            await sb.from("ledger_lines").insert({
              org_id,
              customer_id: customerId,
              trade_date: yyyymmdd(new Date()),
              kind: "transfer",
              amount_btc: -customer.accumulated_btc,
              amount_usdt: 0,
              note: `Fee batch transfer: ${batchResult.transferId}`,
            });
          } else {
            await logAlert(
              sb,
              "ef_post_ledger_and_balances",
              "error",
              `Batch BTC transfer failed: ${batchResult.errorMessage}`,
              { customer_id: customerId, accumulated_btc: customer.accumulated_btc },
              org_id,
              customerId,
            );
          }
        }

        // Batch transfer USDT if threshold met
        if (customer.accumulated_usdt >= minUsdt) {
          console.log(
            `[BATCH] Transferring ${customer.accumulated_usdt} USDT for customer ${customerId}`,
          );

          const batchResult = await transferToMainAccount(
            sb,
            {
              fromSubaccountId: subaccountId,
              toAccount: mainAccountId,
              currency: "USDT",
              amount: customer.accumulated_usdt,
              transferType: "fee_batch",
            },
            customerId,
            null,
          );

          if (batchResult.success) {
            await sb
              .from("customer_accumulated_fees")
              .update({
                accumulated_usdt: 0,
                last_transfer_attempt_at: new Date().toISOString(),
                transfer_count: (customer.transfer_count || 0) + 1,
              })
              .eq("customer_id", customerId)
              .eq("org_id", org_id);
            console.log(`[BATCH] USDT transfer successful for customer ${customerId}`);
            
            // Create ledger entry for batch transfer out
            await sb.from("ledger_lines").insert({
              org_id,
              customer_id: customerId,
              trade_date: yyyymmdd(new Date()),
              kind: "transfer",
              amount_btc: 0,
              amount_usdt: -customer.accumulated_usdt,
              note: `Fee batch transfer: ${batchResult.transferId}`,
            });
          } else {
            await logAlert(
              sb,
              "ef_post_ledger_and_balances",
              "error",
              `Batch USDT transfer failed: ${batchResult.errorMessage}`,
              { customer_id: customerId, accumulated_usdt: customer.accumulated_usdt },
              org_id,
              customerId,
            );
          }
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

