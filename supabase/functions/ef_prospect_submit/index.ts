// ef_prospect_submit/index.ts
// Purpose: Handle public prospect interest form submission
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SECRET_KEY = Deno.env.get("Secret Key");
const ORG_ID = Deno.env.get("ORG_ID");
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "admin@bitwealth.co.za";
const ADMIN_PORTAL_URL = Deno.env.get("ADMIN_PORTAL_URL") || "https://bitwealth.co.za/admin";
const WEBSITE_URL = Deno.env.get("WEBSITE_URL") || "https://bitwealth.co.za";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await req.json();
    const {
      first_names,
      last_name,
      email,
      phone_number,
      phone_country_code,
      country,
      upfront_investment_amount_range,
      monthly_investment_amount_range,
      prospect_message,
    } = body;

    // Validate required fields
    if (!first_names || !last_name || !email) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: first_names, last_name, email" }),
        { status: 400, headers: CORS }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: CORS }
      );
    }

    // Validate at least one investment amount range is provided
    if (!upfront_investment_amount_range && !monthly_investment_amount_range) {
      return new Response(
        JSON.stringify({ error: "At least one investment amount range is required" }),
        { status: 400, headers: CORS }
      );
    }

    // Use service role client (bypasses RLS)
    const supabase = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { persistSession: false },
    });

    // Check if email already exists (handle potential duplicates)
    const { data: existingList, error: checkError } = await supabase
      .from("customer_details")
      .select("customer_id, email, registration_status")
      .eq("email", email.toLowerCase())
      .limit(1);
    
    const existing = existingList?.[0];

    if (checkError) {
      console.error("Error checking existing customer:", checkError);
      return new Response(
        JSON.stringify({ error: "Database error checking existing customer" }),
        { status: 500, headers: CORS }
      );
    }

    if (existing) {
      // Customer already exists
      if (existing.registration_status === "prospect") {
        return new Response(
          JSON.stringify({
            success: true,
            message: "You have already submitted an interest form. We will contact you soon.",
            existing: true,
          }),
          { status: 200, headers: CORS }
        );
      } else {
        return new Response(
          JSON.stringify({
            success: true,
            message: "You are already a BitWealth customer. Please log in to your portal.",
            existing: true,
          }),
          { status: 200, headers: CORS }
        );
      }
    }

    // Insert new prospect into customer_details
    const { data: customer, error: insertError } = await supabase
      .from("customer_details")
      .insert({
        org_id: ORG_ID,
        first_names,
        last_name,
        email: email.toLowerCase(),
        email_address: email.toLowerCase(),
        phone_number,
        phone_country_code,
        country,
        upfront_investment_amount_range,
        monthly_investment_amount_range,
        prospect_message,
        registration_status: "prospect",
        customer_status: "Inactive",
      })
      .select("customer_id, first_names, last_name, email")
      .single();

    if (insertError) {
      console.error("Error inserting prospect:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to save prospect information", details: insertError }),
        { status: 500, headers: CORS }
      );
    }

    // Send confirmation email to prospect
    const prospectEmailData = {
      first_name: customer.first_names,
      website_url: WEBSITE_URL,
    };

    const prospectEmailResponse = await fetch(`${SUPABASE_URL}/functions/v1/ef_send_email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SECRET_KEY}`,
      },
      body: JSON.stringify({
        template_key: "prospect_confirmation",
        to_email: customer.email,
        data: prospectEmailData,
      }),
    });

    if (!prospectEmailResponse.ok) {
      console.error("Failed to send prospect confirmation email");
    }

    // Send notification email to admin
    const adminEmailData = {
      first_name: customer.first_names,
      surname: customer.last_name,
      email: customer.email,
      phone_country_code: phone_country_code || "",
      phone_number: phone_number || "",
      country: country || "",
      upfront_investment_amount_range: upfront_investment_amount_range || "Not specified",
      monthly_investment_amount_range: monthly_investment_amount_range || "Not specified",
      message: prospect_message || "No message provided",
      created_at: new Date().toISOString(),
      admin_portal_url: ADMIN_PORTAL_URL,
    };

    const adminEmailResponse = await fetch(`${SUPABASE_URL}/functions/v1/ef_send_email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SECRET_KEY}`,
      },
      body: JSON.stringify({
        template_key: "prospect_notification",
        to_email: ADMIN_EMAIL,
        data: adminEmailData,
      }),
    });

    if (!adminEmailResponse.ok) {
      console.error("Failed to send admin notification email");
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Thank you for your interest! We will contact you within 24 hours.",
        customer_id: customer.customer_id,
      }),
      { status: 200, headers: CORS }
    );
  } catch (error) {
    console.error("ef_prospect_submit error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: CORS }
    );
  }
});
