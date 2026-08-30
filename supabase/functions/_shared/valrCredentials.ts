// valrCredentials.ts — Centralised VALR credential resolver for all edge functions.
//
// Every edge function that calls VALR on behalf of a customer imports this module.
// Subaccount model:     BitWealth master key from env + customer's subaccount ID header.
// API model:            customer's own key/secret, decrypted from Supabase Vault.
// Finova omnibus model: subaccount-scoped key issued by Finova, decrypted from Vault.
//                       No subaccount header — the key is already scoped to it.
//
// Vault decryption happens in the SECURITY DEFINER function
// lth_pvr.get_customer_valr_credentials().
//
// IMPORTANT: Only callable from service-role edge functions — never exposed to JWT callers.

import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type ValrAccountModel = "subaccount" | "api" | "finova_omnibus";

/** Models whose credentials are per-customer keys held in Vault, sent without a subaccount header. */
const VAULT_KEY_MODELS: ReadonlySet<string> = new Set(["api", "finova_omnibus"]);

export interface ValrCredentials {
  apiKey: string;
  apiSecret: string;
  subaccountId: string | null; // null unless the master key needs X-VALR-SUB-ACCOUNT-ID
  accountModel: ValrAccountModel;
}

/**
 * Resolve VALR credentials for a customer.
 *
 * Unknown models throw rather than falling back, so a mis-set account_model can
 * never route a customer's trades through the wrong account's credentials.
 *
 * @param sb   Supabase client initialised with service role key
 * @param customerId  customer_details.customer_id
 */
export async function resolveCustomerCredentials(
  sb: SupabaseClient,
  customerId: number,
): Promise<ValrCredentials> {
  const { data, error } = await sb.rpc("get_customer_valr_credentials", {
    p_customer_id: customerId,
  });

  if (error) {
    throw new Error(
      `resolveCustomerCredentials: RPC failed for customer ${customerId}: ${error.message}`,
    );
  }

  if (!data || data.length === 0) {
    throw new Error(
      `resolveCustomerCredentials: no exchange account found for customer ${customerId}`,
    );
  }

  const row = data[0] as {
    api_key: string | null;
    api_secret: string | null;
    subaccount_id: string | null;
    account_model: string;
  };

  if (VAULT_KEY_MODELS.has(row.account_model)) {
    if (!row.api_key || !row.api_secret) {
      throw new Error(
        `resolveCustomerCredentials: API key/secret missing in Vault for customer ${customerId} (model=${row.account_model})`,
      );
    }
    return {
      apiKey: row.api_key,
      apiSecret: row.api_secret,
      subaccountId: null,
      accountModel: row.account_model as ValrAccountModel,
    };
  }

  if (row.account_model !== "subaccount") {
    throw new Error(
      `resolveCustomerCredentials: unknown account_model '${row.account_model}' for customer ${customerId} — refusing to guess credentials`,
    );
  }

  // Subaccount model — credentials come from environment (master key)
  const apiKey = Deno.env.get("VALR_API_KEY");
  const apiSecret = Deno.env.get("VALR_API_SECRET");

  if (!apiKey || !apiSecret) {
    throw new Error(
      "resolveCustomerCredentials: VALR_API_KEY / VALR_API_SECRET env vars not configured",
    );
  }

  return {
    apiKey,
    apiSecret,
    subaccountId: row.subaccount_id,
    accountModel: "subaccount",
  };
}

/**
 * Credentials to hand to valrClient for a customer, or null to use the env master key.
 *
 * Always prefer this over testing `accountModel === "api"` directly: returning null
 * for a customer whose key lives in Vault would silently route their trade through
 * BitWealth's master account.
 */
export function toRequestCredentials(
  creds: ValrCredentials,
): { apiKey: string; apiSecret: string } | null {
  return VAULT_KEY_MODELS.has(creds.accountModel)
    ? { apiKey: creds.apiKey, apiSecret: creds.apiSecret }
    : null;
}

/** True when the customer's assets sit in a partner-operated (Finova) omnibus subaccount. */
export function isPartnerCustody(accountModel: string | null | undefined): boolean {
  return accountModel === "finova_omnibus";
}
