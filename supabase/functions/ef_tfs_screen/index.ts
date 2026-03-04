// Edge Function: ef_tfs_screen
// Purpose: FIC Phase 3 — Targeted Financial Sanctions (TFS) screening
//
// Screens customers against:
//   (1) UN Security Council Consolidated Sanctions List (public XML)
//   (2) FIC Consolidated TFS List (public XML — falls back gracefully if unavailable)
//
// Trigger modes (request body):
//   {}                          → Scheduled: screen all active customers not screened in 30+ days
//   { customer_id: 123 }        → Onboarding: screen a specific customer immediately
//   { trigger: "list_update" }  → Screen ALL active customers (after a list update)
//
// Test customers (is_test = true) are always skipped — never appear in fic.tfs_screening_log.
// Deployed with: --no-verify-jwt (called by pg_cron and by onboarding edge function)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ─── Environment ─────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID = Deno.env.get("ORG_ID");

if (!SUPABASE_URL || !SUPABASE_KEY || !ORG_ID) {
  throw new Error("Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID");
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Sanctions List URLs ──────────────────────────────────────────────────────

const UNSC_XML_URL =
  "https://scsanctions.un.org/resources/xml/en/consolidated.xml";

// FIC TFS consolidated XML — published by Financial Intelligence Centre (South Africa)
// Falls back gracefully if the URL is unavailable or requires authentication
const FIC_TFS_XML_URL =
  "https://www.fic.gov.za/Data/Sites/1/Documents/TFS/Consolidated_list_current.xml";

// ─── Fuzzy Matching ───────────────────────────────────────────────────────────

/**
 * Levenshtein distance between two strings (case-insensitive).
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Normalized similarity score [0..1] between two strings.
 * 1.0 = identical, 0.0 = completely different.
 */
function similarity(a: string, b: string): number {
  const _a = a.toLowerCase().trim();
  const _b = b.toLowerCase().trim();
  if (_a === _b) return 1.0;
  if (_a.length === 0 || _b.length === 0) return 0.0;
  const dist = levenshtein(_a, _b);
  return 1 - dist / Math.max(_a.length, _b.length);
}

/**
 * Returns TRUE if a client name string matches a sanctions entry name.
 * Uses a token-level approach:
 *   - Full-name similarity >= MATCH_THRESHOLD → match
 *   - All tokens of the shorter name appear in the longer at >= TOKEN_THRESHOLD → match
 */
const MATCH_THRESHOLD = 0.82;  // Overall name similarity (tunable)
const TOKEN_THRESHOLD = 0.88;  // Token-level similarity (stricter)

function namesMatch(clientName: string, sanctionsName: string): boolean {
  const c = clientName.toLowerCase().trim();
  const s = sanctionsName.toLowerCase().trim();
  if (!c || !s) return false;

  // 1. Full-name similarity
  if (similarity(c, s) >= MATCH_THRESHOLD) return true;

  // 2. Token overlap — every token in the shorter name must match at least
  //    one token in the longer name at or above the token threshold
  const cTokens = c.split(/\s+/);
  const sTokens = s.split(/\s+/);
  const [shorter, longer] = cTokens.length <= sTokens.length
    ? [cTokens, sTokens]
    : [sTokens, cTokens];

  if (shorter.length === 0) return false;

  const matchedCount = shorter.filter((t) =>
    longer.some((l) => similarity(t, l) >= TOKEN_THRESHOLD)
  ).length;

  return matchedCount === shorter.length && shorter.length >= 2;
}

// ─── Sanctions Entry Types ────────────────────────────────────────────────────

interface SanctionsEntry {
  source: "UNSC" | "FIC_TFS";
  listId: string;
  fullName: string;           // Primary full name
  aliases: string[];          // Additional name variations
  dateOfBirth?: string;       // YYYY-MM-DD or partial (YYYY-MM or YYYY)
  idNumbers: string[];        // Passport / ID numbers from the list
  nationality?: string;
}

// ─── XML Parsing — UNSC ───────────────────────────────────────────────────────

/**
 * Very lightweight XML text extraction — no external parser needed.
 * Extracts the inner text of the first matching tag.
 */
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i");
  const m = re.exec(xml);
  return m ? m[1].trim() : "";
}

/**
 * Extracts all occurrences of a tag's text content.
 */
function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "gi");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1].trim()) results.push(m[1].trim());
  }
  return results;
}

