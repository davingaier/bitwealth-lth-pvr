// Edge Function: ef_valr_create_subaccount
// Purpose: Milestone 4 - Auto-create VALR subaccount when customer reaches 'setup' status
// Flow: Creates VALR subaccount → Stores subaccount_id in exchange_accounts
// Deployed with: --no-verify-jwt (internal function, called from admin portal or trigger)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { logAlert } from "../_shared/alerting.ts";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const orgId = Deno.env.get("ORG_ID");
const valrApiKey = Deno.env.get("VALR_API_KEY");
const valrApiSecret = Deno.env.get("VALR_API_SECRET");
const testMode = Deno.env.get("VALR_TEST_MODE") === "true"; // For testing without real VALR API

if (!supabaseUrl || !supabaseKey || !orgId) {
  throw new Error("Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID");
}

if (!testMode && (!valrApiKey || !valrApiSecret)) {
  throw new Error("Missing VALR credentials. Set VALR_TEST_MODE=true to test without real API calls.");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// CORS headers constant
const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateSubaccountRequest {
  customer_id: number;
  force_recreate?: boolean; // Optional: recreate if already exists
}

// VALR API: Sign request with HMAC SHA-512
async function signVALR(timestamp: string, method: string, path: string, body: string) {
  const message = timestamp + method.toUpperCase() + path + body;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(valrApiSecret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  // CORS headers
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: CreateSubaccountRequest = await req.json();
    const { customer_id, force_recreate = false } = body;

    // Validate inputs
    if (!customer_id) {
      return new Response(
        JSON.stringify({ error: "Missing required field: customer_id" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Get customer details
    const { data: customer, error: customerError } = await supabase
      .from("customer_details")
      .select("customer_id, first_names, last_name, email, registration_status, org_id")
      .eq("customer_id", customer_id)
      .single();

    if (customerError || !customer) {
      return new Response(
        JSON.stringify({ error: "Customer not found" }),
        { status: 404, headers: corsHeaders }
      );
    }

    // Verify customer status is 'setup'
    if (customer.registration_status !== "setup" && !force_recreate) {
      return new Response(
        JSON.stringify({ 
          error: `Invalid customer status: ${customer.registration_status}. VALR subaccount creation only allowed for status='setup'` 
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Get customer's strategy to determine strategy_code
    const { data: strategy, error: strategyError } = await supabase
      .from("customer_strategies")
      .select("customer_strategy_id, portfolio_id, strategy_code, exchange_account_id")
      .eq("customer_id", customer_id)
      .single();

    if (strategyError || !strategy) {
      console.error("Strategy query error:", strategyError);
      return new Response(
        JSON.stringify({ 
          error: "Customer portfolio not found. Cannot determine strategy.",
          details: strategyError?.message 
        }),
        { status: 404, headers: corsHeaders }
      );
    }

    // Check if customer already has an exchange account linked
    let existingAccount = null;
    if (strategy.exchange_account_id) {
      const { data: acct, error: acctError } = await supabase
        .from("exchange_accounts")
        .select("exchange_account_id, subaccount_id, exchange")
        .eq("exchange_account_id", strategy.exchange_account_id)
        .maybeSingle();
      
      if (!acctError && acct) {
        existingAccount = acct;
      }
    }

    if (existingAccount && existingAccount.subaccount_id && !force_recreate) {
      return new Response(
        JSON.stringify({ 
          error: "VALR subaccount already exists for this customer",
          subaccount_id: existingAccount.subaccount_id,
          exchange_account_id: existingAccount.exchange_account_id
        }),
        { status: 409, headers: corsHeaders }
      );
    }

    // Create VALR subaccount label
    // Note: VALR only allows alphanumeric and spaces (no hyphens, underscores, or special chars)
    const strategyName = strategy.strategy_code.replace(/_/g, ' '); // Replace underscores with spaces
    const label = `${customer.first_names} ${customer.last_name} ${strategyName}`;

    let subaccountId: string;

    if (testMode) {
      // TEST MODE: Generate mock subaccount ID (VALR has no sandbox)
      console.log("⚠️ TEST MODE: Generating mock VALR subaccount ID");
      subaccountId = `test-valr-${crypto.randomUUID()}`;
      console.log(`Mock subaccount created: ${subaccountId} (${label})`);
    } else {
      // PRODUCTION MODE: Call real VALR API
      const timestamp = Date.now().toString();
      const method = "POST";
      const path = "/v1/account/subaccount"; // Note: singular for POST, plural for GET
      const requestBody = JSON.stringify({ label });
      const signature = await signVALR(timestamp, method, path, requestBody);

      // Log request for debugging
      console.log("VALR API Request:", {
        url: `https://api.valr.com${path}`,
        method,
        label,
        timestamp,
        bodyLength: requestBody.length
      });

      const valrResponse = await fetch(`https://api.valr.com${path}`, {
        method: "POST",
        headers: {
          "X-VALR-API-KEY": valrApiKey!,
          "X-VALR-SIGNATURE": signature,
          "X-VALR-TIMESTAMP": timestamp,
          "Content-Type": "application/json",
        },
        body: requestBody,
      });

      if (!valrResponse.ok) {
        const errorText = await valrResponse.text();
        console.error("VALR API Error Response:", {
          status: valrResponse.status,
          statusText: valrResponse.statusText,
          body: errorText,
          requestLabel: label,
          requestPath: path
        });
        
        return new Response(
          JSON.stringify({ 
            error: `VALR API error: ${valrResponse.status} ${valrResponse.statusText}`,
            details: errorText,
            requestLabel: label
          }),
          { status: 500, headers: corsHeaders }
        );
      }

      const valrData = await valrResponse.json();
      subaccountId = valrData.id || valrData.subaccountId;

      if (!subaccountId) {
        console.error("No subaccount ID in VALR response:", valrData);
        return new Response(
          JSON.stringify({ error: "VALR did not return subaccount ID", valr_response: valrData }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Store or update in exchange_accounts
    let exchangeAccountId;
    
    if (existingAccount) {
      // Update existing record
      const { data: updateData, error: updateError } = await supabase
        .from("exchange_accounts")
        .update({
          subaccount_id: subaccountId,
          updated_at: new Date().toISOString()
        })
        .eq("exchange_account_id", existingAccount.exchange_account_id)
        .select()
        .single();

      if (updateError) {
        console.error("Error updating exchange account:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to update exchange account: " + updateError.message }),
          { status: 500, headers: corsHeaders }
        );
      }

      exchangeAccountId = updateData.exchange_account_id;
    } else {
      // Create new exchange account record
      const { data: insertData, error: insertError } = await supabase
        .from("exchange_accounts")
        .insert({
          org_id: customer.org_id,
          exchange: "VALR",
          label: label,
          subaccount_id: subaccountId,
          status: "active",
          is_omnibus: false  // Customer-specific subaccount, not omnibus
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error inserting exchange account:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to create exchange account record: " + insertError.message }),
          { status: 500, headers: corsHeaders }
        );
      }

      exchangeAccountId = insertData.exchange_account_id;
      
      // Link the new exchange account to the customer's strategy (consolidated table)
      const { error: linkError } = await supabase
        .from("customer_strategies")
        .update({ exchange_account_id: exchangeAccountId })
        .eq("customer_strategy_id", strategy.customer_strategy_id);
      
      if (linkError) {
        console.error("Error linking exchange account to customer strategy:", linkError);
        // Don't fail the whole operation, but log the error
        await logAlert(
          supabase,
          "ef_valr_create_subaccount",
          "warn",
          `Failed to link exchange account to customer strategy: ${linkError.message}`,
          { customer_id, customer_strategy_id: strategy.customer_strategy_id, exchange_account_id: exchangeAccountId },
          customer.org_id,
          customer_id
        );
      }

      // Link the new exchange account to customer_strategies (new consolidated table)
      const { error: linkStrategyError } = await supabase
        .schema("public")
        .from("customer_strategies")
        .update({ 
          exchange_account_id: exchangeAccountId,
          effective_from: new Date().toISOString().split('T')[0] // Set effective_from to today if NULL
        })
        .eq("customer_id", customer_id);
      
      if (linkStrategyError) {
        console.error("Error linking exchange account to customer_strategies:", linkStrategyError);
        await logAlert(
          supabase,
          "ef_valr_create_subaccount",
          "warn",
          `Failed to link exchange account to customer_strategies: ${linkStrategyError.message}`,
          { customer_id, exchange_account_id: exchangeAccountId },
          customer.org_id,
          customer_id
        );
      }
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: `VALR subaccount created for ${customer.first_names} ${customer.last_name}`,
        customer_id: customer.customer_id,
        subaccount_id: subaccountId,
        exchange_account_id: exchangeAccountId,
        label: label,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error("Error in ef_valr_create_subaccount:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: corsHeaders }
    );
  }
});
