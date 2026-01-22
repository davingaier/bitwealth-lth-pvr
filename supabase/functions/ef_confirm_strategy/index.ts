// Edge Function: ef_confirm_strategy
// Purpose: Milestone 2 - Confirm prospect strategy selection and trigger registration email
// Flow: Creates portfolio → Updates status prospect→kyc → Sends kyc_portal_registration email
// Deployed with: --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const orgId = Deno.env.get("ORG_ID");

if (!supabaseUrl || !supabaseKey || !orgId) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface ConfirmStrategyRequest {
  customer_id: number;
  strategy_code: string;
  admin_email?: string;
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
    const body: ConfirmStrategyRequest = await req.json();
    const { customer_id, strategy_code, admin_email } = body;

    // Validate inputs
    if (!customer_id || !strategy_code) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: customer_id, strategy_code" }),
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

    // Verify customer is prospect status
    if (customer.registration_status !== "prospect") {
      return new Response(
        JSON.stringify({
          error: `Customer status is '${customer.registration_status}'. Only 'prospect' status customers can have strategy confirmed.`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get strategy details
    const { data: strategy, error: strategyError } = await supabase
      .from("strategies")
      .select("strategy_code, name, schema_name")
      .eq("strategy_code", strategy_code)
      .single();

    if (strategyError || !strategy) {
      return new Response(
        JSON.stringify({ error: `Strategy '${strategy_code}' not found` }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Check if customer strategy already exists (consolidated table)
    const { data: existingStrategy } = await supabase
      .schema("public")
      .from("customer_strategies")
      .select("customer_strategy_id")
      .eq("customer_id", customer_id)
      .eq("strategy_code", strategy_code)
      .single();

    let customer_strategy_id;

    if (existingStrategy) {
      // Strategy exists, just use it
      customer_strategy_id = existingStrategy.customer_strategy_id;
      console.log(`Using existing customer_strategy ${customer_strategy_id} for customer ${customer_id}`);
    } else {
      // Get strategy version ID
      const { data: strategyVersion, error: versionError } = await supabase
        .schema("lth_pvr")
        .from("strategy_versions")
        .select("strategy_version_id")
        .eq("org_id", customer.org_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (versionError || !strategyVersion) {
        console.error("Error fetching strategy version:", versionError);
        return new Response(
          JSON.stringify({ error: "Strategy version not found" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      // Create new customer_strategy entry (consolidated table)
      const { data: newStrategy, error: strategyError } = await supabase
        .schema("public")
        .from("customer_strategies")
        .insert({
          org_id: customer.org_id,
          customer_id: customer_id,
          strategy_code: strategy_code,
          strategy_version_id: strategyVersion.strategy_version_id,
          status: "pending", // Will become 'active' when funds deposited
          label: `${customer.first_names} ${customer.last_name} - ${strategy.name}`,
        })
        .select("customer_strategy_id")
        .single();

      if (strategyError) {
        console.error("Strategy creation error:", strategyError);
        return new Response(
          JSON.stringify({ error: `Failed to create strategy: ${strategyError.message}` }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      customer_strategy_id = newStrategy.customer_strategy_id;
      console.log(`Created new customer_strategy ${customer_strategy_id} for customer ${customer_id}`);
    }

    // Update customer status to 'kyc' (Milestone 3)
    const { error: updateError } = await supabase
      .from("customer_details")
      .update({
        registration_status: "kyc",
      })
      .eq("customer_id", customer_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: `Failed to update customer: ${updateError.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Generate registration URL
    // IMPORTANT: Set WEBSITE_URL environment variable in production to your actual domain
    // For local testing, use file:// protocol or local server (e.g., http://localhost:8081)
    const websiteUrl = Deno.env.get("WEBSITE_URL") || "http://localhost:8081";
    const registrationUrl = `${websiteUrl}/register.html?customer_id=${customer_id}&email=${encodeURIComponent(customer.email)}`;

    // Send kyc_portal_registration email
    const emailData = {
      first_name: customer.first_names,
      strategy_name: strategy.name,
      registration_url: registrationUrl,
      website_url: "https://bitwealth.co.za",
    };

    let emailSent = false;
    let emailError = null;

    try {
      const emailResponse = await fetch(`${supabaseUrl}/functions/v1/ef_send_email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          template_key: "kyc_portal_registration",
          to_email: customer.email,
          data: emailData,
        }),
      });

      if (emailResponse.ok) {
        emailSent = true;
        console.log(`Registration email sent to ${customer.email}`);
      } else {
        const errorData = await emailResponse.json();
        emailError = errorData.error || "Unknown email error";
        console.error(`Failed to send registration email: ${emailError}`);
      }
    } catch (error) {
      emailError = error instanceof Error ? error.message : String(error);
      console.error(`Email sending error: ${emailError}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Strategy confirmed for ${customer.first_names} ${customer.last_name}`,
        customer_id: customer_id,
        customer_strategy_id: customer_strategy_id,
        strategy_code: strategy_code,
        strategy_name: strategy.name,
        email: customer.email,
        registration_url: registrationUrl,
        email_sent: emailSent,
        email_error: emailError,
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
    console.error("Error in ef_confirm_strategy:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      }),
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
