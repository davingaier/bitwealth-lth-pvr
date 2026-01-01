// ef_customer_register/index.ts
// Purpose: Create Supabase Auth account and link to customer_id
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PORTAL_URL = Deno.env.get("PORTAL_URL") || "https://bitwealth.co.za/portal";

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
      customer_id,
      email,
      password,
      accept_terms,
      accept_privacy,
      sign_disclaimer,
    } = body;

    // Validate required fields
    if (!customer_id || !email || !password) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: customer_id, email, password" }),
        { status: 400, headers: CORS }
      );
    }

    // Validate password requirements (8+ chars, 1 number, 1 special, 1 uppercase)
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
    if (!passwordRegex.test(password)) {
      return new Response(
        JSON.stringify({
          error: "Password must be at least 8 characters with 1 uppercase, 1 number, and 1 special character",
        }),
        { status: 400, headers: CORS }
      );
    }

    // Validate agreement acceptances
    if (!accept_terms || !accept_privacy || !sign_disclaimer) {
      return new Response(
        JSON.stringify({ error: "You must accept all agreements to register" }),
        { status: 400, headers: CORS }
      );
    }

    // Initialize Supabase admin client
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    // Verify customer exists and status is 'kyc' (KYC approved, ready to register)
    const { data: customer, error: customerError } = await supabase
      .from("customer_details")
      .select("customer_id, email, registration_status, first_names, last_name")
      .eq("customer_id", customer_id)
      .eq("email", email.toLowerCase())
      .single();

    if (customerError || !customer) {
      return new Response(
        JSON.stringify({ error: "Customer not found or email mismatch" }),
        { status: 404, headers: CORS }
      );
    }

    // Check if customer is already registered (duplicate registration prevention)
    if (customer.registration_status === "setup" || customer.registration_status === "active") {
      return new Response(
        JSON.stringify({
          error: "Failed to create account as this user is already registered. If you forgot your password, please use the password reset option.",
        }),
        { status: 400, headers: CORS }
      );
    }

    // Check if customer has completed KYC verification
    if (customer.registration_status !== "kyc") {
      return new Response(
        JSON.stringify({
          error: "Failed to create account as KYC is not verified. Please contact support at support@bitwealth.co.za.",
        }),
        { status: 400, headers: CORS }
      );
    }

    // Create Supabase Auth user (using admin API)
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true, // Auto-confirm email since KYC is already done
      user_metadata: {
        customer_id: customer.customer_id,
        first_name: customer.first_names,
        surname: customer.last_name,
      },
    });

    if (authError) {
      console.error("Auth user creation error:", authError);
      
      // Check if user already exists
      if (authError.message.includes("already registered")) {
        return new Response(
          JSON.stringify({
            error: "An account with this email already exists. Please use password reset if you forgot your password.",
          }),
          { status: 409, headers: CORS }
        );
      }

      return new Response(
        JSON.stringify({ error: `Failed to create account: ${authError.message}` }),
        { status: 500, headers: CORS }
      );
    }

    // Record agreement acceptances in customer_agreements
    const agreementInserts = [];
    const now = new Date().toISOString();

    if (accept_terms) {
      agreementInserts.push({
        customer_id: customer.customer_id,
        agreement_type: "terms",
        accepted_at: now,
        ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown",
      });
    }

    if (accept_privacy) {
      agreementInserts.push({
        customer_id: customer.customer_id,
        agreement_type: "privacy",
        accepted_at: now,
        ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown",
      });
    }

    if (sign_disclaimer) {
      agreementInserts.push({
        customer_id: customer.customer_id,
        agreement_type: "disclaimer",
        accepted_at: now,
        ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown",
      });
    }

    const { error: agreementError } = await supabase
      .from("customer_agreements")
      .insert(agreementInserts);

    if (agreementError) {
      console.error("Error recording agreements:", agreementError);
      // Don't fail the request if agreement recording fails, just log it
    }

    // Update customer_details with acceptance timestamps
    // NOTE: Status stays as 'kyc' - only changes to 'setup' after admin verifies ID document
    const { error: updateError } = await supabase
      .from("customer_details")
      .update({
        terms_accepted_at: accept_terms ? now : null,
        privacy_accepted_at: accept_privacy ? now : null,
        disclaimer_signed_at: sign_disclaimer ? now : null,
        portal_access_granted_at: now,
        // registration_status stays as 'kyc' - admin must verify ID before moving to 'setup'
      })
      .eq("customer_id", customer.customer_id);

    if (updateError) {
      console.error("Error updating customer details:", updateError);
      // Don't fail if timestamp update fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Account created successfully! You can now log in to your portal.",
        portal_url: PORTAL_URL,
        user_id: authUser.user.id,
      }),
      { status: 200, headers: CORS }
    );
  } catch (error) {
    console.error("ef_customer_register error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: CORS }
    );
  }
});
