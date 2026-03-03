// Edge Function: ef_upload_kyc_documents
// Purpose: Milestone 3 — Handle upload of ALL 4 KYC documents in a single call
//   1. Identity document (ID / passport)
//   2. Proof of address
//   3. Source of income (dropdown selection + supporting document)
//   4. Bank account confirmation letter
// Flow: Validates customer → Updates all KYC columns → Sends single admin notification
// Deployed with: JWT verification ENABLED (called from authenticated customer portal)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing required environment variables: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Allowed source-of-income values (must match DB constraint)
const VALID_INCOME_SOURCES = [
  "Employment / Salary",
  "Self-employment / Freelance",
  "Business income",
  "Investments / Dividends",
  "Pension / Retirement",
  "Inheritance / Gift",
];

interface UploadKycDocumentsRequest {
  customer_id: number;
  // 1. Identity document
  kyc_id_file_path: string;
  kyc_id_file_url: string;
  // 2. Proof of address
  kyc_proof_address_file_path: string;
  kyc_proof_address_file_url: string;
  // 3. Source of income
  kyc_source_of_income: string;
  kyc_source_of_income_file_path: string;
  kyc_source_of_income_file_url: string;
  // 4. Bank account confirmation letter
  kyc_bank_confirmation_file_path: string;
  kyc_bank_confirmation_file_url: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const body: UploadKycDocumentsRequest = await req.json();
    const {
      customer_id,
      kyc_id_file_path, kyc_id_file_url,
      kyc_proof_address_file_path, kyc_proof_address_file_url,
      kyc_source_of_income,
      kyc_source_of_income_file_path, kyc_source_of_income_file_url,
      kyc_bank_confirmation_file_path, kyc_bank_confirmation_file_url,
    } = body;

    // ── Validate all required fields ──────────────────────────────────────────
    const missing: string[] = [];
    if (!customer_id)                    missing.push("customer_id");
    if (!kyc_id_file_path)               missing.push("kyc_id_file_path");
    if (!kyc_id_file_url)                missing.push("kyc_id_file_url");
    if (!kyc_proof_address_file_path)    missing.push("kyc_proof_address_file_path");
    if (!kyc_proof_address_file_url)     missing.push("kyc_proof_address_file_url");
    if (!kyc_source_of_income)           missing.push("kyc_source_of_income");
    if (!kyc_source_of_income_file_path) missing.push("kyc_source_of_income_file_path");
    if (!kyc_source_of_income_file_url)  missing.push("kyc_source_of_income_file_url");
    if (!kyc_bank_confirmation_file_path) missing.push("kyc_bank_confirmation_file_path");
    if (!kyc_bank_confirmation_file_url)  missing.push("kyc_bank_confirmation_file_url");

    if (missing.length > 0) {
      return jsonResponse({ error: `Missing required fields: ${missing.join(", ")}` }, 400);
    }

    // ── Validate source of income value ───────────────────────────────────────
    if (!VALID_INCOME_SOURCES.includes(kyc_source_of_income)) {
      return jsonResponse({
        error: `Invalid source of income: "${kyc_source_of_income}". Valid values: ${VALID_INCOME_SOURCES.join(", ")}`,
      }, 400);
    }

    // ── Load customer ─────────────────────────────────────────────────────────
    const { data: customer, error: customerError } = await supabase
      .from("customer_details")
      .select("customer_id, first_names, last_name, email, registration_status")
      .eq("customer_id", customer_id)
      .single();

    if (customerError || !customer) {
      return jsonResponse({ error: "Customer not found" }, 404);
    }

    if (customer.registration_status !== "kyc") {
      return jsonResponse({
        error: `Invalid customer status: '${customer.registration_status}'. Document upload is only allowed when status='kyc'.`,
      }, 400);
    }

    // ── Update all 4 KYC document sections ───────────────────────────────────
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("customer_details")
      .update({
        // 1. Identity document
        kyc_id_document_url:                    kyc_id_file_url,
        kyc_id_uploaded_at:                     now,
        // 2. Proof of address
        kyc_proof_address_url:                  kyc_proof_address_file_url,
        kyc_proof_address_uploaded_at:           now,
        // 3. Source of income
        kyc_source_of_income:                   kyc_source_of_income,
        kyc_source_of_income_doc_url:           kyc_source_of_income_file_url,
        kyc_source_of_income_doc_uploaded_at:   now,
        // 4. Bank account confirmation
        kyc_bank_confirmation_url:              kyc_bank_confirmation_file_url,
        kyc_bank_confirmation_uploaded_at:       now,
      })
      .eq("customer_id", customer_id);

    if (updateError) {
      console.error("Error updating customer KYC documents:", updateError);
      return jsonResponse({ error: "Failed to update customer record: " + updateError.message }, 500);
    }

    // ── Send single admin notification now that all 4 docs are uploaded ───────
    const adminEmail = Deno.env.get("ADMIN_EMAIL") || "admin@bitwealth.co.za";
    const adminPortalUrl = `${supabaseUrl}/ui/Advanced BTC DCA Strategy.html#management-module`;

    const uploadDate = new Date().toLocaleString("en-ZA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Johannesburg",
    });

    let emailSent = false;
    let emailError: string | null = null;

    try {
      const emailResponse = await fetch(`${supabaseUrl}/functions/v1/ef_send_email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": req.headers.get("authorization") || "",
        },
        body: JSON.stringify({
          template_key: "kyc_documents_uploaded_notification",
          to_email: adminEmail,
          data: {
            first_name: customer.first_names,
            last_name: customer.last_name,
            customer_id: customer.customer_id,
            email: customer.email,
            upload_date: uploadDate,
            admin_portal_url: adminPortalUrl,
            // Document paths for audit trail
            kyc_id_file_path,
            kyc_proof_address_file_path,
            kyc_source_of_income,
            kyc_source_of_income_file_path,
            kyc_bank_confirmation_file_path,
          },
        }),
      });

      if (emailResponse.ok) {
        emailSent = true;
      } else {
        const errorData = await emailResponse.json();
        emailError = errorData.error || "Unknown email error";
        console.error(`Admin notification email failed to ${adminEmail}:`, emailError);
      }
    } catch (e) {
      emailError = (e as Error).message;
      console.error(`Admin notification email exception to ${adminEmail}:`, e);
    }

    // ── Return success ────────────────────────────────────────────────────────
    return jsonResponse({
      success: true,
      message: `All KYC documents uploaded for ${customer.first_names} ${customer.last_name}`,
      customer_id: customer.customer_id,
      email: customer.email,
      documents_uploaded: 4,
      email_sent: emailSent,
      email_error: emailError,
    });
  } catch (error) {
    console.error("Unhandled error in ef_upload_kyc_documents:", error);
    return jsonResponse({ error: (error as Error).message }, 500);
  }
});
