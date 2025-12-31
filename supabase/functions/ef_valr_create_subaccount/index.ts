// Edge Function: ef_valr_create_subaccount
// Purpose: Milestone 4 - Auto-create VALR subaccount when customer reaches 'setup' status
// Flow: Creates VALR subaccount → Stores subaccount_id in exchange_accounts
// Deployed with: --no-verify-jwt (internal function, called from admin portal or trigger)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const orgId = Deno.env.get("ORG_ID");
const valrApiKey = Deno.env.get("VALR_API_KEY");
const valrApiSecret = Deno.env.get("VALR_API_SECRET");

if (!supabaseUrl || !supabaseKey || !orgId || !valrApiKey || !valrApiSecret) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const body: CreateSubaccountRequest = await req.json();
    const { customer_id, force_recreate = false } = body;

    // Validate inputs
    if (!customer_id) {
      return new Response(
        JSON.stringify({ error: "Missing required field: customer_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
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
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify customer status is 'setup'
    if (customer.registration_status !== "setup" && !force_recreate) {
      return new Response(
        JSON.stringify({ 
          error: `Invalid customer status: ${customer.registration_status}. VALR subaccount creation only allowed for status='setup'` 
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get customer's portfolio to determine strategy
    const { data: portfolio, error: portfolioError } = await supabase
      .from("customer_portfolios")
      .select("portfolio_id, strategy_code")
      .eq("customer_id", customer_id)
      .single();

    if (portfolioError || !portfolio) {
      return new Response(
        JSON.stringify({ error: "Customer portfolio not found. Cannot determine strategy." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Check if subaccount already exists
    const { data: existingAccount, error: checkError } = await supabase
      .from("exchange_accounts")
      .select("exchange_account_id, subaccount_id")
      .eq("customer_id", customer_id)
      .eq("exchange_name", "VALR")
      .maybeSingle();

    if (checkError) {
      console.error("Error checking existing account:", checkError);
    }

    if (existingAccount && existingAccount.subaccount_id && !force_recreate) {
      return new Response(
        JSON.stringify({ 
          error: "VALR subaccount already exists for this customer",
          subaccount_id: existingAccount.subaccount_id,
          exchange_account_id: existingAccount.exchange_account_id
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create VALR subaccount label
    const label = `${customer.first_names} ${customer.last_name} - ${portfolio.strategy_code}`;

    // Call VALR API to create subaccount
    const timestamp = Date.now().toString();
    const method = "POST";
    const path = "/v1/account/subaccounts";
    const requestBody = JSON.stringify({ label });
    const signature = await signVALR(timestamp, method, path, requestBody);

    const valrResponse = await fetch(`https://api.valr.com${path}`, {
      method: "POST",
      headers: {
        "X-VALR-API-KEY": valrApiKey,
        "X-VALR-SIGNATURE": signature,
        "X-VALR-TIMESTAMP": timestamp,
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

    if (!valrResponse.ok) {
      const errorText = await valrResponse.text();
      console.error("VALR API error:", valrResponse.status, errorText);
      return new Response(
        JSON.stringify({ 
          error: `VALR API error: ${valrResponse.status}`,
          details: errorText
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const valrData = await valrResponse.json();
    const subaccountId = valrData.id || valrData.subaccountId;

    if (!subaccountId) {
      console.error("No subaccount ID in VALR response:", valrData);
      return new Response(
        JSON.stringify({ error: "VALR did not return subaccount ID", valr_response: valrData }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
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
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      exchangeAccountId = updateData.exchange_account_id;
    } else {
      // Create new record
      const { data: insertData, error: insertError } = await supabase
        .from("exchange_accounts")
        .insert({
          org_id: customer.org_id,
          customer_id: customer_id,
          exchange_name: "VALR",
          subaccount_id: subaccountId,
          api_key: null, // Not needed - uses primary account credentials
          api_secret: null,
          active: true
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error inserting exchange account:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to create exchange account record: " + insertError.message }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      exchangeAccountId = insertData.exchange_account_id;
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
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Error in ef_valr_create_subaccount:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