/**
 * Splits XML into individual record blocks by tag.
 */
function splitRecords(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, "gi");
  return (xml.match(re) ?? []);
}

/**
 * Parse the UNSC Consolidated XML into SanctionsEntry[].
 * Handles both INDIVIDUAL and ENTITY records.
 */
function parseUnscXml(xml: string): SanctionsEntry[] {
  const entries: SanctionsEntry[] = [];

  // ── Individuals ──────────────────────────────────────────────────────────
  for (const block of splitRecords(xml, "INDIVIDUAL")) {
    const first  = extractTag(block, "FIRST_NAME");
    const second = extractTag(block, "SECOND_NAME");
    const third  = extractTag(block, "THIRD_NAME");
    const fourth = extractTag(block, "FOURTH_NAME");
    const nameParts = [first, second, third, fourth].filter(Boolean);
    const fullName = nameParts.join(" ");
    if (!fullName) continue;

    const listId = extractTag(block, "DATAID") || extractTag(block, "VERSIONNUM");

    // Aliases
    const akaBlocks = splitRecords(block, "AKA");
    const aliases: string[] = [];
    for (const aka of akaBlocks) {
      const af = extractTag(aka, "FIRST_NAME");
      const as2 = extractTag(aka, "SECOND_NAME");
      const as3 = extractTag(aka, "THIRD_NAME");
      const alias = [af, as2, as3].filter(Boolean).join(" ");
      if (alias) aliases.push(alias);
      // Also grab NAME field
      const akaName = extractTag(aka, "NAME");
      if (akaName) aliases.push(akaName);
    }

    // Date of birth
    const dobBlock = extractTag(block, "DATE");
    const dobYear  = extractTag(block, "YEAR");
    const dob = dobBlock || (dobYear ? `${dobYear}` : undefined);

    // ID/Passport numbers
    const docBlocks = splitRecords(block, "DOCUMENT");
    const idNumbers: string[] = [];
    for (const doc of docBlocks) {
      const num = extractTag(doc, "NUMBER");
      if (num) idNumbers.push(num.replace(/\s/g, ""));
    }

    // Nationality
    const nationality = extractTag(block, "NATIONALITY_VALUE") ||
                        extractTag(block, "NATIONALITY");

    entries.push({
      source: "UNSC",
      listId,
      fullName,
      aliases,
      dateOfBirth: dob,
      idNumbers,
      nationality,
    });
  }

  // ── Entities ─────────────────────────────────────────────────────────────
  for (const block of splitRecords(xml, "ENTITY")) {
    const name = extractTag(block, "FIRST_NAME") || extractTag(block, "NAME");
    if (!name) continue;
    const listId = extractTag(block, "DATAID") || "";
    const akaBlocks = splitRecords(block, "AKA");
    const aliases: string[] = [];
    for (const aka of akaBlocks) {
      const akaName = extractTag(aka, "NAME") || extractTag(aka, "FIRST_NAME");
      if (akaName) aliases.push(akaName);
    }
    entries.push({ source: "UNSC", listId, fullName: name, aliases, idNumbers: [] });
  }

  return entries;
}

/**
 * Parse the FIC TFS consolidated XML.
 * The FIC list format is simpler: <Entry> blocks with <Name> and <Aliases>.
 * Falls back without throwing if the XML structure is unrecognised.
 */
function parseFicTfsXml(xml: string): SanctionsEntry[] {
  const entries: SanctionsEntry[] = [];

  for (const block of splitRecords(xml, "Entry")) {
    const name    = extractTag(block, "Name") || extractTag(block, "FullName");
    const listId  = extractTag(block, "ReferenceNumber") || extractTag(block, "Id") || "";
    if (!name) continue;

    const aliases   = extractAllTags(block, "Alias").concat(extractAllTags(block, "AltName"));
    const dobRaw    = extractTag(block, "DateOfBirth") || extractTag(block, "DOB");
    const idNumbers = extractAllTags(block, "PassportNumber")
                        .concat(extractAllTags(block, "IDNumber"))
                        .map(v => v.replace(/\s/g, ""));

    entries.push({
      source:      "FIC_TFS",
      listId,
      fullName:    name,
      aliases,
      dateOfBirth: dobRaw || undefined,
      idNumbers,
    });
  }

  return entries;
}

// ─── Fetch and Parse Sanctions Lists ─────────────────────────────────────────

