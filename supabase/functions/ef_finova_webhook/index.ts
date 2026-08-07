// ef_finova_webhook/index.ts
//
// Receives the Finova/KYCDD completion webhook, verifies its signature, maps the
// payload into customer_details + bank_accounts, downloads the documents into our
// own storage (their links expire ~15 min, so we fetch immediately), records the
// run in public.kyc_finova, and — when the client has passed — emails them the
// portal registration link.
//
// Linking: payload "uuid" == our customer_id (the value entered in the Finova
// invite form). "custom_id" is null on the invite path, so we key on "uuid".
//
// Deploy: public webhook, no JWT (Finova posts without a Supabase token), custom
// auth via the X-Signature-SHA256 HMAC. verify_jwt=false.

import { getServiceClient } from "./client.ts";
import {
  verifyFinovaSignature, mapFinovaToCustomer,
  PRIMARY_DOCS, ARCHIVE_DOCS, PROFILE_KEYS, isFinovaDoc, type FinovaDoc,
} from "./finova.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-signature-sha256",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Content-Type": "application/json",
};

const BUCKET = "kyc-documents";
const SIGNED_URL_TTL = 31536000; // 1 year, matches the legacy upload-kyc flow

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

// Minimal alert helper (mirrors _shared/alerting.ts; inlined to keep the bundle self-contained).
async function logAlert(
  sb: ReturnType<typeof getServiceClient>,
  severity: "info" | "warn" | "error" | "critical",
  message: string,
  context: Record<string, unknown> = {},
  orgId?: string | null,
  customerId?: number | null,
) {
  try {
    const payload: Record<string, unknown> = { component: "ef_finova_webhook", severity, message, context };
    if (orgId) payload.org_id = orgId;
    if (customerId) payload.customer_id = customerId;
    await sb.from("alert_events").insert(payload);
  } catch (e) {
    console.error("alert_events insert failed", e);
  }
}

