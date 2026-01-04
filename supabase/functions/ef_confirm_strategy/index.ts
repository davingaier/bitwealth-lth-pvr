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

    // Check if portfolio already exists
    const { data: existingPortfolio } = await supabase
      .from("customer_portfolios")
      .select("portfolio_id")
      .eq("customer_id", customer_id)
      .eq("strategy_code", strategy_code)
      .single();

    let portfolio_id;

    if (existingPortfolio) {
      // Portfolio exists, just use it
      portfolio_id = existingPortfolio.portfolio_id;
      console.log(`Using existing portfolio ${portfolio_id} for customer ${customer_id}`);
    } else {
      // Create new portfolio entry
      const { data: newPortfolio, error: portfolioError } = await supabase
        .from("customer_portfolios")
        .insert({
          org_id: customer.org_id,
          customer_id: customer_id,
          strategy_code: strategy_code,
          status: "pending", // Will become 'active' when funds deposited (Milestone 5)
          label: `${customer.first_names} ${customer.last_name} - ${strategy.name}`,
        })
        .select("portfolio_id")
        .single();

      if (portfolioError) {
        console.error("Portfolio creation error:", portfolioError);
        return new Response(
          JSON.stringify({ error: `Failed to create portfolio: ${portfolioError.message}` }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      portfolio_id = newPortfolio.portfolio_id;
      console.log(`Created new portfolio ${portfolio_id} for customer ${customer_id}`);
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
        portfolio_id: portfolio_id,
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
