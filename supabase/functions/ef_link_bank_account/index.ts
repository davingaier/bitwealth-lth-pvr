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
function matchBankByAccountNumber(banks: any[], accountNumber: string): string | null {
  const normalized = (accountNumber || "").trim();
  for (const b of banks) {
    const candidate = String(b.accountNumber ?? b.accountnumber ?? b.account_number ?? "").trim();
    if (candidate && candidate === normalized) {
      return String(b.id ?? b.bankAccountId ?? b.bank_account_id ?? "") || null;
    }
  }
  return null;
}

// ── VALR: link bank account ───────────────────────────────────────────────────
async function valrLinkBankAccount(
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
      creds = await resolveCustomerCredentials(sbLthPvr, customer_id);
    } catch (e) {
      return json({ error: `Failed to resolve VALR credentials: ${e.message}` }, 500);
    }

    // ── Build VALR bank account payload ─────────────────────────────────────
    // VALR bank account link payload
    // Note: VALR endpoint for bank linking is uncertain — if it 404s,
    // bank details are stored locally and admin links manually.
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
    const debug: Record<string, unknown> = { account_model: creds.accountModel };
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
      debug.post_status = result.status;
      debug.post_response = result.data;

      if (result.ok) {
        const responseData = result.data as Record<string, unknown>;
        valrBankId = (responseData.id ?? responseData.bankAccountId ?? null) as string | null;
        valrLinked = true;
      } else {
        // VALR bank linking may fail for various reasons (wrong endpoint, permissions, etc.)
        // Store bank details locally regardless — admin can link manually in VALR portal.
        const errMsg = `VALR bank link failed for customer ${customer_id} (HTTP ${result.status}, model: ${creds.accountModel}). ` +
          "Bank details stored locally — admin must link manually in VALR portal if needed.";

        await logAlert(
          sb,
          "ef_link_bank_account",
          "warn",
          errMsg,
          { customer_id, valr_status: result.status, valr_response: result.data, model: creds.accountModel },
          ORG_ID,
          customer_id,
        );
        // Proceed to store bank details locally for all account models
      }

      // GET-fallback: even if POST succeeded we re-list to pick up the canonical id;
      // and if POST failed (e.g. account was added manually in the VALR portal),
      // this is the only way to recover bank_valr_id.
      if (!valrBankId) {
        try {
          const list = await valrListBankAccounts(creds.apiKey, creds.apiSecret, creds.subaccountId);
          debug.list_status = list.status;
          debug.list_path = list.path;
          debug.list_tried = list.tried;
          debug.list_count = list.data.length;
          debug.list_sample = list.data.slice(0, 5).map((b: any) => ({
            id: b.id ?? b.bankAccountId ?? null,
            accountNumber: b.accountNumber ?? b.accountnumber ?? null,
            bank: b.bank ?? b.bankName ?? null,
          }));
          if (list.ok) {
            const matched = matchBankByAccountNumber(list.data, bank_account_number);
            if (matched) {
              valrBankId = matched;
              valrLinked = true;
              await logAlert(
                sb, "ef_link_bank_account", "info",
                `Recovered bank_valr_id via GET /v1/fiat/ZAR/banks for customer ${customer_id}`,
                { customer_id, bank_valr_id: matched, bank_account_number },
                ORG_ID, customer_id,
              );
            } else {
              await logAlert(
                sb, "ef_link_bank_account", "warn",
                `GET /v1/fiat/ZAR/banks returned ${list.data.length} bank(s) but none matched account ${bank_account_number}`,
                { customer_id, bank_account_number, returned_count: list.data.length },
                ORG_ID, customer_id,
              );
            }
          } else {
            await logAlert(
              sb, "ef_link_bank_account", "warn",
              `GET /v1/fiat/ZAR/banks failed (HTTP ${list.status})`,
              { customer_id, valr_status: list.status },
              ORG_ID, customer_id,
            );
          }
        } catch (listErr) {
          await logAlert(
            sb, "ef_link_bank_account", "warn",
            `GET /v1/fiat/ZAR/banks threw: ${(listErr as Error).message}`,
            { customer_id },
            ORG_ID, customer_id,
          );
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
        bank_link_method:   valrLinked ? "api" : "manual",
      })
      .eq("exchange_account_id", cs.exchange_account_id);

    if (updateErr) {
      return json({ error: `Failed to save bank details: ${updateErr.message}` }, 500);
    }

    return json({
      success:       true,
      valr_linked:   valrLinked,
      bank_valr_id:  valrBankId,
      debug,
      message: valrLinked
        ? "Bank account linked with VALR and saved to exchange_accounts."
        : "Bank details saved locally. Admin action required to link manually in VALR portal (subaccount model).",
    });

  } catch (err) {
    console.error("ef_link_bank_account error:", err);
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
