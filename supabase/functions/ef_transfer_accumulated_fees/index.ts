import { getServiceClient, yyyymmdd } from "./client.ts";
import { transferToMainAccount } from "../_shared/valrTransfer.ts";
import { logAlert } from "../_shared/alerting.ts";

/**
 * ef_transfer_accumulated_fees
 * 
 * Monthly cron job (1st of month at 02:00 UTC) to batch transfer accumulated platform fees
 * that have reached minimum thresholds.
 * 
 * Runs BEFORE ef_fee_monthly_close (03:00 UTC) so invoices reflect transferred fees.
 */

type AccumulatedFeeRow = {
  customer_id: number;
  org_id: string;
  accumulated_btc: string | number;
  accumulated_usdt: string | number;
  accumulated_zar: string | number;
  transfer_count: number;
};

type CustomerAccountInfo = {
  customer_id: number;
  subaccount_id: string;
  exchange_account_id: number;
};

Deno.serve(async () => {
  try {
    const sb = getServiceClient();
    const org_id = Deno.env.get("ORG_ID");
    if (!org_id) {
      return new Response("ORG_ID missing", { status: 500 });
    }

    const mainAccountId = Deno.env.get("VALR_MAIN_ACCOUNT_ID") || "main";

    console.log(`[ef_transfer_accumulated_fees] Starting monthly batch transfer for org=${org_id}`);

    // ----------- 1) Fetch VALR minimum thresholds (transfer AND conversion) -----------
    const { data: configRows, error: configErr } = await sb
      .from("system_config")
      .select("config_key, config_value")
      .in("config_key", [
        "valr_min_transfer_btc",
        "valr_min_transfer_usdt",
        "valr_min_conversion_btc",
        "valr_min_conversion_usdt",
      ]);

    if (configErr) {
      console.error("Error fetching system_config", configErr);
      return new Response(`Error fetching system_config: ${configErr.message}`, {
        status: 500,
      });
    }

    // VALR thresholds - TRANSFER (subaccount→main) vs CONVERSION (BTC→USDT order)
    // Transfer: BTC 0.000001 (1,000 sats), USDT $0.06
    // Conversion: BTC 0.000001 (1,000 sats), USDT $0.52
    const minTransferBtc = Number(
      (configRows ?? []).find((r: any) => r.config_key === "valr_min_transfer_btc")?.config_value ?? "0.000001"
    );
    const minTransferUsdt = Number(
      (configRows ?? []).find((r: any) => r.config_key === "valr_min_transfer_usdt")?.config_value ?? "0.06"
    );
    const minConversionBtc = Number(
      (configRows ?? []).find((r: any) => r.config_key === "valr_min_conversion_btc")?.config_value ?? "0.000001"
    );
    const minConversionUsdt = Number(
      (configRows ?? []).find((r: any) => r.config_key === "valr_min_conversion_usdt")?.config_value ?? "0.52"
    );

    console.log(
      `[ef_transfer_accumulated_fees] VALR thresholds - Transfer: BTC ${minTransferBtc}, USDT ${minTransferUsdt}; Conversion: BTC ${minConversionBtc}, USDT ${minConversionUsdt}`
    );

    // ----------- 2) Fetch customers with accumulated fees >= TRANSFER minimum -----------
    const { data: accumulatedFees, error: fetchErr } = await sb
      .from("customer_accumulated_fees")
      .select("customer_id, org_id, accumulated_btc, accumulated_usdt, accumulated_zar, transfer_count")
      .eq("org_id", org_id)
      .or(`accumulated_btc.gte.${minTransferBtc},accumulated_usdt.gte.${minTransferUsdt}`);

    if (fetchErr) {
      console.error("Error fetching accumulated fees", fetchErr);
      return new Response(`Error fetching accumulated fees: ${fetchErr.message}`, {
        status: 500,
      });
    }

    const rows = (accumulatedFees ?? []) as AccumulatedFeeRow[];

    if (rows.length === 0) {
      console.log(`[ef_transfer_accumulated_fees] No accumulated fees >= thresholds found`);
      return new Response(JSON.stringify({
        success: true,
        transferred_count: 0,
        failed_count: 0,
        total_btc: 0,
        total_usdt: 0,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`[ef_transfer_accumulated_fees] Found ${rows.length} customers with accumulated fees`);

    // ----------- 3) Get exchange account info for all customers -----------
    const customerIds = rows.map((r) => r.customer_id);

    const { data: customerStrategies, error: stratErr } = await sb
      .schema("public")
      .from("customer_strategies")
      .select("customer_id, exchange_account_id")
      .in("customer_id", customerIds);

    if (stratErr) {
      console.error("Error fetching customer strategies", stratErr);
      return new Response(`Error fetching customer strategies: ${stratErr.message}`, {
        status: 500,
      });
    }

    const exchangeAccountIds = (customerStrategies ?? []).map((cs: any) => cs.exchange_account_id);

    const { data: exchangeAccounts, error: exAcctErr } = await sb
      .schema("public")
      .from("exchange_accounts")
      .select("exchange_account_id, subaccount_id")
      .in("exchange_account_id", exchangeAccountIds)
      .eq("exchange", "VALR");

    if (exAcctErr) {
      console.error("Error fetching exchange accounts", exAcctErr);
      return new Response(`Error fetching exchange accounts: ${exAcctErr.message}`, {
        status: 500,
      });
    }

    // Build customer_id -> subaccount_id map
    const customerAccountMap: Map<number, string> = new Map();
    for (const cs of (customerStrategies ?? [])) {
      const exAcct = (exchangeAccounts ?? []).find((ea: any) => ea.exchange_account_id === cs.exchange_account_id);
      if (exAcct) {
        customerAccountMap.set(cs.customer_id, exAcct.subaccount_id);
      }
    }

    // ----------- 4) Process each customer: transfer accumulated fees -----------
    let transferredCount = 0;
    let failedCount = 0;
    let totalBtcTransferred = 0;
    let totalUsdtTransferred = 0;

    for (const row of rows) {
      const customerId = row.customer_id;
      const accumBtc = Number(row.accumulated_btc || 0);
      const accumUsdt = Number(row.accumulated_usdt || 0);
      const subaccountId = customerAccountMap.get(customerId);

      if (!subaccountId) {
        await logAlert(
          sb,
          "ef_transfer_accumulated_fees",
          "error",
          `No exchange account found for customer ${customerId}`,
          { customer_id: customerId },
          org_id,
          customerId,
        );
        console.error(`[ef_transfer_accumulated_fees] No subaccount for customer ${customerId}, skipping`);
        failedCount++;
        continue;
      }

      console.log(
        `[ef_transfer_accumulated_fees] Processing customer ${customerId}: BTC ${accumBtc}, USDT ${accumUsdt}`,
      );

      let btcSuccess = false;
      let usdtSuccess = false;

      // Transfer BTC if >= transfer minimum
      if (accumBtc >= minTransferBtc) {
        console.log(`[ef_transfer_accumulated_fees] Transferring ${accumBtc} BTC for customer ${customerId}`);

        const btcResult = await transferToMainAccount(
          sb,
          {
            fromSubaccountId: subaccountId,
            toAccount: mainAccountId,
            currency: "BTC",
            amount: accumBtc,
            transferType: "platform_fee",
          },
          customerId,
          null, // No specific ledger_id for monthly batch
        );

        if (btcResult.success) {
          console.log(`[ef_transfer_accumulated_fees] BTC transfer successful for customer ${customerId}`);
          btcSuccess = true;
          totalBtcTransferred += accumBtc;

          // Check if transferred amount >= CONVERSION minimum
          if (accumBtc >= minConversionBtc) {
            // Trigger auto-conversion to USDT
            console.log(
              `[ef_transfer_accumulated_fees] ${accumBtc} BTC >= conversion threshold (${minConversionBtc}), triggering BTC→USDT conversion`,
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
                    btc_amount: accumBtc,
                    customer_id: customerId,
                    transfer_id: btcResult.transferId,
                  }),
                },
              );

              if (conversionResponse.ok) {
                const conversionResult = await conversionResponse.json();
                console.log(
                  `[ef_transfer_accumulated_fees] BTC→USDT conversion successful: ${conversionResult.btc_sold} BTC → $${conversionResult.usdt_received} USDT`,
                );
              } else {
                const errorText = await conversionResponse.text();
                console.error(
                  `[ef_transfer_accumulated_fees] BTC→USDT conversion failed: ${errorText}`,
                );
              }
            } catch (convError) {
              console.error(
                `[ef_transfer_accumulated_fees] Error triggering BTC conversion:`,
                convError,
              );
            }
          } else {
            // Transferred < conversion threshold - accumulate in main account
            console.log(
              `[ef_transfer_accumulated_fees] ${accumBtc} BTC < conversion threshold (${minConversionBtc}), adding to main account accumulation`,
            );
            try {
              const { error: accumErr } = await sb.rpc("accumulate_main_account_btc", {
                p_btc_amount: accumBtc,
                p_notes: `Transferred from customer ${customerId}, awaiting conversion threshold`,
              });

              if (accumErr) {
                console.error(
                  `[ef_transfer_accumulated_fees] Error accumulating BTC in main account: ${accumErr.message}`,
                );
                await logAlert(
                  sb,
                  "ef_transfer_accumulated_fees",
                  "error",
                  `Failed to accumulate ${accumBtc} BTC in main account: ${accumErr.message}`,
                  {
                    customer_id: customerId,
                    btc_amount: accumBtc,
                    error: accumErr.message,
                  },
                  org_id,
                  customerId,
                );
              } else {
                console.log(
                  `[ef_transfer_accumulated_fees] Successfully added ${accumBtc} BTC to main account accumulation`,
                );
              }
            } catch (accumError) {
              console.error(
                `[ef_transfer_accumulated_fees] Error calling accumulate_main_account_btc:`,
                accumError,
              );
            }
          }
        } else {
          await logAlert(
            sb,
            "ef_transfer_accumulated_fees",
            "error",
            `BTC monthly batch transfer failed: ${btcResult.errorMessage}`,
            {
              customer_id: customerId,
              accumulated_btc: accumBtc,
              error: btcResult.errorMessage,
            },
            org_id,
            customerId,
          );
          console.error(
            `[ef_transfer_accumulated_fees] BTC transfer failed for customer ${customerId}: ${btcResult.errorMessage}`,
          );
        }

        // Add rate limiting delay (VALR limit: 20 req/sec)
        await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms between requests
      }

      // Transfer USDT if >= transfer minimum
      if (accumUsdt >= minTransferUsdt) {
        console.log(`[ef_transfer_accumulated_fees] Transferring ${accumUsdt} USDT for customer ${customerId}`);

        const usdtResult = await transferToMainAccount(
          sb,
          {
            fromSubaccountId: subaccountId,
            toAccount: mainAccountId,
            currency: "USDT",
            amount: accumUsdt,
            transferType: "platform_fee",
          },
          customerId,
          null, // No specific ledger_id for monthly batch
        );

        if (usdtResult.success) {
          console.log(`[ef_transfer_accumulated_fees] USDT transfer successful for customer ${customerId}`);
          usdtSuccess = true;
          totalUsdtTransferred += accumUsdt;
        } else {
          await logAlert(
            sb,
            "ef_transfer_accumulated_fees",
            "error",
            `USDT monthly batch transfer failed: ${usdtResult.errorMessage}`,
            {
              customer_id: customerId,
              accumulated_usdt: accumUsdt,
              error: usdtResult.errorMessage,
            },
            org_id,
            customerId,
          );
          console.error(
            `[ef_transfer_accumulated_fees] USDT transfer failed for customer ${customerId}: ${usdtResult.errorMessage}`,
          );
        }

        // Add rate limiting delay
        await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms between requests
      }

      // ----------- 5) Update customer_accumulated_fees table -----------
      if (btcSuccess || usdtSuccess) {
        const updateData: any = {
          last_transfer_attempt_at: new Date().toISOString(),
          transfer_count: row.transfer_count + 1,
        };

        if (btcSuccess) {
          updateData.accumulated_btc = 0;
        }

        if (usdtSuccess) {
          updateData.accumulated_usdt = 0;
        }

        const { error: updateErr } = await sb
          .from("customer_accumulated_fees")
          .update(updateData)
          .eq("customer_id", customerId)
          .eq("org_id", org_id);

        if (updateErr) {
          console.error(
            `[ef_transfer_accumulated_fees] Failed to update accumulated fees for customer ${customerId}: ${updateErr.message}`,
          );
        } else {
          console.log(`[ef_transfer_accumulated_fees] Updated accumulated fees for customer ${customerId}`);
          transferredCount++;
        }
      } else {
        // Update last attempt timestamp even if transfer failed
        const { error: attemptErr } = await sb
          .from("customer_accumulated_fees")
          .update({ last_transfer_attempt_at: new Date().toISOString() })
          .eq("customer_id", customerId)
          .eq("org_id", org_id);

        if (attemptErr) {
          console.error(
            `[ef_transfer_accumulated_fees] Failed to update last_transfer_attempt_at for customer ${customerId}: ${attemptErr.message}`,
          );
        }

        failedCount++;
      }
    }

    // ----------- 6) Return summary -----------
    const summary = {
      success: true,
      transferred_count: transferredCount,
      failed_count: failedCount,
      total_btc: totalBtcTransferred,
      total_usdt: totalUsdtTransferred,
      processed_at: new Date().toISOString(),
    };

    console.log(
      `[ef_transfer_accumulated_fees] Monthly batch complete: ${transferredCount} transferred, ${failedCount} failed, ${totalBtcTransferred} BTC, ${totalUsdtTransferred} USDT`,
    );

    return new Response(JSON.stringify(summary), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[ef_transfer_accumulated_fees] Unexpected error:", e);
    return new Response(`Unexpected error: ${e.message}`, { status: 500 });
  }
});
