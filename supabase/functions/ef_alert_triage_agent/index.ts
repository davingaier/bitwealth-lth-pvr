// deno-lint-ignore-file no-explicit-any
// ef_alert_triage_agent — AI-powered root-cause analysis for actionable alerts.
//
// Flow:
//   1. Pop next pending row from public.alert_triage_queue (FIFO).
//   2. Confirm public.ai_agent_under_cap() — bail early if disabled / over cap.
//   3. Build evidence bundle: alert row + dedup-history (last 7d) + recent
//      ledger lines (if customer_id present) + recent same-component alerts.
//   4. Call Anthropic Messages API (claude-haiku-4-5 by default) with a
//      structured JSON-schema response.
//   5. Cost the call, record spend via ai_agent_record_spend(), insert proposal
//      into public.alert_triage_proposals, mark queue row done.
//
// Triggered by pg_cron every 5 min OR called manually for testing.
//
// Env vars required:
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY    (standard)
//   ORG_ID                                      (multi-tenant filter)
//   ANTHROPIC_API_KEY                           (https://console.anthropic.com)
// Optional:
//   AI_AGENT_BATCH_SIZE        default 3 alerts per invocation
//   AI_AGENT_MODEL_OVERRIDE    overrides public.ai_agent_config 'model' value

import { getServiceClient } from "./client.ts";

const ANTHROPIC_URL  = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VER  = "2023-06-01";

// Pricing (USD per million tokens) — keep in sync with provider docs.
// Used only for spend tracking; agent will not block if pricing missing.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5":   { input: 1.00, output: 5.00 },
  "claude-sonnet-4-5":  { input: 3.00, output: 15.00 },
  "claude-3-5-haiku-latest":  { input: 0.80, output: 4.00 },
  "claude-3-5-sonnet-latest": { input: 3.00, output: 15.00 },
};

const RESPONSE_SCHEMA_HINT = `Respond with ONLY a JSON object matching this exact shape (no markdown, no prose outside JSON):
{
  "root_cause": "<concise explanation of the most likely root cause>",
  "severity_assessment": "<is this severity correct? higher? lower? why?>",
  "proposed_fix": "<concrete actionable fix — code change, config, or operational step>",
  "confidence": "low|medium|high",
  "files_to_touch": ["<repo-relative path>", ...]   // empty array if no code change
}`;

type Alert = {
  alert_id: string;
  org_id: string | null;
  customer_id: number | null;
  portfolio_id: string | null;
  severity: string;
  component: string;
  message: string;
  context: any;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  created_at: string;
};

async function buildEvidence(sb: any, alert: Alert) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: relatedAlerts } = await sb
    .from("alert_events")
    .select("alert_id, severity, message, occurrence_count, first_seen_at, last_seen_at, resolved_at, resolution_note")
    .eq("component", alert.component)
    .gte("last_seen_at", sevenDaysAgo)
    .neq("alert_id", alert.alert_id)
    .order("last_seen_at", { ascending: false })
    .limit(15);

  let recentLedger: any[] = [];
  if (alert.customer_id) {
    const { data } = await sb
      .schema("lth_pvr")
      .from("ledger_lines")
      .select("ledger_id, trade_date, kind, amount_btc, amount_usdt, note")
      .eq("customer_id", alert.customer_id)
      .gte("trade_date", sevenDaysAgo.slice(0, 10))
      .order("trade_date", { ascending: false })
      .limit(20);
    recentLedger = data ?? [];
  }

  let customerStrategy: any = null;
  if (alert.customer_id) {
    const { data } = await sb
      .from("customer_strategies")
      .select("customer_id, strategy_id, account_model, platform_fee_rate, platform_fee_schedule, performance_fee_rate, performance_fee_schedule")
      .eq("customer_id", alert.customer_id)
      .maybeSingle();
    customerStrategy = data;
  }

  return {
    alert: {
      alert_id: alert.alert_id,
      severity: alert.severity,
      component: alert.component,
      message: alert.message,
      context: alert.context,
      first_seen_at: alert.first_seen_at,
      last_seen_at: alert.last_seen_at,
      occurrence_count: alert.occurrence_count,
    },
    customer_strategy: customerStrategy,
    recent_ledger_lines: recentLedger,
    recent_alerts_same_component: relatedAlerts ?? [],
  };
}

function buildPrompt(evidence: any): string {
  return `You are an SRE assistant for the BitWealth LTH PVR Bitcoin DCA platform (Supabase + Deno edge functions + VALR exchange integration).

A new actionable alert was raised. Your job: identify the most likely root cause and propose a concrete fix.

ALERT:
${JSON.stringify(evidence.alert, null, 2)}

CUSTOMER STRATEGY (if applicable):
${JSON.stringify(evidence.customer_strategy, null, 2)}

RECENT LEDGER LINES FOR THIS CUSTOMER (last 7d, max 20):
${JSON.stringify(evidence.recent_ledger_lines, null, 2)}

OTHER RECENT ALERTS FROM SAME COMPONENT (last 7d, max 15):
${JSON.stringify(evidence.recent_alerts_same_component, null, 2)}

Important context about the platform:
- Schemas: public (shared), lth_pvr (live trading), lth_pvr_bt (back-testing).
- Customers have account_model in {subaccount, api}; subaccount routes via VALR sub-account, api routes via direct API key.
- Fee schedules: immediate, monthly, annual. Platform/performance fees can be on different schedules per customer.
- Edge functions follow naming ef_*; shared helpers in supabase/functions/_shared/.
- Alerts use a dedup trigger (md5 of component+severity+org+customer+portfolio+message); occurrence_count rises when the same dedup key re-fires.
- Pipeline functions run on pg_cron between 03:00–17:00 UTC; outside this window write_window guards trip.

${RESPONSE_SCHEMA_HINT}`;
}