// Download a Finova document link and store it in our bucket; returns a signed URL.
async function storeDoc(
  sb: ReturnType<typeof getServiceClient>,
  customerId: number,
  field: string,
  doc: FinovaDoc,
): Promise<string | null> {
  try {
    const res = await fetch(doc.link!);
    if (!res.ok) throw new Error(`fetch ${field} -> ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const ext = (doc.ext ?? "bin").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const path = `${customerId}/finova/${field}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (up.error) throw new Error(`upload ${field}: ${up.error.message}`);
    const signed = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
    if (signed.error) throw new Error(`sign ${field}: ${signed.error.message}`);
    return signed.data.signedUrl;
  } catch (e) {
    console.error(`storeDoc(${field}) failed:`, e);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") return json({ ok: true, message: "Finova webhook is live." });

  let sb: ReturnType<typeof getServiceClient>;
  try {
    sb = getServiceClient();
  } catch (e) {
    return json({ error: "client init failed", details: (e as Error).message }, 500);
  }

  const rawBody = await req.text();

  // 1. Verify signature (HMAC-SHA256, base64, header X-Signature-SHA256).
  const secret = Deno.env.get("FINOVA_WEBHOOK_SECRET");
  if (!secret) {
    await logAlert(sb, "critical", "FINOVA_WEBHOOK_SECRET not configured — cannot verify webhook");
    return json({ error: "server not configured" }, 500);
  }
  const providedSig = req.headers.get("x-signature-sha256");
  const valid = await verifyFinovaSignature(rawBody, secret, providedSig);
  if (!valid) {
    await logAlert(sb, "warn", "Rejected Finova webhook with invalid/missing signature",
      { has_sig: !!providedSig, ip: req.headers.get("x-forwarded-for") });
    return json({ error: "invalid signature" }, 401);
  }

  // 2. Parse.
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  // 3. Resolve customer via uuid.
  const customerId = Number(p["uuid"]);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    await logAlert(sb, "error", "Finova webhook missing/invalid uuid (customer_id link)",
      { uuid: p["uuid"], finova_client_id: p["client_id"] });
    return json({ error: "missing uuid" }, 400);
  }

  const { data: customer, error: custErr } = await sb
    .from("customer_details")
    .select("customer_id, org_id, email, first_names, last_name, registration_status")
    .eq("customer_id", customerId)
    .single();
  if (custErr || !customer) {
    await logAlert(sb, "error", `Finova webhook for unknown customer_id ${customerId}`,
      { uuid: p["uuid"], finova_client_id: p["client_id"] }, null, customerId);
    return json({ error: "customer not found" }, 404);
  }

  try {
    const step = typeof p["step"] === "string" ? (p["step"] as string) : null;
    const now = new Date().toISOString();

    // 4. Field mapping.
    const customerPatch = mapFinovaToCustomer(p);

    // 5. Documents — download immediately (Finova links expire ~15 min).
    const bankPatch: Record<string, unknown> = {};
    const docArchive: Record<string, string> = {};
    for (const d of PRIMARY_DOCS) {
      const val = p[d.field];
      if (!isFinovaDoc(val)) continue;
      const url = await storeDoc(sb, customerId, d.field, val);
      if (!url) {
        await logAlert(sb, "warn", `Failed to store Finova document '${d.field}'`,
          { field: d.field }, customer.org_id, customerId);
        continue;
      }
      if (d.target === "customer") {
        customerPatch[d.column] = url;
        if (d.uploadedAt) customerPatch[d.uploadedAt] = now;
      } else {
        bankPatch[d.column] = url;
        if (d.uploadedAt) bankPatch[d.uploadedAt] = now;
      }
    }
    for (const field of ARCHIVE_DOCS) {
      const val = p[field];
      if (!isFinovaDoc(val)) continue;
      const url = await storeDoc(sb, customerId, field, val);
      if (url) docArchive[field] = url;
    }

    if (p["client_id"]) customerPatch["finova_client_id"] = p["client_id"];

    // 6. Apply customer_details patch.
    if (Object.keys(customerPatch).length) {
      const { error } = await sb.from("customer_details").update(customerPatch).eq("customer_id", customerId);
      if (error) throw new Error(`customer_details update: ${error.message}`);
    }

    // 7. Bank details -> bank_accounts (upsert the active primary row).
    const bankFields: Record<string, unknown> = {
      bank_account_holder: p["bank_account_holder"],
      bank_account_number: p["bank_account_number"],
      bank_name: p["bank_name"],
      bank_branch_code: p["bank_branch_code"],
      bank_account_type: p["bank_account_type"],
      ...bankPatch,
    };
    const hasBank = Object.values(bankFields).some((v) => v != null && v !== "");
    if (hasBank) {
      const { data: existingBank } = await sb
        .from("bank_accounts")
        .select("bank_account_id")
        .eq("customer_id", customerId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingBank) {
        await sb.from("bank_accounts").update(bankFields).eq("bank_account_id", existingBank.bank_account_id);
      } else {
        await sb.from("bank_accounts").insert({
          customer_id: customerId, org_id: customer.org_id,
          is_primary: true, status: "active", ...bankFields,
        });
      }
    }

    // 8. Investment-profile / suitability snapshot.
    const profile: Record<string, unknown> = {};
    for (const k of PROFILE_KEYS) if (p[k] != null) profile[k] = p[k];

    // 9. finova_status. TODO(Finova): confirm the step values for rejected/incomplete
    // and how complyadvantage_mesh_screening represents a hit. For now: 'passed'
    // auto-approves (Finova only reaches 'passed' once their own checks, including
    // screening, clear); any other terminal step routes to manual review.
    const finovaStatus = step === "passed" ? "passed" : (step ? "review" : "in_progress");
    const screening = p["complyadvantage_mesh_screening"] ?? null;

    // 10. Upsert kyc_finova (one row per customer). Preserve register_email_sent_at.
    const { data: existingFinova } = await sb
      .from("kyc_finova")
      .select("kyc_finova_id, register_email_sent_at")
      .eq("customer_id", customerId)
      .maybeSingle();

    const finovaRow: Record<string, unknown> = {
      customer_id: customerId,
      org_id: customer.org_id,
      finova_client_id: p["client_id"] ?? null,
      finova_status: finovaStatus,
      current_step: step,
      status_type_id: p["status_type_id"] ?? null,
      client_risk_score: p["client_risk_score"] != null ? Number(p["client_risk_score"]) : null,
      liveness_risk_score: p["liveness_risk_score"] != null ? Number(p["liveness_risk_score"]) : null,
      doc_discrepancy_risk_score: p["doc_discrepancy_risk_score"] != null ? Number(p["doc_discrepancy_risk_score"]) : null,
      screening,
      screening_status: "unknown", // TODO(Finova): map clear/hit once representation confirmed
      doc_urls: Object.keys(docArchive).length ? docArchive : null,
      investment_profile: Object.keys(profile).length ? profile : null,
      last_event_at: now,
      last_payload: p,
      completed_at: finovaStatus === "passed" ? now : null,
      updated_at: now,
    };
    if (existingFinova) {
      await sb.from("kyc_finova").update(finovaRow).eq("kyc_finova_id", existingFinova.kyc_finova_id);
    } else {
      await sb.from("kyc_finova").insert({ ...finovaRow, invited_at: null });
    }

    // 11. Approval gate.
    if (finovaStatus === "passed") {
      await sb.from("customer_details").update({ kyc_id_verified_at: now }).eq("customer_id", customerId);

      const alreadyEmailed = existingFinova?.register_email_sent_at != null;
      if (!alreadyEmailed) {
        // Friendly strategy name for the {{strategy_name}} placeholder.
        let strategyName = "BitWealth";
        try {
          const { data: cs } = await sb
            .from("customer_strategies")
            .select("strategy_code")
            .eq("customer_id", customerId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (cs?.strategy_code) {
            const { data: s } = await sb
              .from("strategies").select("name").eq("strategy_code", cs.strategy_code).maybeSingle();
            strategyName = s?.name || cs.strategy_code;
          }
        } catch { /* keep default */ }

        const websiteUrl = Deno.env.get("WEBSITE_URL") || "https://bitwealth.co.za";
        const registrationUrl =
          `${websiteUrl}/register.html?customer_id=${customerId}&email=${encodeURIComponent(customer.email ?? "")}`;
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        try {
          const r = await fetch(`${supabaseUrl}/functions/v1/ef_send_email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
            body: JSON.stringify({
              template_key: "kyc_portal_registration",
              to_email: customer.email,
              data: {
                first_name: customer.first_names,
                strategy_name: strategyName,
                registration_url: registrationUrl,
                website_url: "https://bitwealth.co.za",
              },
            }),
          });
          if (r.ok) {
            await sb.from("kyc_finova").update({ register_email_sent_at: now }).eq("customer_id", customerId);
          } else {
            await logAlert(sb, "warn", "Finova approved but register email failed to send",
              { status: r.status }, customer.org_id, customerId);
          }
        } catch (e) {
          await logAlert(sb, "warn", "Finova approved but register email threw",
            { error: (e as Error).message }, customer.org_id, customerId);
        }
      }
      await logAlert(sb, "info", `Finova KYC passed for customer ${customerId}`,
        { finova_client_id: p["client_id"] }, customer.org_id, customerId);
    } else {
      // Not 'passed' — needs a human until Finova confirms the reject/incomplete steps.
      await logAlert(sb, "warn", `Finova KYC not passed (step='${step}') — manual review`,
        { step, finova_client_id: p["client_id"] }, customer.org_id, customerId);
    }

    return json({ received: true, customer_id: customerId, finova_status: finovaStatus });
  } catch (e) {
    await logAlert(sb, "error", "ef_finova_webhook processing error",
      { error: (e as Error).message }, customer.org_id, customerId);
    // Return 500 so Finova retries; all steps above are idempotent.
    return json({ error: "processing failed", details: (e as Error).message }, 500);
  }
});
