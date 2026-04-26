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
const sbLthPvr = createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: "lth_pvr" } });

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

// ── VALR: list bank accounts (used as fallback to recover canonical bank UUID) ──
async function valrListBankAccounts(
  apiKey: string,
  apiSecret: string,
  subaccountId: string | null,
): Promise<{ ok: boolean; status: number; data: any[]; path: string; tried: Array<{path:string; status:number}> }> {
  // VALR's actual list endpoint is undocumented in the public Postman docs; try the
  // most likely paths in priority order and return the first non-404 hit.
  const candidatePaths = [
    "/v1/wallet/fiat/ZAR/accounts",
    "/v1/wallet/fiat/ZAR/banks",
    "/v1/fiat/ZAR/accounts",
    "/v1/fiat/ZAR/banks",
  ];
  const tried: Array<{path:string; status:number}> = [];
  for (const path of candidatePaths) {
    const timestamp = Date.now().toString();
    const signature = await signVALR(timestamp, "GET", path, "", apiSecret, subaccountId ?? "");
    const headers: Record<string, string> = {
      "X-VALR-API-KEY":   apiKey,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
    };
    if (subaccountId) headers["X-VALR-SUB-ACCOUNT-ID"] = subaccountId;

    const res = await fetch(`${VALR_BASE}${path}`, { method: "GET", headers });
    tried.push({ path, status: res.status });
    if (res.status === 404) continue;
    let data: any = null;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = []; }
    return { ok: res.ok, status: res.status, data: Array.isArray(data) ? data : [], path, tried };
  }
  return { ok: false, status: 404, data: [], path: candidatePaths[0], tried };
}

// Find a bank in VALR's list whose accountNumber matches the supplied one.
// (Kept for reference — current flow uses summarised list directly.)
function _matchBankByAccountNumber(banks: any[], accountNumber: string): string | null {
  const normalized = (accountNumber || "").trim();
  for (const b of banks) {
    const candidate = String(b.accountNumber ?? b.accountnumber ?? b.account_number ?? "").trim();
    if (candidate && candidate === normalized) {
      return String(b.id ?? b.bankAccountId ?? b.bank_account_id ?? "") || null;
    }
  }
  return null;
}