async function fetchSanctionsList(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: { "Accept": "text/xml,application/xml" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      console.warn(`TFS list fetch non-OK [${resp.status}]: ${url}`);
      return null;
    }
    return await resp.text();
  } catch (e) {
    console.warn(`TFS list fetch failed [${url}]:`, e.message);
    return null;
  }
}

async function loadSanctionsLists(): Promise<{
  entries: SanctionsEntry[];
  unscListVersion: string;
  ficListVersion: string;
}> {
  const [unscXml, ficXml] = await Promise.all([
    fetchSanctionsList(UNSC_XML_URL),
    fetchSanctionsList(FIC_TFS_XML_URL),
  ]);

  let entries: SanctionsEntry[] = [];
  let unscListVersion = "unavailable";
  let ficListVersion  = "unavailable";

  if (unscXml) {
    const unscEntries = parseUnscXml(unscXml);
    entries = entries.concat(unscEntries);
    // Extract version/date from UNSC document header
    unscListVersion = extractTag(unscXml, "LAST_DAY_UPDATED") ||
                      extractTag(unscXml, "dataid") ||
                      new Date().toISOString().slice(0, 10);
    console.log(`UNSC list loaded: ${unscEntries.length} entries`);
  } else {
    console.error("UNSC consolidated list could not be fetched — screening will be incomplete");
  }

  if (ficXml) {
    const ficEntries = parseFicTfsXml(ficXml);
    entries = entries.concat(ficEntries);
    ficListVersion = new Date().toISOString().slice(0, 10);
    console.log(`FIC TFS list loaded: ${ficEntries.length} entries`);
  } else {
    console.warn("FIC TFS list could not be fetched — UNSC only for this run");
  }

  console.log(`Total sanctions entries loaded: ${entries.length}`);
  return { entries, unscListVersion, ficListVersion };
}

// ─── Screening Logic ──────────────────────────────────────────────────────────

interface Customer {
  customer_id: number;
  first_names: string;
  last_name:   string;
  middle_name: string | null;
  id_number:   string | null;
  id_passport_number: string | null;
  date_of_birth: string | null;
  nationality: string | null;
}

interface MatchDetail {
  source:     "UNSC" | "FIC_TFS";
  listId:     string;
  matchedName: string;
  matchType:  "exact_id" | "name_dob" | "name_fuzzy";
  similarity?: number;
}

function screenCustomer(
  customer: Customer,
  entries: SanctionsEntry[]
): { result: "clear" | "possible_match" | "confirmed_match"; matchDetails: MatchDetail[] } {

  const clientFullName = [
    customer.first_names,
    customer.middle_name,
    customer.last_name,
  ].filter(Boolean).join(" ").toLowerCase().trim();

  const clientIds = [
    customer.id_number?.replace(/\s/g, ""),
    customer.id_passport_number?.replace(/\s/g, ""),
  ].filter(Boolean) as string[];

  const clientDob = customer.date_of_birth
    ? customer.date_of_birth.slice(0, 10)   // YYYY-MM-DD
    : null;

  const matchDetails: MatchDetail[] = [];

  for (const entry of entries) {
    const namesToCheck = [entry.fullName, ...entry.aliases];

    // ── 1. Exact ID number match → confirmed_match ──────────────────────
    if (clientIds.length > 0 && entry.idNumbers.length > 0) {
      const idMatch = clientIds.some(cId =>
        entry.idNumbers.some(sId =>
          sId.toLowerCase() === cId.toLowerCase() && sId.length >= 6
        )
      );
      if (idMatch) {
        matchDetails.push({
          source:      entry.source,
          listId:      entry.listId,
          matchedName: entry.fullName,
          matchType:   "exact_id",
        });
        continue;
      }
    }

    // ── 2. Name + DOB match → confirmed_match ───────────────────────────
    if (clientDob && entry.dateOfBirth) {
      const entryDob = entry.dateOfBirth.slice(0, 10);
      const dobMatches = clientDob === entryDob ||
                         clientDob.slice(0, 4) === entryDob.slice(0, 4);   // year-only match is weaker
      const nameMatches = namesToCheck.some(n => namesMatch(clientFullName, n));
      if (dobMatches && nameMatches) {
        matchDetails.push({
          source:      entry.source,
          listId:      entry.listId,
          matchedName: entry.fullName,
          matchType:   clientDob === entryDob ? "name_dob" : "name_fuzzy",
        });
        continue;
      }
    }

    // ── 3. Name fuzzy match → possible_match ────────────────────────────
    for (const n of namesToCheck) {
      const sim = similarity(clientFullName, n.toLowerCase().trim());
      if (sim >= MATCH_THRESHOLD) {
        matchDetails.push({
          source:      entry.source,
          listId:      entry.listId,
          matchedName: entry.fullName,
          matchType:   "name_fuzzy",
          similarity:  Math.round(sim * 1000) / 1000,
        });
        break;  // One match per entry is enough
      }
    }
  }

  if (matchDetails.length === 0) {
    return { result: "clear", matchDetails: [] };
  }

  // Confirmed: exact ID match, or name+full-DOB match
  const confirmed = matchDetails.some(
    m => m.matchType === "exact_id" || m.matchType === "name_dob"
  );
  return {
    result:       confirmed ? "confirmed_match" : "possible_match",
    matchDetails,
  };
}

