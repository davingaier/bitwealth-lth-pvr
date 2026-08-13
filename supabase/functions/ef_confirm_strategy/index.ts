// Edge Function: ef_confirm_strategy
// Purpose: Milestone 2 - Confirm prospect strategy selection and start Finova KYC
// Flow: Creates strategy → Updates status prospect→kyc → creates kyc_finova 'invited'
//       row → sends kyc_finova_invite heads-up email. The admin then invites the
//       client into Finova/KYCDD; the portal registration email is sent later by
//       ef_finova_webhook once the client passes.
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

// CORS headers constant
const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

interface ConfirmStrategyRequest {
  customer_id: number;
  strategy_code: string;
  strategy_variation_id?: string;
  platform_fee_rate?: number;
  platform_fee_schedule?: string;
  performance_fee_rate?: number;
  performance_fee_schedule?: string;
  fee_plan?: string;
  management_fee_rate?: number;
  management_fee_schedule?: string;
  usdpc_enabled?: boolean;
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
    const { customer_id, strategy_code, strategy_variation_id, admin_email,
            platform_fee_rate, platform_fee_schedule,
            performance_fee_rate, performance_fee_schedule, usdpc_enabled,
            fee_plan, management_fee_rate, management_fee_schedule } = body;

    // Validate inputs
    if (!customer_id || !strategy_code) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: customer_id, strategy_code" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // ─── Fee-schedule cadence rule ─────────────────────────────────────────
    // Mirrors public.fee_schedule_rank() / customer_strategies_fee_cadence_check.
    // Platform fee schedule must be at least as frequent as performance.
    // Ranks: immediate=1 (most frequent), monthly=2, quarterly=3, annual=4 (least).
    // On the MANAGEMENT plan the platform fee is not charged, so its schedule is
    // not considered (neither validated nor cadence-checked against performance).
    const isManagementPlan = fee_plan === "management";
    const rank = (s?: string) =>
      s === "immediate" ? 1 : s === "monthly" ? 2 : s === "quarterly" ? 3 : s === "annual" ? 4 : null;
    const allowedPlat = ["immediate", "monthly", "quarterly", "annual"];
    const allowedPerf = ["monthly", "quarterly", "annual"];
    if (!isManagementPlan && platform_fee_schedule && !allowedPlat.includes(platform_fee_schedule)) {
      return new Response(
        JSON.stringify({
          error: `Invalid platform_fee_schedule '${platform_fee_schedule}'. Allowed: ${allowedPlat.join(", ")}.`,
        }),
        { status: 400, headers: corsHeaders }
      );
    }
    if (performance_fee_schedule && !allowedPerf.includes(performance_fee_schedule)) {
      return new Response(
        JSON.stringify({
          error: `Invalid performance_fee_schedule '${performance_fee_schedule}'. Allowed: ${allowedPerf.join(", ")}.`,
        }),
        { status: 400, headers: corsHeaders }
      );
    }
    if (!isManagementPlan && platform_fee_schedule && performance_fee_schedule) {
      const pr = rank(platform_fee_schedule)!;
      const fr = rank(performance_fee_schedule)!;
      if (pr > fr) {
        return new Response(
          JSON.stringify({
            error:
              `Invalid combination: platform_fee_schedule='${platform_fee_schedule}' ` +
              `is less frequent than performance_fee_schedule='${performance_fee_schedule}'. ` +
              `Platform fees must be collected at least as often as performance fees ` +
              `(immediate > monthly > annual).`,
          }),
          { status: 400, headers: corsHeaders }
        );
      }
    }

    // Get customer details
    const { data: customer, error: customerError } = await supabase
      .from("customer_details")
      .select("customer_id, first_names, last_name, email, registration_status, org_id, client_type, entity_name, display_name")
      .eq("customer_id", customer_id)
      .single();

    if (customerError || !customer) {
      return new Response(
        JSON.stringify({ error: "Customer not found" }),
        { status: 404, headers: corsHeaders }
      );
    }

    // Verify customer is prospect status
    if (customer.registration_status !== "prospect") {
      return new Response(
        JSON.stringify({
          error: `Customer status is '${customer.registration_status}'. Only 'prospect' status customers can have strategy confirmed.`,
        }),
        { status: 400, headers: corsHeaders }
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
        { status: 404, headers: corsHeaders }
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
      // Apply the USDPC yield toggle on re-confirm (other fee fields are managed
      // via the Customer Maintenance editor, but the onboarding wizard is the
      // canonical place to set USDPC at strategy setup time).
      if (usdpc_enabled != null) {
        await supabase
          .schema("public")
          .from("customer_strategies")
          .update({ usdpc_enabled })
          .eq("customer_strategy_id", customer_strategy_id);
      }
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
          { status: 500, headers: corsHeaders }
        );
      }

