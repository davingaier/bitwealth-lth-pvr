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
    const body = {
      fromId: request.fromSubaccountId,
      toId: request.toAccount, 
      currencyCode: request.currency,
      amount: request.amount.toString()
    };

    const timestamp = Date.now().toString();
    const signature = await signVALR(
      timestamp,
      "POST",
      path,
      JSON.stringify(body),
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
      body: JSON.stringify(body)
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
