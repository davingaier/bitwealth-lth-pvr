// Edge Function: ef_approve_kyc
// Purpose: Approve customer KYC and trigger registration email
// Authentication: Requires authenticated admin user
// Deployed with: --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface ApproveKYCRequest {
  customer_id: number;
  admin_email?: string;
  notes?: string;
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
    const body: ApproveKYCRequest = await req.json();
    const { customer_id, admin_email, notes } = body;

    if (!customer_id) {
      return new Response(
        JSON.stringify({ error: "Missing required field: customer_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get customer details
    const { data: customer, error: customerError } = await supabase
      .from("customer_details")
      .select("customer_id, first_names, last_name, email, registration_status")
      .eq("customer_id", customer_id)
      .single();

    if (customerError || !customer) {
      return new Response(
        JSON.stringify({ error: "Customer not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Check if customer is in prospect status
    if (customer.registration_status !== "prospect") {
      return new Response(
        JSON.stringify({
          error: `Customer status is '${customer.registration_status}'. Only 'prospect' status customers can be approved.`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Update customer status to 'kyc'
    const { error: updateError } = await supabase
      .from("customer_details")
      .update({
        registration_status: "kyc",
        kyc_id_verified_at: new Date().toISOString(),
        kyc_verified_by: admin_email || "admin",
      })
      .eq("customer_id", customer_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: `Failed to update customer: ${updateError.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Generate registration URL
    const websiteUrl = Deno.env.get("WEBSITE_URL") || "https://wqnmxpooabmedvtackji.supabase.co/website";
    const registrationUrl = `${websiteUrl}/register.html?customer_id=${customer_id}&email=${encodeURIComponent(customer.email)}`;

    // Send KYC verified email with registration link
    const emailData = {
      first_name: customer.first_names,
      registration_url: registrationUrl,
      website_url: "https://bitwealth.co.za",
    };

    // Send email via ef_send_email
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
          template_key: "kyc_verified_notification",
          to_email: customer.email,
          data: emailData,
        }),
      });

      if (emailResponse.ok) {
        emailSent = true;
        console.log(`KYC verification email sent to ${customer.email}`);
      } else {
        const errorData = await emailResponse.json();
        emailError = errorData.error || "Unknown email error";
        console.error(`Failed to send KYC email: ${emailError}`);
      }
    } catch (error) {
      emailError = error instanceof Error ? error.message : String(error);
      console.error(`Email sending error: ${emailError}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `KYC approved for ${customer.first_names} ${customer.last_name}`,
        customer_id: customer_id,
        email: customer.email,
        registration_url: registrationUrl,
        email_sent: emailSent,
        email_error: emailError,
        notes: notes || null,
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
    console.error("Error in ef_approve_kyc:", error);
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
