// valrCredentials.ts — Centralised VALR credential resolver for all edge functions.
//
// Every edge function that calls VALR on behalf of a customer imports this module.
// Subaccount model: returns BitWealth master key + customer's subaccount ID from env.
// API model: decrypts customer's own API key/secret from Supabase Vault via
//            the SECURITY DEFINER function lth_pvr.get_customer_valr_credentials().
//
// IMPORTANT: Only callable from service-role edge functions — never exposed to JWT callers.

import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface ValrCredentials {
  apiKey: string;
  apiSecret: string;
  subaccountId: string | null; // null for API model customers (no X-VALR-SUB-ACCOUNT-ID header)
  accountModel: "subaccount" | "api";
}

/**
 * Resolve VALR credentials for a customer.
 *
 * For subaccount model: returns master key from env + the customer's subaccount ID.
 * For API model: decrypts the customer's own key/secret from Vault via a SECURITY DEFINER RPC.
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

  if (row.account_model === "api") {
    if (!row.api_key || !row.api_secret) {
      throw new Error(
        `resolveCustomerCredentials: API key/secret missing in Vault for customer ${customerId}`,
      );
    }
    return {
      apiKey: row.api_key,
      apiSecret: row.api_secret,
      subaccountId: null,
      accountModel: "api",
    };
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