// ─── Write Results to DB ──────────────────────────────────────────────────────

async function writeScreeningResult(
  customer: Customer,
  result: "clear" | "possible_match" | "confirmed_match",
  matchDetails: MatchDetail[],
  unscListVersion: string,
  ficListVersion: string,
  trigger: string,
  screened_by: string,
): Promise<void> {
  // Insert into fic.tfs_screening_log
  const { data: logRow, error: logErr } = await sb
    .schema("fic")
    .from("tfs_screening_log")
    .insert({
      org_id:              ORG_ID,
      customer_id:         customer.customer_id,
      trigger,
      screened_by,
      unsc_list_version:   unscListVersion,
      fic_tfs_list_version: ficListVersion,
      result,
      match_details:       matchDetails,
      notes: result !== "clear"
        ? `${matchDetails.length} potential match(es) found — manual review required`
        : null,
    })
    .select("screening_id")
    .single();

  if (logErr) {
    console.error(`Failed to log screening for customer ${customer.customer_id}:`, logErr.message);
    return;
  }

  const screeningId = logRow?.screening_id;

  // If there is a match → create a compliance alert
  if (result !== "clear") {
    const severity = result === "confirmed_match" ? "critical" : "high";
    const desc = result === "confirmed_match"
      ? `CONFIRMED TFS MATCH for customer ${customer.customer_id} (${customer.first_names} ${customer.last_name}). ` +
        `${matchDetails.length} list entry match(es). ACCOUNT MUST BE FROZEN IMMEDIATELY. File TPR within 24 hours.`
      : `Possible TFS match for customer ${customer.customer_id} (${customer.first_names} ${customer.last_name}). ` +
        `${matchDetails.length} potential match(es) require manual review by Compliance Officer.`;

    const { error: alertErr } = await sb
      .schema("fic")
      .from("compliance_alerts")
      .insert({
        org_id:      ORG_ID,
        customer_id: customer.customer_id,
        alert_type:  "tfs_match",
        severity,
        status:      "pending",
        description: desc,
        context: {
          screening_id:  screeningId,
          result,
          match_details: matchDetails,
          unsc_list_version:   unscListVersion,
          fic_tfs_list_version: ficListVersion,
        },
      });

    if (alertErr) {
      console.error(`Failed to create compliance alert for customer ${customer.customer_id}:`, alertErr.message);
    }

    // For confirmed matches, also log to lth_pvr.alert_events for the main alert digest
    if (result === "confirmed_match") {
      await sb
        .schema("lth_pvr")
        .from("alert_events")
        .insert({
          org_id:    ORG_ID,
          component: "ef_tfs_screen",
          severity:  "critical",
          message:   `🚨 CONFIRMED TFS SANCTIONS MATCH — Customer ${customer.customer_id} ` +
                     `(${customer.first_names} ${customer.last_name}). Freeze account. File TPR within 24 hours.`,
          context: {
            customer_id:   customer.customer_id,
            result,
            match_details: matchDetails,
          },
          customer_id: customer.customer_id,
        });
    }
  }
}

