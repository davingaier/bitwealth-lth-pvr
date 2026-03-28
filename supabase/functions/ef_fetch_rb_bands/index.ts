// ef_fetch_rb_bands/index.ts
// ===========================================================
// Fetches daily LTH metrics from Research Bitcoin API and
// computes LTH PVR band prices using the same formula as
// ChartInspect.  Results are stored in lth_pvr.rb_bands_daily
// alongside lth_pvr.ci_bands_daily for comparison.
//
// Production hybrid approach (validated <0.2% error):
//   1. pvr_mean, pvr_std are FIXED constants seeded from CI
//      (ChartInspect's static-mode global statistics).
//   2. cumulative_std_dev is updated daily via Welford's
//      online algorithm, seeded from CI's known value.
//   3. Band prices: price_at_X = (pvr_target × cum_std + lth_rc) / lth_supply
//
// Environment variables required:
//   SUPABASE_URL           — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — Service role key
//   ORG_ID                 — Organisation UUID
//
// NOTE: The Research Bitcoin API token is stored in lth_pvr.rb_api_token
// and is renewed automatically by ef_renew_rb_token (runs at 00:03 UTC).
// The RB_API_TOKEN env secret is no longer used.
// ===========================================================

import { getServiceClient, sleep } from "./client.ts";

const RB_BASE = "https://api.researchbitcoin.net";

// Band sigma multipliers — must stay in sync with ci_bands_daily column suffixes
const BAND_MULTIPLIERS: Record<string, number> = {
  m100: -1.00,
  m075: -0.75,
  m050: -0.50,
  m025: -0.25,
  mean:  0.00,
  p050: +0.50,
  p100: +1.00,
  p150: +1.50,
  p200: +2.00,
  p250: +2.50,
};

// ---------------------------------------------------------------------------
// Research Bitcoin CSV fetch helpers
// ---------------------------------------------------------------------------

async function rbFetch(
  rbToken: string,
  category: string,
  dataField: string,
  date: string,
): Promise<number | null> {
  /**
   * Fetch a single daily value from the Research Bitcoin API.
   * The API returns CSV: `time,<dataField>`.
   * Note: the API requires to_time > from_time, so we pass the next day
   * as to_time and take the first data row (which will be for `date`).
   * Returns the value for `date`, or null if not found.
   */
  const nextDay = new Date(date);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const toTime = nextDay.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    resolution: "d1",
    from_time: date,
    to_time: toTime,
  });
  const url = `${RB_BASE}/v2/${category}/${dataField}?${params}`;

  let lastErr: unknown = null;
  let wait = 2000;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { "X-API-Token": rbToken, "Accept": "text/csv" },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
      }
      const text = await resp.text();
      // Parse CSV: skip header line, parse first data row
      const lines = text.trim().split("\n");
      if (lines.length < 2) return null;
      const cols = lines[1].split(",");
      if (cols.length < 2) return null;
      const val = parseFloat(cols[1]);
      return Number.isFinite(val) ? val : null;
    } catch (e) {
      lastErr = e;
      console.warn(
        `RB ${category}/${dataField} attempt ${attempt + 1}/4 failed: ${String(e)}`,
      );
      if (attempt < 3) {
        await sleep(wait);
        wait = Math.min(wait * 2, 15000);
      }
    }
  }
  throw new Error(
    `RB fetch failed after 4 attempts: ${category}/${dataField} – ${String(lastErr)}`,
  );
}

// ---------------------------------------------------------------------------
// Alert helper (inline — same as ef_fetch_ci_bands pattern)
// ---------------------------------------------------------------------------

async function logAlert(
  sb: ReturnType<typeof getServiceClient>,
  severity: "info" | "warn" | "error" | "critical",
  message: string,
  context: Record<string, unknown> = {},
  orgId?: string | null,
) {
  try {
    const payload: Record<string, unknown> = {
      component: "ef_fetch_rb_bands",
      severity,
      message,
      context,
    };
    if (orgId) payload.org_id = orgId;
    await sb.schema("lth_pvr").from("alert_events").insert(payload);
  } catch (e) {
    console.error("ef_fetch_rb_bands: alert_events insert failed", e);
  }
}

