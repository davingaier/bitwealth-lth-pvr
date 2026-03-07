// Edge Function: ef_link_bank_account
// Purpose: Phase 3 (EF8) — Link a customer's ZAR bank account via VALR API and
//          store the bank details in exchange_accounts for future ZAR withdrawals.
//
// Auth: JWT-enabled. Admin only (service role token or admin JWT).
// Both subaccount and API model customers are supported.
//
// Subaccount model: master key + X-VALR-SUB-ACCOUNT-ID header.
// API model: customer vault key, no subaccount header (requires Link Bank Account permission).
//
// Note: VALR may not support bank linking for subaccounts via the master key.
// If VALR returns 4xx: logs a warn and stores bank details locally for record-keeping.
// Admin must then link the bank manually in VALR portal for subaccount customers.
//
// Deployed with: supabase functions deploy ef_link_bank_account

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { signVALR } from "../_shared/valr.ts";
import { resolveCustomerCredentials } from "../_shared/valrCredentials.ts";
import { logAlert } from "../_shared/alerting.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID       = Deno.env.get("ORG_ID");
const VALR_BASE    = Deno.env.get("VALR_API_URL") ?? Deno.env.get("VALR_API_BASE") ?? "https://api.valr.com";

if (!SUPABASE_URL || !SUPABASE_KEY || !ORG_ID) {
  throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID");
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

// ── VALR: link bank account ───────────────────────────────────────────────────
async function valrLinkBankAccount(
  apiKey: string,
  apiSecret: string,
  subaccountId: string | null,
  bankPayload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const path        = "/v1/bankaccounts/ZAR";
  const bodyString  = JSON.stringify(bankPayload);
  const timestamp   = Date.now().toString();
  const signature   = await signVALR(timestamp, "POST", path, bodyString, apiSecret, subaccountId ?? "");

  const headers: Record<string, string> = {
    "Content-Type":       "application/json",
    "X-VALR-API-KEY":     apiKey,
    "X-VALR-SIGNATURE":   signature,
    "X-VALR-TIMESTAMP":   timestamp,
  };
  if (subaccountId) {
    headers["X-VALR-SUB-ACCOUNT-ID"] = subaccountId;
  }

  const res = await fetch(`${VALR_BASE}${path}`, {
    method: "POST",
    headers,
    body: bodyString,
  });

  let data: unknown = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json();
    const {
      customer_id,
      bank_account_number,
      bank_account_holder,
      bank_name,
      bank_branch_code,
      bank_account_type,
    }: {
      customer_id: number;
      bank_account_number: string;
      bank_account_holder: string;
      bank_name: string;
      bank_branch_code?: string;
      bank_account_type?: string;
    } = body;

    // ── Validate inputs ──────────────────────────────────────────────────────
    if (!customer_id || !bank_account_number || !bank_account_holder || !bank_name) {
      return json({
        error: "Missing required fields: customer_id, bank_account_number, bank_account_holder, bank_name",
      }, 400);
    }

    // ── Load customer ────────────────────────────────────────────────────────
    const { data: customer, error: custErr } = await sb
      .from("customer_details")
      .select("customer_id, account_model, org_id")
      .eq("customer_id", customer_id)
      .single();

    if (custErr || !customer) return json({ error: "Customer not found" }, 404);

    // ── Resolve VALR credentials (model-aware) ───────────────────────────────
    let creds: Awaited<ReturnType<typeof resolveCustomerCredentials>>;
    try {
      creds = await resolveCustomerCredentials(sb, customer_id);
    } catch (e) {
      return json({ error: `Failed to resolve VALR credentials: ${e.message}` }, 500);
    }

    // ── Build VALR bank account payload ─────────────────────────────────────
    // VALR POST /v1/bankaccounts/ZAR expected body:
    // { accountNumber, accountHolder, bankName, branchCode, accountType }
    const bankPayload: Record<string, unknown> = {
      accountNumber: bank_account_number,
      accountHolder: bank_account_holder,
      bankName:      bank_name,
    };
    if (bank_branch_code) bankPayload.branchCode    = bank_branch_code;
    if (bank_account_type) bankPayload.accountType  = bank_account_type;

    // ── Call VALR to link bank account ───────────────────────────────────────
    let valrBankId: string | null = null;
    let valrLinked = false;
    const testMode = Deno.env.get("VALR_TEST_MODE") === "true";

    if (testMode) {
      valrBankId = "test_bank_id_" + Date.now();
      valrLinked = true;
    } else {
      const result = await valrLinkBankAccount(
        creds.apiKey,
        creds.apiSecret,
        creds.subaccountId,
        bankPayload,
      );

      if (result.ok) {
        const responseData = result.data as Record<string, unknown>;
        valrBankId = (responseData.id ?? responseData.bankAccountId ?? null) as string | null;
        valrLinked = true;
      } else {
        // Subaccount model may not support bank linking via master key — log warn, proceed locally
        const isSubaccountModel = creds.accountModel === "subaccount";
        const errMsg = isSubaccountModel
          ? `VALR rejected bank link for subaccount model customer ${customer_id} (HTTP ${result.status}). ` +
            "Bank details stored locally — admin must link manually in VALR portal."
          : `VALR rejected bank link for customer ${customer_id} (HTTP ${result.status}). ` +
            "Verify customer has 'Link Bank Account' permission on their VALR API key.";

        await logAlert(
          sb,
          "ef_link_bank_account",
          isSubaccountModel ? "warn" : "error",
          errMsg,
          { customer_id, valr_status: result.status, valr_response: result.data, model: creds.accountModel },
          ORG_ID,
          customer_id,
        );
        // For subaccount model: continue and store details locally.
        // For API model: fail loudly — the customer must sort their key permissions.
        if (!isSubaccountModel) {
          return json({ error: errMsg, valr_status: result.status, valr_response: result.data }, 422);
        }
      }
    }

    // ── Resolve exchange_account_id for this customer (via customer_strategies) ─
    const { data: cs, error: csErr } = await sb
      .from("customer_strategies")
      .select("exchange_account_id")
      .eq("customer_id", customer_id)
      .order("effective_from", { ascending: false })
      .limit(1)
      .single();

    if (csErr || !cs?.exchange_account_id) {
      return json({ error: "No exchange account found for customer" }, 404);
    }

    // ── Save bank details to exchange_accounts ───────────────────────────────
    const { error: updateErr } = await sb
      .from("exchange_accounts")
      .update({
        bank_account_number,
        bank_account_holder,
        bank_name,
        bank_branch_code:   bank_branch_code  ?? null,
        bank_account_type:  bank_account_type ?? null,
        bank_valr_id:       valrBankId,
        bank_linked_at:     new Date().toISOString(),
        bank_link_method:   valrLinked ? "api" : "manual_pending",
      })
      .eq("exchange_account_id", cs.exchange_account_id);

    if (updateErr) {
      return json({ error: `Failed to save bank details: ${updateErr.message}` }, 500);
    }

    return json({
      success:       true,
      valr_linked:   valrLinked,
      bank_valr_id:  valrBankId,
      message: valrLinked
        ? "Bank account linked with VALR and saved to exchange_accounts."
        : "Bank details saved locally. Admin action required to link manually in VALR portal (subaccount model).",
    });

  } catch (err) {
    console.error("ef_link_bank_account error:", err);
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
