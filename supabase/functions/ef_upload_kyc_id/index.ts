// Edge Function: ef_upload_kyc_id
// Purpose: Milestone 3 - Handle KYC ID document upload confirmation
// Flow: Updates customer record → Sends admin notification email
// Deployed with: JWT verification ENABLED (called from authenticated customer portal)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface UploadKycIdRequest {
  customer_id: number;
  file_path: string;
  file_url: string;
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
    const body: UploadKycIdRequest = await req.json();
    const { customer_id, file_path, file_url } = body;

    // Validate inputs
    if (!customer_id || !file_path || !file_url) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: customer_id, file_path, file_url" }),
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

    // Verify customer status is 'kyc'
    if (customer.registration_status !== "kyc") {
      return new Response(
        JSON.stringify({ 
          error: `Invalid customer status: ${customer.registration_status}. ID upload only allowed for status='kyc'` 
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Update customer_details with ID document info
    const { error: updateError } = await supabase
      .from("customer_details")
      .update({
        kyc_id_document_url: file_url,
        kyc_id_uploaded_at: new Date().toISOString(),
      })
      .eq("customer_id", customer_id);

    if (updateError) {
      console.error("Error updating customer:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update customer record: " + updateError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get admin portal URL
    const websiteUrl = Deno.env.get("WEBSITE_URL") || supabaseUrl;
    const adminPortalUrl = `${websiteUrl}/ui/Advanced BTC DCA Strategy.html#management-module`;

    // Send notification email to admin
    let emailSent = false;
    let emailError = null;
    const adminEmail = Deno.env.get("ADMIN_EMAIL") || "admin@bitwealth.co.za";

    try {
      const emailResponse = await fetch(`${supabaseUrl}/functions/v1/ef_send_email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": req.headers.get("authorization") || "",
        },
        body: JSON.stringify({
          template_key: "kyc_id_uploaded_notification",
          to_email: adminEmail,
            data: {
              first_name: customer.first_names,
              last_name: customer.last_name,
              customer_id: customer.customer_id,
              email: customer.email,
              upload_date: new Date().toLocaleString("en-ZA", { 
                dateStyle: "medium", 
                timeStyle: "short",
                timeZone: "Africa/Johannesburg"
              }),
              admin_portal_url: adminPortalUrl,
              file_path: file_path,
            },
          }),
        });

      if (emailResponse.ok) {
        emailSent = true;
      } else {
        const errorData = await emailResponse.json();
        emailError = errorData.error || "Unknown email error";
        console.error(`Email send failed to ${adminEmail}:`, emailError);
      }
    } catch (e) {
      emailError = e.message;
      console.error(`Email send exception to ${adminEmail}:`, e);
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: `ID document uploaded for ${customer.first_names} ${customer.last_name}`,
        customer_id: customer.customer_id,
        email: customer.email,
        file_path: file_path,
        file_url: file_url,
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
    console.error("Error in ef_upload_kyc_id:", error);
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