// ---------------------------------------------------------------------------
// Welford online-algorithm helpers
// ---------------------------------------------------------------------------

interface WelfordState {
  n: number;
  mean: number;
  m2: number;
}

/** Add one new observation to the Welford running state. */
function welfordUpdate(state: WelfordState, x: number): WelfordState {
  const n = state.n + 1;
  const delta = x - state.mean;
  const mean = state.mean + delta / n;
  const delta2 = x - mean;
  const m2 = state.m2 + delta * delta2;
  return { n, mean, m2 };
}

/** Compute std dev (ddof=1) from Welford state. */
function welfordStd(state: WelfordState): number {
  if (state.n < 2) return 0;
  return Math.sqrt(state.m2 / (state.n - 1));
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const sb = getServiceClient();

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const org_id =
    (typeof body.org_id === "string" && body.org_id) ||
    Deno.env.get("ORG_ID") ||
    null;

  // ---- Validate prerequisites -----------------------------------------------
  if (!org_id) {
    return new Response("missing org_id (set ORG_ID secret or pass in payload)", {
      status: 400,
      headers: { "content-type": "text/plain" },
    });
  }

  // ---- Load RB API token from DB (managed by ef_renew_rb_token) ------------
  const { data: tokenRow, error: tokenErr } = await sb
    .schema("lth_pvr")
    .from("rb_api_token")
    .select("token, expires_at")
    .eq("org_id", org_id)
    .maybeSingle();

  if (tokenErr || !tokenRow?.token) {
    await logAlert(sb, "critical",
      "rb_api_token not found — run migration create_rb_api_token_table",
      { org_id, error: tokenErr?.message }, org_id);
    return new Response("rb_api_token not found", { status: 500 });
  }

  const rbToken = tokenRow.token;

  // ---- Determine target date (yesterday UTC, same as ef_fetch_ci_bands) -----
  const nowUTC = new Date();
  const todayUTC = Date.UTC(nowUTC.getUTCFullYear(), nowUTC.getUTCMonth(), nowUTC.getUTCDate());
  const targetDate = new Date(todayUTC - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Allow explicit override via payload (for back-fill / manual runs)
  const overrideDate = typeof body.date === "string" ? body.date : null;
  const signalDate = overrideDate ?? targetDate;

  console.info("ef_fetch_rb_bands: signal_date =", signalDate);

  // ---- Idempotency check: skip if already stored ----------------------------
  if (!body.force) {
    const { data: existing } = await sb.schema("lth_pvr")
      .from("rb_bands_daily")
      .select("date")
      .eq("org_id", org_id)
      .eq("date", signalDate)
      .eq("mode", "static")
      .maybeSingle();

    if (existing) {
      console.info("ef_fetch_rb_bands: row already exists for", signalDate, "— skipping");
      return new Response(
        JSON.stringify({ skipped: true, date: signalDate, reason: "already_stored" }),
        { headers: { "content-type": "application/json" } },
      );
    }
  }

  // ---- Load Welford state from rb_bands_state --------------------------------
  const { data: stateRow, error: stateErr } = await sb.schema("lth_pvr")
    .from("rb_bands_state")
    .select("pvr_mean, pvr_std, mc_n, mc_mean, mc_m2, last_date")
    .eq("org_id", org_id)
    .maybeSingle();

  if (stateErr || !stateRow) {
    await logAlert(sb, "critical",
      "rb_bands_state not seeded for org — run migration 20260328_create_rb_bands_tables",
      { org_id, error: stateErr?.message }, org_id);
    return new Response("rb_bands_state not initialised", { status: 500 });
  }

  const pvr_mean = Number(stateRow.pvr_mean);
  const pvr_std  = Number(stateRow.pvr_std);
  let welford: WelfordState = {
    n:    Number(stateRow.mc_n),
    mean: Number(stateRow.mc_mean),
    m2:   Number(stateRow.mc_m2),
  };

  // ---- Fetch from Research Bitcoin API ---------------------------------------
  console.info("ef_fetch_rb_bands: fetching RB data for", signalDate);

  let lthSupply: number | null = null;
  let lthRp: number | null = null;
  let btcPrice: number | null = null;

  try {
    [lthSupply, lthRp, btcPrice] = await Promise.all([
      rbFetch(rbToken, "supply_distribution", "supply_lth",      signalDate),
      rbFetch(rbToken, "realizedprice",        "realized_price_lth", signalDate),
      rbFetch(rbToken, "price",                "price",              signalDate),
    ]);
  } catch (e) {
    await logAlert(sb, "error", "RB API fetch failed in ef_fetch_rb_bands",
      { org_id, signal_date: signalDate, error: String((e as Error)?.message ?? e) }, org_id);
    return new Response("RB fetch failed", { status: 502 });
  }

  if (!lthSupply || !lthRp || !btcPrice) {
    await logAlert(sb, "warn",
      "RB API returned null/zero for one or more metrics",
      { org_id, signal_date: signalDate, lthSupply, lthRp, btcPrice }, org_id);
    return new Response("RB data incomplete", { status: 502 });
  }

  console.info("ef_fetch_rb_bands: RB data OK",
    { supply: lthSupply, rp: lthRp, price: btcPrice });

  // ---- Update Welford state with today's LTH market cap --------------------
  const lthMc = lthSupply * btcPrice;
  const newWelford = welfordUpdate(welford, lthMc);
  const cumStd = welfordStd(newWelford);

  if (cumStd <= 0) {
    await logAlert(sb, "error",
      "cumulative_std_dev is zero or negative after Welford update",
      { org_id, signal_date: signalDate, lthMc, welford_n: newWelford.n }, org_id);
    return new Response("Welford state error", { status: 500 });
  }

  // ---- Compute band price levels -------------------------------------------
  const lthRc = lthSupply * lthRp;
  const record: Record<string, unknown> = {
    org_id,
    date: signalDate,
    mode: "static",
    btc_price: btcPrice,
    fetched_at: new Date().toISOString(),
    source_hash: crypto.randomUUID(),
  };

  for (const [key, mult] of Object.entries(BAND_MULTIPLIERS)) {
    const pvrTarget = pvr_mean + mult * pvr_std;
    const bandPrice = (pvrTarget * cumStd + lthRc) / lthSupply;
    // Round to 2 decimal places to match numeric(38,2) column type
    record[`price_at_${key}`] = Math.round(bandPrice * 100) / 100;
  }

  console.info("ef_fetch_rb_bands: computed bands for", signalDate, {
    cumStd: cumStd.toFixed(2),
    price_at_mean: record["price_at_mean"],
    price_at_p100: record["price_at_p100"],
  });

  // ---- Upsert to rb_bands_daily --------------------------------------------
  const { error: upsertErr } = await sb.schema("lth_pvr")
    .from("rb_bands_daily")
    .upsert(record, { onConflict: "org_id,date,mode" });

  if (upsertErr) {
    await logAlert(sb, "error", "rb_bands_daily upsert failed",
      { org_id, signal_date: signalDate, error: upsertErr.message }, org_id);
    return new Response(upsertErr.message, { status: 500 });
  }

  // ---- Persist updated Welford state to rb_bands_state ---------------------
  const { error: stateUpdateErr } = await sb.schema("lth_pvr")
    .from("rb_bands_state")
    .update({
      mc_n:      newWelford.n,
      mc_mean:   newWelford.mean,
      mc_m2:     newWelford.m2,
      last_date: signalDate,
    })
    .eq("org_id", org_id);

  if (stateUpdateErr) {
    // Non-fatal: the band row was already stored, but log the warning
    await logAlert(sb, "warn", "rb_bands_state update failed after successful upsert",
      { org_id, signal_date: signalDate, error: stateUpdateErr.message }, org_id);
  }

  console.info("ef_fetch_rb_bands: complete for", signalDate);
  return new Response(
    JSON.stringify({
      ok: true,
      date: signalDate,
      cumulative_std_dev: cumStd,
      welford_n: newWelford.n,
      bands: Object.fromEntries(
        Object.keys(BAND_MULTIPLIERS).map((k) => [k, record[`price_at_${k}`]]),
      ),
    }),
    { headers: { "content-type": "application/json" } },
  );
});
