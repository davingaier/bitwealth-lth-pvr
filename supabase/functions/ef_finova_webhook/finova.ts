// ef_finova_webhook/finova.ts
// Adapter helpers for the Finova/KYCDD webhook: signature verification, payload
// -> customer_details field mapping, and document definitions. Kept local to the
// function so it deploys as a self-contained bundle. If ef_finova_create_client /
// ef_finova_sync_client are added later, promote this to _shared/finova.ts.

// ── Signature: HMAC-SHA256 of the raw body, base64, header X-Signature-SHA256 ──
export async function verifyFinovaSignature(
  rawBody: string,
  secret: string,
  providedSig: string | null,
): Promise<boolean> {
  if (!providedSig) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  // Constant-time compare.
  if (expected.length !== providedSig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ providedSig.charCodeAt(i);
  return diff === 0;
}

// ── ISO 3166-1 alpha-2 -> full name (common subset; falls back to the raw code) ─
const ISO2_TO_NAME: Record<string, string> = {
  ZA: "South Africa", GB: "United Kingdom", US: "United States", NA: "Namibia",
  BW: "Botswana", ZW: "Zimbabwe", MZ: "Mozambique", LS: "Lesotho", SZ: "Eswatini",
  AU: "Australia", CA: "Canada", NZ: "New Zealand", IE: "Ireland", DE: "Germany",
  FR: "France", NL: "Netherlands", PT: "Portugal", ES: "Spain", IT: "Italy",
  IN: "India", CN: "China", AE: "United Arab Emirates", MU: "Mauritius",
};
export function iso2ToName(code: unknown): string | null {
  if (typeof code !== "string" || !code) return null;
  const c = code.trim().toUpperCase();
  return ISO2_TO_NAME[c] ?? code; // keep raw if unknown
}

function asText(v: unknown): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.filter((x) => x != null).join(", ") || null;
  const s = String(v).trim();
  return s || null;
}

// Split "+27609974350" -> { code: "+27", number: "609974350" }.
function splitPhone(v: unknown): { code: string | null; number: string | null } {
  const s = asText(v);
  if (!s) return { code: null, number: null };
  const m = s.match(/^(\+\d{1,3})(\d{4,})$/);
  if (m) return { code: m[1], number: m[2] };
  return { code: null, number: s };
}

// Map the Finova payload to a customer_details patch (documents handled separately).
export function mapFinovaToCustomer(p: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const set = (col: string, val: unknown) => { if (val != null && val !== "") patch[col] = val; };

  set("first_names", asText(p["given_name"]));
  set("last_name", asText(p["family_name"]));
  // NB: email deliberately NOT overwritten — the portal register link uses our
  // on-file email; the uuid field is the authoritative link, not email.
  set("gender", asText(p["gender"]));
  set("date_of_birth", asText(p["date_of_birth"]));
  set("marital_status", asText(p["marital_status"]));
  set("nationality", iso2ToName(p["nationality"]));
  set("country_of_residence", iso2ToName(p["country"]));
  set("occupation", asText(p["occupation"]));
  set("tax_number", asText(p["sa_income_tax_no"]));

  // ID / passport: 13-digit numeric => SA ID (numeric column); else passport/other.
  const idRaw = asText(p["ClientID/Passport"]);
  if (idRaw) {
    if (/^\d{13}$/.test(idRaw)) {
      patch["id_number"] = Number(idRaw);
      patch["id_type"] = "SA ID";
    } else {
      patch["id_passport_number"] = idRaw;
      patch["id_type"] = "Passport";
    }
  }

  const phone = splitPhone(p["telephone_number"]);
  set("phone_country_code", phone.code);
  set("phone_number", phone.number);

  set("address_line1", asText(p["address_line1"]));
  set("address_line2", asText(p["address_line2"]));
  set("address_line3", asText(p["address_level1"])); // Finova: address_level1 = line 3
  set("city", asText(p["address_level2"]));           // Finova: address_level2 = city
  set("province", asText(p["province"]));
  set("postal_code", asText(p["postal_code"]));

  set("source_of_funds", asText(p["source_of_funds"]));
  set("source_of_wealth", asText(p["source_of_wealth"]));      // array -> joined
  set("kyc_source_of_income", asText(p["source_s_of_income"])); // array -> joined

  return patch;
}

// Document object shape from Finova: { ext, desc, link, name, type, client_doc_id }.
export interface FinovaDoc { ext?: string; link?: string; name?: string; type?: string; }

// Documents that map to a specific customer_details / bank_accounts column.
export const PRIMARY_DOCS: Array<{ field: string; column: string; uploadedAt?: string; target: "customer" | "bank" }> = [
  { field: "identity_document",    column: "kyc_id_document_url",     uploadedAt: "kyc_id_uploaded_at",            target: "customer" },
  { field: "proof_of_address",     column: "kyc_proof_address_url",   uploadedAt: "kyc_proof_address_uploaded_at", target: "customer" },
  { field: "sa_id_card_backside",  column: "kyc_id_backside_url",     uploadedAt: "kyc_id_backside_uploaded_at",   target: "customer" },
  { field: "selfie_holding_an_id", column: "kyc_selfie_url",          uploadedAt: "kyc_selfie_uploaded_at",        target: "customer" },
  { field: "client_kyc_report",    column: "kyc_finova_report_url",                                               target: "customer" },
  { field: "banking_documents",    column: "bank_confirmation_url",   uploadedAt: "bank_confirmation_uploaded_at", target: "bank" },
];

// Extra signed PDFs to archive (re-hosted) into kyc_finova.doc_urls.
export const ARCHIVE_DOCS = ["finova_individual_mandate", "bitwealth_individual_addendum"];

export function isFinovaDoc(v: unknown): v is FinovaDoc {
  return !!v && typeof v === "object" && typeof (v as FinovaDoc).link === "string";
}

// Investment-profile / suitability answers to keep as a jsonb record.
export const PROFILE_KEYS = [
  "what_type_of_client_are_you", "average_income_per_annum", "investable_assets_excl_residence",
  "financial_dependents", "registered_for_tax_in_other_countries", "where_did_you_hear_about_us",
  "employer_name", "employer_nature_of_business", "department", "JobDescription", "title",
  "place_of_birth", "country_of_birth",
];
