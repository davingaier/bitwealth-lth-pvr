// ef_fetch_onchain_pvr/index.ts
// ===========================================================================
// On-Chain Charts data engine — STH/LTH Profit-to-Volatility Ratio (PVR).
//
// PVR for a holder cohort = unrealised profit / expanding-window volatility of
// that cohort's market cap:
//
//     mc  = supply * price
//     rc  = supply * realized_price
//     pvr = (mc - rc) / expanding_std(mc)      (Welford online std, ddof=1)
//
// Applied independently to STH (<155d) and LTH (155d+) using Research Bitcoin
// endpoints:
//     price/price
//     supply_distribution/supply_sth   |  supply_distribution/supply_lth
//     realizedprice/realized_price_sth |  realizedprice/realized_price_lth
//
// Derived series:
//     pvr_ratio      = sth_pvr / lth_pvr
//     pvr_divergence = sth_pvr - lth_pvr
//
// Modes (JSON body):
//   { "backfill": true, "from": "2010-07-01" }  → recompute full history
//   { }                                          → daily append (last_date+1 → yesterday)
//
// Results are stored in lth_pvr.onchain_pvr_daily; the running Welford state
// lives in lth_pvr.onchain_pvr_state.
//
// The RB API token is read from lth_pvr.rb_api_token (managed by
// ef_renew_rb_token) — never taken from an env secret.
// ===========================================================================

import { getServiceClient, sleep } from "./client.ts";

const RB_BASE = "https://api.researchbitcoin.net";
const ORG_FALLBACK = "b0a77009-03b9-44a1-ae1d-34f157d44a8b";
const DEFAULT_HISTORY_START = "2010-07-01";

// ---------------------------------------------------------------------------
// Welford online algorithm (sample std, ddof=1)
// ---------------------------------------------------------------------------
interface Welford {
  n: number;
  mean: number;
  m2: number;
}

function welfordUpdate(s: Welford, x: number): Welford {
  const n = s.n + 1;
  const delta = x - s.mean;
  const mean = s.mean + delta / n;
  const delta2 = x - mean;
  return { n, mean, m2: s.m2 + delta * delta2 };
}

function welfordStd(s: Welford): number {
  if (s.n < 2) return 0;
  return Math.sqrt(s.m2 / (s.n - 1));
}

// ---------------------------------------------------------------------------
// Research Bitcoin range fetch — returns Map<YYYY-MM-DD, number>
// ---------------------------------------------------------------------------
async function rbFetchRange(
  rbToken: string,
  category: string,
  dataField: string,
  fromDate: string,
  toDate: string,
): Promise<Map<string, number>> {
  const params = new URLSearchParams({
    resolution: "d1",
    from_time: fromDate,
    to_time: toDate,
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
      const lines = text.trim().split("\n");
      const out = new Map<string, number>();
      // Skip header line (index 0)
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (cols.length < 2) continue;
        const day = cols[0].slice(0, 10); // YYYY-MM-DD
        const val = parseFloat(cols[1]);
        if (Number.isFinite(val)) out.set(day, val);
      }
      return out;
    } catch (e) {
      lastErr = e;
      console.warn(`RB ${category}/${dataField} attempt ${attempt + 1}/4 failed: ${String(e)}`);
      if (attempt < 3) {
        await sleep(wait);
        wait = Math.min(wait * 2, 15000);
      }
    }
  }
  throw new Error(`RB fetch failed after 4 attempts: ${category}/${dataField} – ${String(lastErr)}`);
}

// ---------------------------------------------------------------------------
// Alert helper
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
      component: "ef_fetch_onchain_pvr",
      severity,
      message,
      context,
    };
    if (orgId) payload.org_id = orgId;
    await sb.schema("public").from("alert_events").insert(payload);
  } catch (e) {
    console.error("ef_fetch_onchain_pvr: alert_events insert failed", e);
  }
}

