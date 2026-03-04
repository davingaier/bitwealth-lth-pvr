// Edge Function: ef_atms_monitor
// Purpose: FIC Phase 4 — Automated Transaction Monitoring System (ATMS)
//
// Implements 8 transaction monitoring rules defined in the RMCP:
//   ATMS-01  Structuring          — ≥3 ZAR deposits each <R15k, total >R45k in 7 days
//   ATMS-02  Rapid conversion     — ZAR deposit >R20k followed by BTC buy within 24h
//   ATMS-03  Large single deposit — Single ZAR deposit >R100k or >3× monthly average
//   ATMS-04  Velocity anomaly     — This month deposits >5× 90-day monthly average
//   ATMS-05  Dormant reactivation — Inactive ≥90 days then deposit >R50k
//   ATMS-06  SOF inconsistency    — 30-day deposits >12× declared monthly contribution
//   ATMS-07  Deposit + withdrawal — ZAR deposit >R50k AND BTC withdrawal same day
//   ATMS-08  Duplicate ownership  — Shared ID/email/phone across active accounts
//
// Trigger modes (request body):
//   {}                → Scheduled daily run: check last 7 days of transactions
//   { force: true }   → Re-run even if alerts already raised (ignores deduplication)
//
// Deployed with --no-verify-jwt (called by pg_cron)
// Alert deduplication: skips rule+customer combos already alerted within 7 days

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ─── Environment ─────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID       = Deno.env.get("ORG_ID");

if (!SUPABASE_URL || !SUPABASE_KEY || !ORG_ID) {
  throw new Error(
    "Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID"
  );
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Types ───────────────────────────────────────────────────────────────────

interface AtmsViolation {
  customer_id: number;
  rule_code:   string;
  severity:    string;
  description: string;
  context:     Record<string, unknown>;
}

interface RunResult {
  violations_checked: number;
  new_alerts_created: number;
  deduplicated:       number;
  errors:             string[];
  by_rule:            Record<string, { found: number; inserted: number }>;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const startTime = Date.now();

  // Parse request body for trigger options
  let force = false;
  try {
    const body = await req.json().catch(() => ({}));
    force = body?.force === true;
  } catch {
    // ignore body parse errors
  }

  console.log(`[ef_atms_monitor] Starting ATMS checks — force=${force}`);

  const result: RunResult = {
    violations_checked: 0,
    new_alerts_created: 0,
    deduplicated:       0,
    errors:             [],
    by_rule:            {},
  };

  try {
    // ── Step 1: Run all 8 ATMS rules via SQL function ─────────────────────
    const { data: violations, error: checkErr } = await sb.rpc(
      "fic_run_atms_checks",
      { p_org_id: ORG_ID }
    );

    if (checkErr) {
      throw new Error(`ATMS checks failed: ${checkErr.message}`);
    }

    const allViolations: AtmsViolation[] = (violations ?? []) as AtmsViolation[];
    result.violations_checked = allViolations.length;

    console.log(`[ef_atms_monitor] Detected ${allViolations.length} potential violation(s)`);

    if (allViolations.length === 0) {
      return successResponse(result, startTime, "No ATMS violations detected");
    }

    // ── Step 2: Load existing open alerts for deduplication ──────────────
    let existingAlerts: Set<string> = new Set();

    if (!force) {
      const { data: openAlerts, error: openErr } = await sb.rpc(
        "fic_get_open_atms_alerts",
        { p_org_id: ORG_ID, p_lookback: "7 days" }
      );

      if (openErr) {
        console.warn(`[ef_atms_monitor] Could not load existing alerts: ${openErr.message}`);
        // Non-fatal — proceed without deduplication
      } else {
        existingAlerts = new Set(
          (openAlerts ?? []).map(
            (a: { customer_id: number; rule_code: string }) =>
              `${a.customer_id}::${a.rule_code}`
          )
        );
      }
    }

    console.log(`[ef_atms_monitor] ${existingAlerts.size} existing open alert(s) found (dedup)`);

    // ── Step 3: Insert new alerts (skip duplicates) ───────────────────────
    for (const v of allViolations) {
      const key = `${v.customer_id}::${v.rule_code}`;

      // Track per-rule stats
      if (!result.by_rule[v.rule_code]) {
        result.by_rule[v.rule_code] = { found: 0, inserted: 0 };
      }
      result.by_rule[v.rule_code].found++;

      if (!force && existingAlerts.has(key)) {
        result.deduplicated++;
        console.log(`[ef_atms_monitor] Skipping duplicate: ${key}`);
        continue;
      }

      // Insert the alert into fic.compliance_alerts
      const { error: insertErr } = await sb
        .schema("fic")
        .from("compliance_alerts")
        .insert({
          org_id:      ORG_ID,
          customer_id: v.customer_id,
          alert_type:  "atms",
          rule_code:   v.rule_code,
          severity:    v.severity,
          status:      "pending",
          description: v.description,
          context:     v.context,
        });

      if (insertErr) {
        const errMsg = `Failed to insert alert ${key}: ${insertErr.message}`;
        console.error(`[ef_atms_monitor] ${errMsg}`);
        result.errors.push(errMsg);
      } else {
        result.new_alerts_created++;
        result.by_rule[v.rule_code].inserted++;
        console.log(`[ef_atms_monitor] Alert created: ${key} — ${v.severity.toUpperCase()}`);
      }
    }

    // ── Step 4: Log to lth_pvr.alert_events if new alerts were raised ────
    if (result.new_alerts_created > 0) {
      const summary = Object.entries(result.by_rule)
        .filter(([, s]) => s.inserted > 0)
        .map(([rule, s]) => `${rule}:${s.inserted}`)
        .join(", ");

      await sb.schema("lth_pvr").from("alert_events").insert({
        org_id:     ORG_ID,
        component:  "ef_atms_monitor",
        severity:   result.by_rule["ATMS-07"]?.inserted > 0 || result.by_rule["ATMS-03"]?.inserted > 0
          ? "critical"
          : "warn",
        message:    `ATMS raised ${result.new_alerts_created} new compliance alert(s): ${summary}`,
        context:    result.by_rule,
      });
    }

    const message = result.new_alerts_created > 0
      ? `ATMS complete — ${result.new_alerts_created} new alert(s) raised, ${result.deduplicated} deduplicated`
      : `ATMS complete — all ${result.deduplicated} violation(s) already alerted (dedup)`;

    return successResponse(result, startTime, message);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ef_atms_monitor] Fatal error: ${message}`);

    // Log operational failure to alert_events
    await sb.schema("lth_pvr").from("alert_events").insert({
      org_id:    ORG_ID,
      component: "ef_atms_monitor",
      severity:  "error",
      message:   `ATMS monitor failed: ${message}`,
      context:   { error: message },
    }).catch(() => { /* swallow secondary write error */ });

    return new Response(
      JSON.stringify({
        success:      false,
        error:        message,
        elapsed_ms:   Date.now() - startTime,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function successResponse(result: RunResult, startTime: number, message: string): Response {
  return new Response(
    JSON.stringify({
      success:    true,
      message,
      elapsed_ms: Date.now() - startTime,
      ...result,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