async function callAnthropic(model: string, prompt: string) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type":         "application/json",
      "x-api-key":            apiKey,
      "anthropic-version":    ANTHROPIC_VER,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const text = await resp.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!resp.ok) {
    throw new Error(`Anthropic ${resp.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

function extractJsonContent(anthropicResponse: any): any {
  const block = (anthropicResponse?.content ?? []).find((c: any) => c.type === "text");
  const raw   = block?.text ?? "";
  // Strip ```json fences if model added them
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract first {...} block
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return ((inputTokens * p.input) + (outputTokens * p.output)) / 1_000_000;
}

async function processOne(sb: any, model: string): Promise<{ status: string; detail: any }> {
  // 1. Atomically claim oldest pending row via RPC (FOR UPDATE SKIP LOCKED inside)
  const { data: claimed, error: claimErr } = await sb.rpc("claim_next_triage_alert");
  if (claimErr) throw new Error(`claim error: ${claimErr.message}`);
  const queueRow = Array.isArray(claimed) && claimed.length > 0 ? claimed[0] : null;
  if (!queueRow) return { status: "idle", detail: "no pending alerts" };

  try {
    // 2. Load alert details
    const { data: alertRow, error: alertErr } = await sb
      .from("alert_events")
      .select("alert_id, org_id, customer_id, portfolio_id, severity, component, message, context, first_seen_at, last_seen_at, occurrence_count, created_at")
      .eq("alert_id", queueRow.alert_id)
      .single();
    if (alertErr || !alertRow) throw new Error(`alert load failed: ${alertErr?.message}`);

    const evidence = await buildEvidence(sb, alertRow as Alert);
    const prompt   = buildPrompt(evidence);

    // 3. Call LLM
    const llmResp  = await callAnthropic(model, prompt);
    const usage    = llmResp?.usage ?? {};
    const inTok    = Number(usage.input_tokens  ?? 0);
    const outTok   = Number(usage.output_tokens ?? 0);
    const costUsd  = calcCostUsd(model, inTok, outTok);

    // 4. Record spend
    await sb.rpc("ai_agent_record_spend", { p_amount_usd: costUsd });

    // 5. Parse JSON content
    const proposal = extractJsonContent(llmResp) ?? {
      root_cause: "LLM did not return parseable JSON",
      severity_assessment: "unknown",
      proposed_fix: "Manual review required — see raw_response.",
      confidence: "low",
      files_to_touch: [],
    };

    // 6. Insert proposal
    const { data: inserted, error: insErr } = await sb
      .from("alert_triage_proposals")
      .insert({
        alert_id:            queueRow.alert_id,
        queue_id:            queueRow.queue_id,
        model,
        prompt_tokens:       inTok,
        completion_tokens:   outTok,
        cost_usd:            costUsd,
        root_cause:          proposal.root_cause ?? null,
        severity_assessment: proposal.severity_assessment ?? null,
        proposed_fix:        proposal.proposed_fix ?? null,
        confidence:          proposal.confidence ?? null,
        files_to_touch:      Array.isArray(proposal.files_to_touch) ? proposal.files_to_touch : null,
        evidence_bundle:     evidence,
        raw_response:        llmResp,
      })
      .select("proposal_id")
      .single();
    if (insErr) throw new Error(`proposal insert: ${insErr.message}`);

    // 7. Mark queue row done
    await sb
      .from("alert_triage_queue")
      .update({ status: "done", processed_at: new Date().toISOString() })
      .eq("queue_id", queueRow.queue_id);

    return { status: "ok", detail: { proposal_id: inserted.proposal_id, cost_usd: costUsd } };
  } catch (e) {
    await sb
      .from("alert_triage_queue")
      .update({
        status:       "error",
        processed_at: new Date().toISOString(),
        last_error:   String((e as Error).message ?? e).slice(0, 1000),
      })
      .eq("queue_id", queueRow.queue_id);
    return { status: "error", detail: String((e as Error).message ?? e) };
  }
}

Deno.serve(async () => {
  try {
    const sb = getServiceClient();

    // Cap check
    const { data: capOk, error: capErr } = await sb.rpc("ai_agent_under_cap");
    if (capErr) {
      return new Response(`cap check failed: ${capErr.message}`, { status: 500 });
    }
    if (!capOk) {
      return new Response(JSON.stringify({ status: "skipped", reason: "agent disabled or over daily cap" }), {
        headers: { "content-type": "application/json" },
      });
    }

    // Resolve model
    const { data: cfgRows } = await sb.from("ai_agent_config").select("key, value");
    const cfg: Record<string, string> = Object.fromEntries((cfgRows ?? []).map((r: any) => [r.key, r.value]));
    const model = Deno.env.get("AI_AGENT_MODEL_OVERRIDE") || cfg.model || "claude-haiku-4-5";

    const batchSize = Number(Deno.env.get("AI_AGENT_BATCH_SIZE") ?? 3);
    const results: any[] = [];
    for (let i = 0; i < batchSize; i++) {
      const r = await processOne(sb, model);
      results.push(r);
      if (r.status === "idle") break;
      // Re-check cap mid-batch in case we crossed it
      const { data: stillOk } = await sb.rpc("ai_agent_under_cap");
      if (!stillOk) break;
    }

    return new Response(JSON.stringify({ model, results }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("ef_alert_triage_agent fatal:", e);
    return new Response(`fatal: ${(e as Error).message ?? String(e)}`, { status: 500 });
  }
});
