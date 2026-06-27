// valrTransfer.ts - Shared module for VALR subaccount transfer operations
// Purpose: Transfer platform/performance fees from customer subaccounts to BitWealth main account
// VALR API: POST /v1/account/subaccount/transfer
// Rate Limit: 20 requests/second
// Required Permission: "Transfer" scope on API Key

import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { signVALR } from "./valr.ts";

export interface TransferRequest {
  fromSubaccountId: string;
  toAccount: string; // 'main' for BitWealth main account
  currency: "USDT" | "BTC" | "ZAR";
  amount: number;
  transferType: "platform_fee" | "performance_fee" | "manual";
}

export interface TransferResult {
  success: boolean;
  transferId?: string; // UUID from valr_transfer_log
  valrResponse?: any;
  errorMessage?: string;
}

/**
 * Transfer funds from customer subaccount to BitWealth main account
 * Logs all transfers to lth_pvr.valr_transfer_log for audit trail
 * 
 * @param sb Supabase client (should use lth_pvr schema)
 * @param request Transfer details
 * @param customerId Customer ID for logging
 * @param ledgerId Optional ledger_id to link transfer to specific ledger entry
 * @returns TransferResult with success status and transfer_id
 */
export async function transferToMainAccount(
  sb: SupabaseClient,
  request: TransferRequest,
  customerId: number,
  ledgerId?: string
): Promise<TransferResult> {
  const orgId = Deno.env.get("ORG_ID");
  const valrApiKey = Deno.env.get("VALR_API_KEY");
  const valrApiSecret = Deno.env.get("VALR_API_SECRET");
  const testMode = Deno.env.get("VALR_TEST_MODE") === "true";

  if (!testMode && (!valrApiKey || !valrApiSecret)) {
    return {
      success: false,
      errorMessage: "VALR API credentials not configured"
    };
  }

  // Create initial transfer log entry (status: pending)
  const { data: transferLog, error: logError } = await sb
    .from("valr_transfer_log")
    .insert({
      org_id: orgId,
      customer_id: customerId,
      transfer_type: request.transferType,
      currency: request.currency,
      amount: request.amount,
      from_subaccount_id: request.fromSubaccountId,
      to_account: request.toAccount,
      ledger_id: ledgerId,
      status: "pending"
    })
    .select("transfer_id")
    .single();

  if (logError) {
    console.error("Failed to create transfer log:", logError);
    return {
      success: false,
      errorMessage: `Database error: ${logError.message}`
    };
  }

  const transferId = transferLog.transfer_id;

  // In test mode, mock successful transfer without calling VALR API
  if (testMode) {
    await sb
      .from("valr_transfer_log")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        valr_api_response: { mock: true, message: "Test mode - transfer simulated" }
      })
      .eq("transfer_id", transferId);

    return {
      success: true,
      transferId,
      valrResponse: { mock: true, message: "Test mode - transfer simulated" }
    };
  }

  try {
    // VALR API: Internal Transfer Subaccounts
    // https://api.valr.com/v1/account/subaccounts/transfer (note: plural "subaccounts")
    const path = "/v1/account/subaccounts/transfer";

    // VALR requires fromId and toId as *integers* (not strings).
    // Primary account ID is 0; subaccount IDs are large 64-bit integers.
    // JavaScript's JSON.stringify cannot safely represent integers > 2^53, so we
    // build the body string manually to preserve the exact subaccount ID digits.
    // allowBorrow is a required field per VALR schema (use false unless borrowing).
    const toId = request.toAccount === "main" ? 0 : request.toAccount;
    const bodyString = `{"fromId":${request.fromSubaccountId},"toId":${toId},"currencyCode":"${request.currency}","amount":"${request.amount.toString()}","allowBorrow":false}`;

    const timestamp = Date.now().toString();
    const signature = await signVALR(
      timestamp,
      "POST",
      path,
      bodyString,
      valrApiSecret
    );

    const valrResponse = await fetch(`https://api.valr.com${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-VALR-API-KEY": valrApiKey,
        "X-VALR-SIGNATURE": signature,
        "X-VALR-TIMESTAMP": timestamp
      },
      body: bodyString
    });

    // Handle empty responses (204 No Content or empty body)
    let responseData: any = {};
    const responseText = await valrResponse.text();
    console.log(`VALR transfer response (${valrResponse.status}):`, responseText);
    
    if (responseText && responseText.trim().length > 0) {
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        console.error("Failed to parse VALR response as JSON:", responseText);
        responseData = { raw_response: responseText };
      }
    }

    if (!valrResponse.ok) {
      // Transfer failed - update log
      await sb
        .from("valr_transfer_log")
        .update({
          status: "failed",
          error_message: responseData.message || `HTTP ${valrResponse.status}`,
          valr_api_response: responseData
        })
        .eq("transfer_id", transferId);

      return {
        success: false,
        transferId,
        valrResponse: responseData,
        errorMessage: responseData.message || `HTTP ${valrResponse.status}`
      };
    }

    // Transfer successful - update log
    await sb
      .from("valr_transfer_log")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        valr_api_response: responseData
      })
      .eq("transfer_id", transferId);

    return {
      success: true,
      transferId,
      valrResponse: responseData
    };

  } catch (error) {
    // Network/unexpected error - update log with retry count
    await sb
      .from("valr_transfer_log")
      .update({
        status: "failed",
        error_message: error.message,
        retry_count: 1 // Could implement exponential backoff retry logic here
      })
      .eq("transfer_id", transferId);

    return {
      success: false,
      transferId,
      errorMessage: error.message
    };
  }
}

/**
 * Retry a failed transfer (for manual admin retry or automated retry logic)
 * 
 * @param sb Supabase client
 * @param transferId UUID of failed transfer from valr_transfer_log
 * @returns TransferResult
 */
export async function retryTransfer(
  sb: SupabaseClient,
  transferId: string
): Promise<TransferResult> {
  // Fetch original transfer details
  const { data: originalTransfer, error } = await sb
    .from("valr_transfer_log")
    .select("*")
    .eq("transfer_id", transferId)
    .single();

  if (error || !originalTransfer) {
    return {
      success: false,
      errorMessage: "Transfer not found"
    };
  }

  if (originalTransfer.status === "completed") {
    return {
      success: false,
      errorMessage: "Transfer already completed"
    };
  }

  // Update retry count
  await sb
    .from("valr_transfer_log")
    .update({
      retry_count: (originalTransfer.retry_count || 0) + 1,
      status: "pending"
    })
    .eq("transfer_id", transferId);

  // Retry transfer with same parameters
  return await transferToMainAccount(
    sb,
    {
      fromSubaccountId: originalTransfer.from_subaccount_id,
      toAccount: originalTransfer.to_account,
      currency: originalTransfer.currency,
      amount: parseFloat(originalTransfer.amount),
      transferType: originalTransfer.transfer_type
    },
    originalTransfer.customer_id,
    originalTransfer.ledger_id
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// withdrawFeeFromCustomerAccount
//
// Withdraws a platform or performance fee from a customer's VALR account to
// BitWealth's static fee-collection wallet.
//
// Routing:
//   subaccount model → internal VALR subaccount transfer (no external withdrawal)
//   api model        → VALR crypto withdrawal API using customer's vault key
//
// Also used for Option A BTC interim fee settlement: when a customer's USDT
// balance is insufficient to cover the full interim performance fee at withdrawal
// time, the BTC shortfall is transferred here immediately before the customer
// withdrawal is processed.
//
// The destination wallet address is read from public.wallet_config to avoid
// hard-coding addresses in edge function code.
// ─────────────────────────────────────────────────────────────────────────────

import { resolveCustomerCredentials } from "./valrCredentials.ts";
import { logAlert } from "./alerting.ts";
import {
  getAccountBalances,
  pickAvailable,
  getMarketPrice,
  placeMarketOrder,
  getOrderSummaryByCustomerOrderId,
} from "./valrClient.ts";
import { loadUsdpcConfig, sizeUsdpcToUsdt } from "./usdpc.ts";

const VALR_API_URL_TRANSFER =
  Deno.env.get("VALR_API_URL") ??
  Deno.env.get("VALR_API_BASE") ??
  "https://api.valr.com";

// ─────────────────────────────────────────────────────────────────────────────
// ensureIdleUsdt
//
// USDPC-enabled customers keep idle cash in the USDPC yield stablecoin, so their
// idle USDT is continuously swept away. Any USDT outflow (a fee transfer, a USDT
// withdrawal, or a USDT→ZAR conversion sell) would then fail with VALR
// "Insufficient Balance" even though the customer holds ample value.
//
// Before such an outflow we unwind JUST ENOUGH USDPC → USDT (a market SELL on
// USDPC/USDT) to cover `requiredUsdt`, poll the fill, then ledger the conversion
// (kind='convert', USDPC down / USDT up) so computed balances stay in sync with
// VALR. Added 2026-06-01; generalised for withdrawals 2026-06-02.
//
// `creds` accepts `{ apiKey, apiSecret, subaccountId }` (extra fields ignored).
// For the subaccount model pass the master key + the customer's subaccountId;
// for the api model pass the customer's own key + subaccountId=null.
//
// No-op (returns { ok:true, converted:false }) when the customer is not
// usdpc_enabled, when idle USDT already covers the requirement, or in test mode.
// ─────────────────────────────────────────────────────────────────────────────
export async function ensureIdleUsdt(
  sb: SupabaseClient,
  customerId: number,
  requiredUsdt: number,
  creds: { apiKey: string; apiSecret: string; subaccountId: string | null },
): Promise<{ ok: boolean; converted: boolean; usdtReceived?: number; error?: string }> {
  const orgId = Deno.env.get("ORG_ID");
  const testMode = Deno.env.get("VALR_TEST_MODE") === "true";

  // Only relevant for USDPC-enabled customers.
  const { data: stratRow } = await sb
    .schema("public")
    .from("customer_strategies")
    .select("usdpc_enabled")
    .eq("customer_id", customerId)
    .eq("strategy_code", "LTH_PVR")
    .eq("status", "active")
    .maybeSingle();
  if (!stratRow?.usdpc_enabled) return { ok: true, converted: false };
  if (testMode) return { ok: true, converted: false };

  const requestCreds = { apiKey: creds.apiKey, apiSecret: creds.apiSecret };
  const subId = creds.subaccountId;

  // Current idle balances.
  let balances: Array<{ currency: string; available: string }>;
  try {
    balances = await getAccountBalances(subId, requestCreds);
  } catch (e) {
    return { ok: false, converted: false, error: `balance fetch failed: ${(e as Error).message}` };
  }
  const idleUsdt = pickAvailable(balances, "USDT");
  if (idleUsdt >= requiredUsdt) return { ok: true, converted: false };

  const usdpcAvail = pickAvailable(balances, "USDPC");
  if (usdpcAvail <= 0) {
    return {
      ok: false,
      converted: false,
      error: `USDT short by ${(requiredUsdt - idleUsdt).toFixed(8)} and no USDPC available to convert`,
    };
  }

  const cfg = await loadUsdpcConfig(sb);
  let price: number;
  try {
    price = await getMarketPrice(cfg.pair);
  } catch (e) {
    return { ok: false, converted: false, error: `USDPC price fetch failed: ${(e as Error).message}` };
  }

  // Convert enough to net the shortfall + 0.5% buffer (fee/slippage), but never
  // below VALR's minimum order size. Cap at the available USDPC holding. Any
  // leftover USDT is swept back into USDPC by the next BTC-sell cycle.
  const shortfall = +(requiredUsdt - idleUsdt).toFixed(8);
  const targetUsdt = Math.max(shortfall * 1.005, cfg.minOrderUsdt);
  const sizing = sizeUsdpcToUsdt(targetUsdt, usdpcAvail, price, cfg.takerFeeRate);
  const usdpcToSell = +sizing.usdpcToSell.toFixed(8);
  if (usdpcToSell <= 0) {
    return { ok: false, converted: false, error: `unable to size USDPC conversion (avail=${usdpcAvail}, need=${shortfall})` };
  }

  // Place the market SELL (USDPC → USDT).
  const coid = crypto.randomUUID();
  try {
    await placeMarketOrder(cfg.pair, "SELL", usdpcToSell.toFixed(8), coid, subId, requestCreds);
  } catch (e) {
    return { ok: false, converted: false, error: `USDPC SELL placement failed: ${(e as Error).message}` };
  }

  // Poll until filled (market IOC fills within seconds).
  let summary: Record<string, unknown> | null = null;
  let filled = false;
  for (let i = 0; i < 10; i++) {
    try {
      summary = await getOrderSummaryByCustomerOrderId(coid, cfg.pair, subId, requestCreds) as Record<string, unknown>;
      const st = String(summary?.orderStatusType ?? "").toLowerCase();
      if (st === "filled") { filled = true; break; }
      if (st === "failed" || st === "cancelled" || st === "expired") {
        return { ok: false, converted: false, error: `USDPC SELL ${st}: ${summary?.failedReason ?? ""}` };
      }
    } catch (_e) { /* summary 400s while the order is still working — keep polling */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!filled) {
    return { ok: false, converted: false, error: `USDPC SELL not confirmed filled in time (coid=${coid})` };
  }

  // Derive actuals from the fill; fall back to the sizing estimate.
  const soldUsdpc = Number(summary?.totalExecutedQuantity ?? usdpcToSell) || usdpcToSell;
  const avgPrice = Number(summary?.averagePrice ?? price) || price;
  const grossUsdt = soldUsdpc * avgPrice;
  const feeUsdt = Number(summary?.totalFee ?? (grossUsdt * cfg.takerFeeRate)) || (grossUsdt * cfg.takerFeeRate);
  const usdtReceived = +(grossUsdt - feeUsdt).toFixed(8);

  // Ledger the conversion so computed balances track VALR (USDPC down, USDT up).
  try {
    await sb.from("ledger_lines").insert({
      org_id: orgId,
      customer_id: customerId,
      trade_date: new Date().toISOString().split("T")[0],
      kind: "convert",
      amount_btc: 0,
      amount_usdt: usdtReceived,
      amount_usdpc: -soldUsdpc,
      fee_usdt: feeUsdt,
      note: `USDPC→USDT fee pre-conversion (coid=${coid}, sold ${soldUsdpc} USDPC @ ${avgPrice})`,
    });
  } catch (e) {
    // Non-fatal: the VALR conversion succeeded; a missing ledger row is a
    // reconciliation concern, not a reason to block the fee transfer.
    await logAlert(
      sb,
      "valrTransfer.ensureIdleUsdt",
      "warn",
      `USDPC→USDT conversion succeeded but ledger insert failed for customer ${customerId}`,
      { customerId, coid, soldUsdpc, usdtReceived, error: (e as Error).message },
      orgId,
      customerId,
    );
  }

  return { ok: true, converted: true, usdtReceived };
}

export async function withdrawFeeFromCustomerAccount(
  sb: SupabaseClient,
  customerId: number,
  currency: "USDT" | "BTC",
  amount: number,
  ledgerId?: string,
  transferType: "platform_fee" | "performance_fee" | "fee_batch" = "performance_fee",
): Promise<TransferResult> {
  const orgId = Deno.env.get("ORG_ID");

  // ── 1. Resolve destination wallet from wallet_config ──────────────────────
  const { data: walletRow, error: walletErr } = await sb
    .schema("public")
    .from("wallet_config")
    .select("address")
    .eq("asset", currency)
    .eq("is_active", true)
    .maybeSingle();

  if (walletErr || !walletRow?.address) {
    return {
      success: false,
      errorMessage: `wallet_config missing for asset=${currency}: ${walletErr?.message ?? "no active row"}`,
    };
  }
  const destinationAddress: string = walletRow.address;

  // ── 2. Resolve this customer's VALR credentials ───────────────────────────
  let creds: Awaited<ReturnType<typeof resolveCustomerCredentials>>;
  try {
    creds = await resolveCustomerCredentials(sb, customerId);
  } catch (e) {
    return { success: false, errorMessage: e.message };
  }

  // ── 2b. USDPC unwind (USDT fees only) ─────────────────────────────────────
  // USDPC-enabled customers hold idle cash in the USDPC yield stablecoin, so a
  // USDT fee transfer can fail with "Insufficient Balance". Convert just enough
  // USDPC → USDT first (no-op for non-USDPC customers / sufficient balances).
  if (currency === "USDT") {
    const unwind = await ensureIdleUsdt(sb, customerId, amount, creds);
    if (!unwind.ok) {
      return { success: false, errorMessage: `USDPC pre-conversion failed: ${unwind.error}` };
    }
  }

  // ── 3. Subaccount model: internal VALR transfer ───────────────────────────
  // transferToMainAccount writes its own valr_transfer_log row (with the same
  // ledger_id + transfer_type). We must NOT pre-insert a pending row here or it
  // collides with the unique index idx_valr_transfer_ledger_type. Delegate
  // directly and let the inner call own the logging.
  if (creds.accountModel === "subaccount") {
    if (!creds.subaccountId) {
      return { success: false, errorMessage: "subaccount_id missing for subaccount model customer" };
    }
    return await transferToMainAccount(
      sb,
      {
        fromSubaccountId: creds.subaccountId,
        toAccount: "main",
        currency,
        amount,
        transferType,
      },
      customerId,
      ledgerId,
    );
  }

  // ── 4. API model: VALR crypto withdrawal to BitWealth wallet ──────────────
  // Pre-insert the pending log row here (subaccount path above does its own
  // logging via transferToMainAccount). from_subaccount_id is null for API
  // model customers (column is nullable).
  const { data: transferLog, error: logError } = await sb
    .from("valr_transfer_log")
    .insert({
      org_id: orgId,
      customer_id: customerId,
      transfer_type: transferType,
      currency,
      amount,
      from_subaccount_id: null,
      to_account: destinationAddress,
      ledger_id: ledgerId,
      status: "pending",
    })
    .select("transfer_id")
    .single();

  if (logError) {
    return { success: false, errorMessage: `DB log error: ${logError.message}` };
  }
  const transferId: string = transferLog.transfer_id;

  const testMode = Deno.env.get("VALR_TEST_MODE") === "true";

  if (testMode) {
    await sb.from("valr_transfer_log").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      valr_api_response: { mock: true, message: "Test mode — withdrawal simulated" },
    }).eq("transfer_id", transferId);
    return { success: true, transferId, valrResponse: { mock: true } };
  }

  try {
    const { signVALR } = await import("./valr.ts");
    const path = `/v1/wallet/crypto/${currency}/withdraw`;
    const body = {
      amount: amount.toString(),
      address: destinationAddress,
    };
    const bodyString = JSON.stringify(body);
    const timestamp = Date.now().toString();
    const signature = await signVALR(timestamp, "POST", path, bodyString, creds.apiSecret);

    const valrResp = await fetch(`${VALR_API_URL_TRANSFER}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-VALR-API-KEY": creds.apiKey,
        "X-VALR-SIGNATURE": signature,
        "X-VALR-TIMESTAMP": timestamp,
        // No X-VALR-SUB-ACCOUNT-ID for API model customers
      },
      body: bodyString,
    });

    const responseText = await valrResp.text();
    let responseData: Record<string, unknown> = {};
    try { responseData = JSON.parse(responseText); } catch { responseData = { raw: responseText }; }

    if (!valrResp.ok) {
      const errMsg: string = (responseData.message as string) ?? `HTTP ${valrResp.status}`;
      const isMissingWhitelist =
        responseText.toLowerCase().includes("whitelist") ||
        responseText.toLowerCase().includes("not allowed");

      await sb.from("valr_transfer_log").update({
        status: "failed",
        error_message: errMsg,
        valr_api_response: responseData,
      }).eq("transfer_id", transferId);

      if (isMissingWhitelist) {
        await logAlert(
          sb,
          "valrTransfer.withdrawFeeFromCustomerAccount",
          "critical",
          `Customer ${customerId} withdrawal address not whitelisted on their VALR API key — manual action required`,
          { customerId, currency, amount, destinationAddress, transferId },
          orgId,
          customerId,
        );
      }

      return { success: false, transferId, valrResponse: responseData, errorMessage: errMsg };
    }

    await sb.from("valr_transfer_log").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      valr_api_response: responseData,
    }).eq("transfer_id", transferId);

    return { success: true, transferId, valrResponse: responseData };

  } catch (err) {
    await sb.from("valr_transfer_log").update({
      status: "failed",
      error_message: err.message,
    }).eq("transfer_id", transferId);
    return { success: false, transferId, errorMessage: err.message };
  }
}