// ---------------------------------------------------------------------------
// Row shape for upsert
// ---------------------------------------------------------------------------
interface PvrRow {
  org_id: string;
  date: string;
  btc_price: number;
  sth_supply: number;
  sth_realized_price: number;
  lth_supply: number;
  lth_realized_price: number;
  sth_pvr: number | null;
  lth_pvr: number | null;
  pvr_ratio: number | null;
  pvr_divergence: number | null;
  computed_at: string;
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

// Build PVR rows by walking dates in order, advancing the Welford state.
// Mutates `sthW` / `lthW` in place-by-return. Returns { rows, sthW, lthW }.
function computeRows(
  org_id: string,
  dates: string[],
  price: Map<string, number>,
  sthSupply: Map<string, number>,
  sthRp: Map<string, number>,
  lthSupply: Map<string, number>,
  lthRp: Map<string, number>,
  sthW0: Welford,
  lthW0: Welford,
): { rows: PvrRow[]; sthW: Welford; lthW: Welford } {
  const rows: PvrRow[] = [];
  let sthW = sthW0;
  let lthW = lthW0;
  const nowIso = new Date().toISOString();

  for (const d of dates) {
    const p = price.get(d);
    const ss = sthSupply.get(d);
    const sr = sthRp.get(d);
    const ls = lthSupply.get(d);
    const lr = lthRp.get(d);

    // Require all five inputs present and strictly positive (0.0 = no data yet).
    if (!p || !ss || !sr || !ls || !lr) continue;

    const sthMc = ss * p;
    const lthMc = ls * p;
    const sthRc = ss * sr;
    const lthRc = ls * lr;

    sthW = welfordUpdate(sthW, sthMc);
    lthW = welfordUpdate(lthW, lthMc);

    const sthStd = welfordStd(sthW);
    const lthStd = welfordStd(lthW);

    let sthPvr: number | null = null;
    let lthPvr: number | null = null;
    let ratio: number | null = null;
    let divergence: number | null = null;

    if (sthStd > 0) sthPvr = round6((sthMc - sthRc) / sthStd);
    if (lthStd > 0) lthPvr = round6((lthMc - lthRc) / lthStd);
    if (sthPvr !== null && lthPvr !== null) {
      divergence = round6(sthPvr - lthPvr);
      // Guard divide-by-near-zero: leave ratio null when LTH PVR is ~0.
      if (Math.abs(lthPvr) > 1e-6) ratio = round6(sthPvr / lthPvr);
    }

    rows.push({
      org_id,
      date: d,
      btc_price: p,
      sth_supply: ss,
      sth_realized_price: sr,
      lth_supply: ls,
      lth_realized_price: lr,
      sth_pvr: sthPvr,
      lth_pvr: lthPvr,
      pvr_ratio: ratio,
      pvr_divergence: divergence,
      computed_at: nowIso,
    });
  }

  return { rows, sthW, lthW };
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
    ORG_FALLBACK;

  const isBackfill = body.backfill === true;

  // ---- Load RB API token ----------------------------------------------------
  const { data: tokenRow, error: tokenErr } = await sb
    .schema("lth_pvr")
    .from("rb_api_token")
    .select("token")
    .eq("org_id", org_id)
    .maybeSingle();

  if (tokenErr || !tokenRow?.token) {
    await logAlert(sb, "critical", "rb_api_token not found for on-chain PVR fetch",
      { org_id, error: tokenErr?.message }, org_id);
    return new Response("rb_api_token not found", { status: 500 });
  }
  const rbToken = tokenRow.token as string;

  // ---- Load Welford state ---------------------------------------------------
  const { data: stateRow, error: stateErr } = await sb
    .schema("lth_pvr")
    .from("onchain_pvr_state")
    .select("sth_n, sth_mean, sth_m2, lth_n, lth_mean, lth_m2, last_date")
    .eq("org_id", org_id)
    .maybeSingle();

  if (stateErr) {
    await logAlert(sb, "error", "onchain_pvr_state read failed",
      { org_id, error: stateErr.message }, org_id);
    return new Response("state read failed", { status: 500 });
  }

  let sthW: Welford = {
    n: Number(stateRow?.sth_n ?? 0),
    mean: Number(stateRow?.sth_mean ?? 0),
    m2: Number(stateRow?.sth_m2 ?? 0),
  };
  let lthW: Welford = {
    n: Number(stateRow?.lth_n ?? 0),
    mean: Number(stateRow?.lth_mean ?? 0),
    m2: Number(stateRow?.lth_m2 ?? 0),
  };

  // ---- Determine date window ------------------------------------------------
  const nowUTC = new Date();
  const todayUTC = Date.UTC(nowUTC.getUTCFullYear(), nowUTC.getUTCMonth(), nowUTC.getUTCDate());
  const yesterday = new Date(todayUTC - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // RB requires to_time > from_time; use today as an exclusive upper bound.
  const toTime = new Date(todayUTC).toISOString().slice(0, 10);

  let fromDate: string;
  if (isBackfill) {
    // Reset state on a full backfill so the expanding std starts clean.
    fromDate = (typeof body.from === "string" && body.from) || DEFAULT_HISTORY_START;
    sthW = { n: 0, mean: 0, m2: 0 };
    lthW = { n: 0, mean: 0, m2: 0 };
  } else {
    const lastDate = stateRow?.last_date as string | null;
    if (!lastDate) {
      return new Response(
        JSON.stringify({ error: "no state — run with { backfill: true } first" }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    }
    const next = new Date(lastDate + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    fromDate = next.toISOString().slice(0, 10);
    if (fromDate > yesterday) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "up_to_date", last_date: lastDate }),
        { headers: { "content-type": "application/json" } },
      );
    }
  }

  console.info(`ef_fetch_onchain_pvr: mode=${isBackfill ? "backfill" : "daily"} from=${fromDate} to=${yesterday}`);

  // ---- Fetch all five RB series in parallel ---------------------------------
  let price: Map<string, number>;
  let sthSupply: Map<string, number>;
  let sthRp: Map<string, number>;
  let lthSupply: Map<string, number>;
  let lthRp: Map<string, number>;
  try {
    [price, sthSupply, sthRp, lthSupply, lthRp] = await Promise.all([
      rbFetchRange(rbToken, "price", "price", fromDate, toTime),
      rbFetchRange(rbToken, "supply_distribution", "supply_sth", fromDate, toTime),
      rbFetchRange(rbToken, "realizedprice", "realized_price_sth", fromDate, toTime),
      rbFetchRange(rbToken, "supply_distribution", "supply_lth", fromDate, toTime),
      rbFetchRange(rbToken, "realizedprice", "realized_price_lth", fromDate, toTime),
    ]);
  } catch (e) {
    await logAlert(sb, "error", "RB API fetch failed in ef_fetch_onchain_pvr",
      { org_id, from: fromDate, to: yesterday, error: String((e as Error)?.message ?? e) }, org_id);
    return new Response("RB fetch failed", { status: 502 });
  }

  // ---- Build ordered date list (only <= yesterday) --------------------------
  const dates = Array.from(price.keys())
    .filter((d) => d <= yesterday && d >= fromDate)
    .sort();

  const { rows, sthW: sthWFinal, lthW: lthWFinal } = computeRows(
    org_id, dates, price, sthSupply, sthRp, lthSupply, lthRp, sthW, lthW,
  );

  if (rows.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, rows_written: 0, reason: "no_complete_days" }),
      { headers: { "content-type": "application/json" } },
    );
  }

  // ---- Upsert rows in batches ----------------------------------------------
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error: upErr } = await sb
      .schema("lth_pvr")
      .from("onchain_pvr_daily")
      .upsert(chunk, { onConflict: "org_id,date" });
    if (upErr) {
      await logAlert(sb, "error", "onchain_pvr_daily upsert failed",
        { org_id, batch_start: i, error: upErr.message }, org_id);
      return new Response(upErr.message, { status: 500 });
    }
  }

  // ---- Persist Welford state ------------------------------------------------
  const lastDate = rows[rows.length - 1].date;
  const { error: stErr } = await sb
    .schema("lth_pvr")
    .from("onchain_pvr_state")
    .upsert({
      org_id,
      sth_n: sthWFinal.n,
      sth_mean: sthWFinal.mean,
      sth_m2: sthWFinal.m2,
      lth_n: lthWFinal.n,
      lth_mean: lthWFinal.mean,
      lth_m2: lthWFinal.m2,
      last_date: lastDate,
      updated_at: new Date().toISOString(),
    }, { onConflict: "org_id" });

  if (stErr) {
    await logAlert(sb, "warn", "onchain_pvr_state update failed after upsert",
      { org_id, error: stErr.message }, org_id);
  }

  console.info(`ef_fetch_onchain_pvr: wrote ${rows.length} rows, last_date=${lastDate}, lth_n=${lthWFinal.n}`);

  return new Response(
    JSON.stringify({
      ok: true,
      mode: isBackfill ? "backfill" : "daily",
      rows_written: rows.length,
      last_date: lastDate,
      sth_n: sthWFinal.n,
      lth_n: lthWFinal.n,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