// ── VALR: link bank account (POST) — RETIRED ────────────────────────────────
// VALR's POST /v1/fiat/ZAR/banks endpoint is unreliable for our master-key +
// subaccount-header model; the customer must link the bank on the VALR portal.
// Helper kept for reference only.
async function _valrLinkBankAccount(
  apiKey: string,
  apiSecret: string,
  subaccountId: string | null,
  bankPayload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const path        = "/v1/fiat/ZAR/banks";
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

// ── Helpers ────────────────────────────────────────────────────────────────────
function pickField(b: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = b?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

function summariseBank(b: any) {
  return {
    id:             pickField(b, ["id", "bankAccountId", "bank_account_id"]),
    bank_name:      pickField(b, ["bank", "bankName", "bank_name"]),
    account_holder: pickField(b, ["accountHolder", "accountholder", "account_holder"]),
    account_number: pickField(b, ["accountNumber", "accountnumber", "account_number"]),
    account_type:   pickField(b, ["accountType", "accounttype", "account_type"]),
    branch_code:    pickField(b, ["branchCode", "branchcode", "branch_code"]),
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
//
// Request body (all VALR-pull mode):
//   { customer_id: number, selected_bank_id?: string }
//
// `selected_bank_id` is only used after the caller has previously received a
// `multiple_banks: true` response and the admin has picked one. When omitted:
//   - 0 banks linked on VALR → returns { no_banks: true, ... }
//   - 1 bank linked          → auto-syncs that one
//   - >1 banks linked        → returns { multiple_banks: true, banks: [...] }
//
// Bank fields (bank_name / holder / account_number / account_type / branch_code)
// are no longer accepted from the caller — they are pulled from VALR.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const {
      customer_id,
      selected_bank_id,
    }: {
      customer_id: number;
      selected_bank_id?: string;
    } = body ?? {};

    if (!customer_id) {
      return json({ error: "Missing required field: customer_id" }, 400);
    }

    // ── Load customer ────────────────────────────────────────────────────────
    const { data: customer, error: custErr } = await sb
      .from("customer_details")
      .select("customer_id, account_model, org_id")
      .eq("customer_id", customer_id)
      .single();

    if (custErr || !customer) return json({ error: "Customer not found" }, 404);
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

    // ── Precondition gate: VALR must be provisioned before linking a bank ────
    // Subaccount Model: requires exchange_accounts.subaccount_id
    // API Model: requires exchange_accounts.api_key_vault_id (capture marker)
    const { data: ea, error: eaErr } = await sb
      .from("exchange_accounts")
      .select("exchange_account_id, subaccount_id, api_key_vault_id, api_key_verified_at")
      .eq("exchange_account_id", cs.exchange_account_id)
      .single();
    if (eaErr || !ea) return json({ error: "Exchange account record not found" }, 404);

    if (customer.account_model === "subaccount") {
      if (!ea.subaccount_id) {
        return json({
          error: "VALR subaccount has not been set up for this customer yet. Bank linking is blocked until the subaccount is provisioned.",
          gate: "subaccount_missing",
        }, 400);
      }
    } else if (customer.account_model === "api") {
      if (!ea.api_key_vault_id) {
        return json({
          error: "VALR API keys have not been captured for this customer yet. Bank linking is blocked until API keys are stored.",
          gate: "api_keys_missing",
        }, 400);
      }
    } else {
      return json({ error: `Unknown account_model '${customer.account_model}' — cannot determine bank-link preconditions.` }, 400);
    }
    // ── Resolve VALR credentials (model-aware) ───────────────────────────────
    let creds: Awaited<ReturnType<typeof resolveCustomerCredentials>>;
    try {
      creds = await resolveCustomerCredentials(sbLthPvr, customer_id);
    } catch (e) {
      return json({ error: `Failed to resolve VALR credentials: ${e.message}` }, 500);
    }

    // ── Pull VALR bank list (we never POST — VALR's POST endpoint is unreliable
    //    and the customer is responsible for linking the bank on the VALR portal) ─
    const debug: Record<string, unknown> = { account_model: creds.accountModel };
    const testMode = Deno.env.get("VALR_TEST_MODE") === "true";

    let valrBanks: any[] = [];
    if (testMode) {
      valrBanks = [{
        id: "test_bank_id_" + Date.now(),
        bank: "Test Bank",
        accountHolder: "Test Holder",
        accountNumber: "1234567890",
      }];
      debug.list_status = 200;
      debug.list_count  = valrBanks.length;
    } else {
      try {
        const list = await valrListBankAccounts(creds.apiKey, creds.apiSecret, creds.subaccountId);
        debug.list_status = list.status;
        debug.list_path   = list.path;
        debug.list_tried  = list.tried;
        debug.list_count  = list.data.length;
        if (!list.ok) {
          await logAlert(
            sb, "ef_link_bank_account", "warn",
            `GET VALR bank list failed (HTTP ${list.status})`,
            { customer_id, valr_status: list.status, tried: list.tried },
            ORG_ID, customer_id,
          );
          return json({
            error: `VALR bank list lookup failed (HTTP ${list.status}). Please retry shortly.`,
            debug,
          }, 502);
        }
        valrBanks = list.data;
      } catch (listErr) {
        await logAlert(
          sb, "ef_link_bank_account", "error",
          `GET VALR bank list threw: ${(listErr as Error).message}`,
          { customer_id }, ORG_ID, customer_id,
        );
        return json({ error: `VALR bank list lookup threw: ${(listErr as Error).message}`, debug }, 502);
      }
    }

    // ── 0 banks: tell caller the customer must link first on VALR ──────────
    if (valrBanks.length === 0) {
      return json({
        success: false,
        no_banks: true,
        account_model: creds.accountModel,
        message: "No bank accounts are linked on this customer's VALR account yet. " +
                 "Please ask the customer to link their bank inside VALR and then click Sync again.",
        debug,
      });
    }

    // ── >1 banks without a selection: return picker payload ───────────────
    const summarised = valrBanks.map(summariseBank).filter(b => b.id);
    if (summarised.length > 1 && !selected_bank_id) {
      return json({
        success: false,
        multiple_banks: true,
        account_model: creds.accountModel,
        banks: summarised,
        message: "Multiple bank accounts are linked on VALR. Please choose which one to use.",
        debug,
      });
    }

    // ── Resolve the chosen bank ───────────────────────────────────────────
    let chosen = summarised[0];
    if (selected_bank_id) {
      const found = summarised.find(b => b.id === selected_bank_id);
      if (!found) {
        return json({
          error: `selected_bank_id '${selected_bank_id}' was not found in the customer's VALR bank list.`,
          banks: summarised,
          debug,
        }, 400);
      }
      chosen = found;
    }

    const valrBankId = chosen.id;
    const valrLinked = !!valrBankId;

    // ── Upsert bank_accounts row (single source of truth) ──────────────
    const { data: existingBank } = await sb
      .from("bank_accounts")
      .select("bank_account_id, bank_account_type, bank_branch_code")
      .eq("customer_id", customer_id)
      .eq("is_primary", true)
      .maybeSingle();

    // Don't overwrite admin-set account_type / branch_code if VALR doesn't return them.
    const bankPatch: Record<string, unknown> = {
      bank_name:           chosen.bank_name,
      bank_account_holder: chosen.account_holder,
      bank_account_number: chosen.account_number,
      status: "active",
    };
    if (chosen.branch_code)  bankPatch.bank_branch_code  = chosen.branch_code;
    if (chosen.account_type) bankPatch.bank_account_type = chosen.account_type;

    let bankAccountId: string;
    if (existingBank?.bank_account_id) {
      const { error: updBankErr } = await sb
        .from("bank_accounts")
        .update(bankPatch)
        .eq("bank_account_id", existingBank.bank_account_id);
      if (updBankErr) return json({ error: `Failed to update bank_accounts: ${updBankErr.message}` }, 500);
      bankAccountId = existingBank.bank_account_id;
    } else {
      const { data: ins, error: insErr } = await sb
        .from("bank_accounts")
        .insert({
          ...bankPatch,
          customer_id,
          org_id: customer.org_id,
          is_primary: true,
        })
        .select("bank_account_id")
        .single();
      if (insErr || !ins) return json({ error: `Failed to insert bank_accounts: ${insErr?.message}` }, 500);
      bankAccountId = ins.bank_account_id;
    }

    // ── Save VALR-side fields + FK to bank_accounts on exchange_accounts ───
    const { error: updateErr } = await sb
      .from("exchange_accounts")
      .update({
        bank_account_id:  bankAccountId,
        bank_valr_id:     valrBankId,
        bank_linked_at:   new Date().toISOString(),
        bank_link_method: "api",
      })
      .eq("exchange_account_id", cs.exchange_account_id);

    if (updateErr) {
      return json({ error: `Failed to save bank link to exchange_accounts: ${updateErr.message}` }, 500);
    }

    return json({
      success:          true,
      valr_linked:      valrLinked,
      account_model:    creds.accountModel,
      bank_account_id:  bankAccountId,
      bank_valr_id:     valrBankId,
      bank:             chosen,
      bank_link_method: "api",
      debug,
      message: `Bank account synced from VALR. ${chosen.bank_name ?? ''} ${chosen.account_number ? '****' + chosen.account_number.slice(-4) : ''}`.trim(),
    });

  } catch (err) {
    console.error("ef_link_bank_account error:", err);
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
