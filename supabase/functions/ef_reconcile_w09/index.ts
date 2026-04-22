// One-off reconciliation function for request f32dfe4d-45fd-4453-9341-b24be8f65083.
// Dispatches a R100 ZAR fiat withdrawal to the customer's linked bank, then marks
// the withdrawal_request row 'completed' with the resulting valr_withdrawal_id.
//
// Deploy: supabase functions deploy ef_reconcile_w09 --project-ref wqnmxpooabmedvtackji --no-verify-jwt
// Trigger: curl -X POST <url>/functions/v1/ef_reconcile_w09 -H "Authorization: Bearer <anon>" -d '{}'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { resolveCustomerCredentials } from "../_shared/valrCredentials.ts";
import { zarWithdraw } from "../_shared/valrClient.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REQUEST_ID = "f32dfe4d-45fd-4453-9341-b24be8f65083";
const CUSTOMER_ID = 31;
const BANK_VALR_ID = "01420f62-397e-43d6-bce4-73e47738458a";
const AMOUNT_ZAR = "100";

const sbLthPvr = createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: "lth_pvr" } });

Deno.serve(async () => {
  try {
    const creds = await resolveCustomerCredentials(sbLthPvr, CUSTOMER_ID);

    const wdRes: any = await zarWithdraw(
      BANK_VALR_ID,
      AMOUNT_ZAR,
      false, // fast = false -> standard EFT
      creds.subaccountId,
      { apiKey: creds.apiKey, apiSecret: creds.apiSecret },
    );

    const valrWithdrawalId = wdRes?.id ?? wdRes?.withdrawalId ?? wdRes?.transactionId ?? null;

    const { error: updErr } = await sbLthPvr
      .from("withdrawal_requests")
      .update({
        status: "completed",
        valr_withdrawal_id: valrWithdrawalId,
        valr_response: wdRes,
        failure_reason: null,
        completed_at: new Date().toISOString(),
        notes: "Reconciled manually after queue retry-loop incident 2026-04-21. Excess ~R59 left in customer ZAR wallet.",
      })
      .eq("request_id", REQUEST_ID);

    if (updErr) throw new Error(`DB update failed: ${updErr.message}`);

    return new Response(JSON.stringify({ success: true, valr_withdrawal_id: valrWithdrawalId, valr_response: wdRes }, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }, null, 2), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