      // Create new customer_strategy entry (consolidated table)
      // Note: exchange_account_id will be NULL at this stage (added later at 'setup' status)
      const insertPayload: Record<string, unknown> = {
        org_id: customer.org_id,
        customer_id: customer_id,
        strategy_code: strategy_code,
        strategy_version_id: strategyVersion.strategy_version_id,
        status: "pending", // Will become 'active' when funds deposited
        label: `${customer.display_name || [customer.first_names, customer.last_name].filter(Boolean).join(" ")} - ${strategy.name}`,
      };
      if (strategy_variation_id) insertPayload.strategy_variation_id = strategy_variation_id;
      if (platform_fee_rate != null) insertPayload.platform_fee_rate = platform_fee_rate;
      if (platform_fee_schedule) insertPayload.platform_fee_schedule = platform_fee_schedule;
      if (performance_fee_rate != null) insertPayload.performance_fee_rate = performance_fee_rate;
      if (performance_fee_schedule) insertPayload.performance_fee_schedule = performance_fee_schedule;
      if (fee_plan === "platform" || fee_plan === "management") insertPayload.fee_plan = fee_plan;
      if (management_fee_rate != null) insertPayload.management_fee_rate = management_fee_rate;
      if (management_fee_schedule) insertPayload.management_fee_schedule = management_fee_schedule;
      if (usdpc_enabled != null) insertPayload.usdpc_enabled = usdpc_enabled;

      const { data: newStrategy, error: strategyError } = await supabase
        .schema("public")
        .from("customer_strategies")
        .insert(insertPayload)
        .select("customer_strategy_id")
        .single();

      if (strategyError) {
        console.error("Strategy creation error:", strategyError);
        return new Response(
          JSON.stringify({ error: `Failed to create strategy: ${strategyError.message}` }),
          { status: 500, headers: corsHeaders }
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
        { status: 500, headers: corsHeaders }
      );
    }

    // Finova KYC flow: record the invite intent and send a heads-up email. An
    // admin invites the client into Finova/KYCDD manually (their form does not
    // accept automated input); the portal registration email is sent later by
    // ef_finova_webhook once Finova reports the client has passed.
    const websiteUrl = Deno.env.get("WEBSITE_URL") || "https://bitwealth.co.za";
    // Base invite URL for the admin "Invite to KYC" panel (overridable via env).
    const finovaInviteUrl = Deno.env.get("FINOVA_INVITE_URL") ||
      "https://app.kycdd.co.za/client/-/insert/subscription_id/9c60cc9e-d6a1-4059-975f-e77d89e35809/workflow_id/9c60ccf1-f56b-4e78-8fa3-707aa7ed6bdb/status_type_id/939e7c63-2570-44f2-8a6e-327bdc4d67f0";

    // Upsert the Finova tracking row (one per customer).
    const { error: finovaErr } = await supabase
      .from("kyc_finova")
      .upsert(
        {
          customer_id: customer_id,
          org_id: customer.org_id,
          finova_status: "invited",
          invited_at: new Date().toISOString(),
        },
        { onConflict: "customer_id" }
      );
    if (finovaErr) console.error("kyc_finova upsert failed:", finovaErr.message);

    // Send the KYC-invite heads-up email.
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
          template_key: "kyc_finova_invite",
          to_email: customer.email,
          data: { first_name: customer.first_names || customer.entity_name || customer.display_name, website_url: "https://bitwealth.co.za" },
        }),
      });

      if (emailResponse.ok) {
        emailSent = true;
        console.log(`KYC invite email sent to ${customer.email}`);
      } else {
        const errorData = await emailResponse.json();
        emailError = errorData.error || "Unknown email error";
        console.error(`Failed to send KYC invite email: ${emailError}`);
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
        customer_name: `${customer.first_names} ${customer.last_name}`,
        finova_invite_url: finovaInviteUrl,
        email_sent: emailSent,
        email_error: emailError,
      }),
      {
        status: 200,
        headers: corsHeaders,
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
        headers: corsHeaders,
      }
    );
  }
});