// ─── CORS ────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const startedAt = Date.now();

  let body: {
    customer_id?: number;
    trigger?: string;
  } = {};

  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    // empty body is fine — defaults to scheduled run
  }

  const trigger   = body.trigger ?? (body.customer_id ? "onboarding" : "scheduled");
  const screened_by = "ef_tfs_screen";

  console.log(`ef_tfs_screen starting — trigger: ${trigger}`, body.customer_id ? `customer_id: ${body.customer_id}` : "all due customers");

  try {
    // ── 1. Fetch sanctions lists ────────────────────────────────────────────
    const { entries, unscListVersion, ficListVersion } = await loadSanctionsLists();

    if (entries.length === 0) {
      console.error("No sanctions entries loaded — aborting to avoid false clears");
      return new Response(
        JSON.stringify({ success: false, error: "Sanctions lists unavailable — screening aborted" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── 2. Fetch customers to screen ──────────────────────────────────────
    let query = sb
      .from("customer_details")
      .select(`
        customer_id, first_names, last_name, middle_name,
        id_number, id_passport_number, date_of_birth, nationality, is_test
      `)
      .eq("org_id", ORG_ID)
      .neq("registration_status", "inactive")
      .eq("is_test", false);   // ← Always skip test customers

    if (body.customer_id) {
      // Specific customer (onboarding trigger)
      query = query.eq("customer_id", body.customer_id);
    } else if (trigger === "list_update") {
      // Re-screen everyone on list update — no date filter
      // (no additional filter needed)
    } else {
      // Scheduled: only customers not screened in the last 30 days
      // Use a subquery via RPC isn't available easily here, so we'll filter client-side
      // after fetching the last screening date per customer
    }

    const { data: customers, error: customerErr } = await query.limit(200);

    if (customerErr) {
      throw new Error(`Failed to fetch customers: ${customerErr.message}`);
    }

    if (!customers || customers.length === 0) {
      console.log("No customers to screen (all test, inactive, or none found)");
      return new Response(
        JSON.stringify({ success: true, screened: 0, message: "No customers to screen" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // ── 3. Get last screening dates for scheduled runs ────────────────────
    let customerIdsToScreen = customers.map(c => c.customer_id);

    if (!body.customer_id && trigger !== "list_update") {
      // Filter out customers screened within the last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const { data: recentScreenings } = await sb
        .schema("fic")
        .from("tfs_screening_log")
        .select("customer_id, screened_at")
        .in("customer_id", customerIdsToScreen)
        .gte("screened_at", thirtyDaysAgo)
        .order("screened_at", { ascending: false });

      const recentlyScreenedIds = new Set(
        (recentScreenings ?? []).map(s => s.customer_id)
      );

      customerIdsToScreen = customerIdsToScreen.filter(
        id => !recentlyScreenedIds.has(id)
      );

      console.log(
        `Due for screening: ${customerIdsToScreen.length} / ${customers.length} customers ` +
        `(${customers.length - customerIdsToScreen.length} screened within last 30 days)`
      );
    }

    if (customerIdsToScreen.length === 0) {
      return new Response(
        JSON.stringify({ success: true, screened: 0, message: "All customers up to date" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const customersToScreen = customers.filter(c =>
      customerIdsToScreen.includes(c.customer_id)
    ) as Customer[];

    // ── 4. Screen each customer ────────────────────────────────────────────
    const results = {
      clear:             0,
      possible_match:    0,
      confirmed_match:   0,
      error:             0,
    };

    for (const customer of customersToScreen) {
      try {
        const { result, matchDetails } = screenCustomer(customer, entries);

        await writeScreeningResult(
          customer, result, matchDetails,
          unscListVersion, ficListVersion,
          trigger, screened_by
        );

        results[result]++;
        console.log(
          `Customer ${customer.customer_id} (${customer.first_names} ${customer.last_name}): ${result}` +
          (matchDetails.length > 0 ? ` — ${matchDetails.length} match detail(s)` : "")
        );
      } catch (e) {
        results.error++;
        console.error(`Error screening customer ${customer.customer_id}:`, e.message);
      }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `ef_tfs_screen complete in ${elapsed}s — `,
      `${customersToScreen.length} screened: `,
      `${results.clear} clear, `,
      `${results.possible_match} possible matches, `,
      `${results.confirmed_match} confirmed matches, `,
      `${results.error} errors`
    );

    return new Response(
      JSON.stringify({
        success: true,
        trigger,
        screened:         customersToScreen.length,
        results,
        unsc_list_version:   unscListVersion,
        fic_tfs_list_version: ficListVersion,
        elapsed_seconds:  parseFloat(elapsed),
      }),
      { headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );

  } catch (e) {
    console.error("ef_tfs_screen fatal error:", e.message);
    return new Response(
      JSON.stringify({ success: false, error: e.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }
});
