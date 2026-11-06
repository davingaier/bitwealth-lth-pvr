import { getServiceKey } from "../_shared/supabaseKeys.ts";
// ef_fetch_onchain_pvr/index.ts
// ===========================================================================
// On-Chain Charts data engine — STH/LTH PVR, LTH MVRV Z-Score, CVDD.
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
//     cvdd           = cumulative USD value coin-days destroyed / market age / 6,000,000
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
import { refreshSthCbBands } from "../_shared/sth_cb_bands_db.ts";
import { requireOrgAdminAuto, unauthorizedResponse } from "../_shared/adminAuth.ts";

const RB_BASE = "https://api.researchbitcoin.net";
const ORG_FALLBACK = "b0a77009-03b9-44a1-ae1d-34f157d44a8b";
const DEFAULT_HISTORY_START = "2010-07-01";
const BITCOIN_GENESIS_DATE = "2009-01-03";
const CVDD_SCALE = 6_000_000;
const BLOCKS_PER_DAY = 144;

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
// BTC daily CLOSE (2026-11-06). RB's `price/price` at d1 is a daily AVERAGE (matches Binance VWAP to ±0.3 %), not a
// close — the strategy's thresholds were silently benefiting from that smoothing (fact-sheet 52.7× → 30.5× on true
// closes). Signals must live in the same world as fills, so the price column is now the UTC close:
//   • Binance BTCUSDT 1d close from 2017-08-17 (first Binance day)
//   • RB price/price at h1, 23:00Z bar, before that (validated vs Binance over 3 355 overlapping days: median 0.33 %)
// The RB daily average is still stored (btc_price_avg_usd) for audit / comparison.
// ---------------------------------------------------------------------------
const BINANCE_START = "2017-08-17";

async function binanceDailyCloses(fromDate: string, toExclusive: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let start = Date.parse(fromDate + "T00:00:00Z");
  const endMs = Date.parse(toExclusive + "T00:00:00Z");
  while (start < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${start}&endTime=${endMs - 1}&limit=1000`;
    let rows: unknown[][] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url);
      if (res.ok) { rows = (await res.json()) as unknown[][]; break; }
      if (attempt === 3) throw new Error(`Binance klines HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      await sleep(1500 * (attempt + 1));
    }
    if (!rows.length) break;
    for (const r of rows) {
      const closeTime = Number(r[6]);
      if (closeTime > Date.now()) continue;                      // candle still open
      out.set(new Date(Number(r[0])).toISOString().slice(0, 10), Number(r[4]));
    }
    if (rows.length < 1000) break;
    start = Number(rows[rows.length - 1][0]) + 86_400_000;
  }
  return out;
}

async function rbHourlyCloses(rbToken: string, fromDate: string, toExclusive: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let cur = new Date(fromDate + "T00:00:00Z");
  const end = new Date(toExclusive + "T00:00:00Z");
  while (cur < end) {
    const next = new Date(Math.min(cur.getTime() + 180 * 86_400_000, end.getTime()));
    const params = new URLSearchParams({ resolution: "h1", from_time: cur.toISOString().slice(0, 10), to_time: next.toISOString().slice(0, 10) });
    const res = await fetch(`${RB_BASE}/v2/price/price?${params}`, { headers: { "X-API-Token": rbToken, Accept: "text/csv" } });
    if (!res.ok) throw new Error(`RB h1 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    for (const l of (await res.text()).trim().split("\n").slice(1)) {
      const [ts, v] = l.split(",");
      if (ts?.slice(11, 13) === "23") { const n = parseFloat(v); if (Number.isFinite(n)) out.set(ts.slice(0, 10), n); }
    }
    cur = next;
  }
  return out;
}

/** UTC close per day: Binance where available, RB 23:00 bar before Binance existed. */
async function dailyCloses(rbToken: string, fromDate: string, toExclusive: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (fromDate < BINANCE_START) {
    const rbEnd = toExclusive < BINANCE_START ? toExclusive : BINANCE_START;
    for (const [d, v] of await rbHourlyCloses(rbToken, fromDate, rbEnd)) out.set(d, v);
  }
  if (toExclusive > BINANCE_START) {
    const binFrom = fromDate > BINANCE_START ? fromDate : BINANCE_START;
    for (const [d, v] of await binanceDailyCloses(binFrom, toExclusive)) out.set(d, v);
  }
  return out;
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
  btc_price: number;            // UTC close (2026-11-06; was RB daily average)
  btc_price_avg_usd: number | null; // RB daily average, kept for audit
  sth_supply: number;
  sth_realized_price: number;
  lth_supply: number;
  lth_realized_price: number;
  coinblock_value_cum_destroyed: number | null;
  cvdd: number | null;
  sth_pvr: number | null;
  lth_pvr: number | null;
  pvr_ratio: number | null;
  pvr_divergence: number | null;
  computed_at: string;
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function marketAgeDays(date: string): number {
  const dayMs = 24 * 60 * 60 * 1000;
  const genesis = Date.parse(`${BITCOIN_GENESIS_DATE}T00:00:00Z`);
  const current = Date.parse(`${date}T00:00:00Z`);
  return Math.max(1, Math.floor((current - genesis) / dayMs));
}

// Build PVR rows by walking dates in order, advancing the Welford state.
// Mutates `sthW` / `lthW` in place-by-return. Returns { rows, sthW, lthW }.
function computeRows(
  org_id: string,
  dates: string[],
  price: Map<string, number>,
  priceAvg: Map<string, number>,
  sthSupply: Map<string, number>,
  sthRp: Map<string, number>,
  lthSupply: Map<string, number>,
  lthRp: Map<string, number>,
  coinblockValueCumDestroyed: Map<string, number>,
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
    const cvd = coinblockValueCumDestroyed.get(d);

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
    let cvdd: number | null = null;

    if (sthStd > 0) sthPvr = round6((sthMc - sthRc) / sthStd);
    if (lthStd > 0) lthPvr = round6((lthMc - lthRc) / lthStd);
    if (sthPvr !== null && lthPvr !== null) {
      divergence = round6(sthPvr - lthPvr);
      // Guard divide-by-near-zero: leave ratio null when LTH PVR is ~0.
      if (Math.abs(lthPvr) > 1e-6) ratio = round6(sthPvr / lthPvr);
    }
    if (cvd !== undefined && Number.isFinite(cvd) && cvd > 0) {
      cvdd = round6((cvd / BLOCKS_PER_DAY) / marketAgeDays(d) / CVDD_SCALE);
    }

    rows.push({
      org_id,
      date: d,
      btc_price: p,
      btc_price_avg_usd: priceAvg.get(d) ?? null,
      sth_supply: ss,
      sth_realized_price: sr,
      lth_supply: ls,
      lth_realized_price: lr,
      coinblock_value_cum_destroyed: cvd ?? null,
      cvdd,
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
  // 2026-11-05 hardening: deployed --no-verify-jwt, so authorise every caller here (secret key or org admin).
  const __caller = await requireOrgAdminAuto(req);
  if (!__caller.ok) return unauthorizedResponse(__caller);
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

  // ---- sth_cb band source maintenance (no RB call) ---------------------------
  // { "sth_cb_bands": "backfill" }            → recompute & upsert the whole series
  // { "sth_cb_bands": "from", "from": date }  → recompute, upsert from `from`
  if (typeof body.sth_cb_bands === "string") {
    try {
      const fromDate = body.sth_cb_bands === "backfill" ? null : String(body.from ?? "");
      const res = await refreshSthCbBands(sb, org_id, fromDate || null);
      console.info(`ef_fetch_onchain_pvr: sth_cb bands refreshed (${res.rows_written} rows, params ${JSON.stringify(res.params)})`);
      return new Response(JSON.stringify({ ok: true, sth_cb_bands: res }), { headers: { "content-type": "application/json" } });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      await logAlert(sb, "error", "sth_cb bands refresh failed", { org_id, error: msg }, org_id);
      return new Response(msg, { status: 500 });
    }
  }

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
  let priceAvg: Map<string, number>;
  let sthSupply: Map<string, number>;
  let sthRp: Map<string, number>;
  let lthSupply: Map<string, number>;
  let lthRp: Map<string, number>;
  let coinblockValueCumDestroyed: Map<string, number>;
  try {
    [price, priceAvg, sthSupply, sthRp, lthSupply, lthRp, coinblockValueCumDestroyed] = await Promise.all([
      dailyCloses(rbToken, fromDate, toTime),
      rbFetchRange(rbToken, "price", "price", fromDate, toTime),
      rbFetchRange(rbToken, "supply_distribution", "supply_sth", fromDate, toTime),
      rbFetchRange(rbToken, "realizedprice", "realized_price_sth", fromDate, toTime),
      rbFetchRange(rbToken, "supply_distribution", "supply_lth", fromDate, toTime),
      rbFetchRange(rbToken, "realizedprice", "realized_price_lth", fromDate, toTime),
      rbFetchRange(rbToken, "cointime_statistics", "coinblock_value_cum_destroyed", fromDate, toTime),
    ]);
  } catch (e) {
    await logAlert(sb, "error", "Price/RB fetch failed in ef_fetch_onchain_pvr",
      { org_id, from: fromDate, to: yesterday, error: String((e as Error)?.message ?? e) }, org_id);
    return new Response("RB fetch failed", { status: 502 });
  }

  // ---- Build ordered date list (only <= yesterday) --------------------------
  // Date spine = RB's daily series (complete). A missing close (exchange outage / RB hourly gap) is forward-filled
  // from the previous day so the on-chain row is never dropped; 2026-11-06 build saw 8 such days in 15 years.
  const dates = Array.from(priceAvg.keys())
    .filter((d) => d <= yesterday && d >= fromDate)
    .sort();
  let prevClose: number | undefined;
  let filled = 0;
  for (const d of dates) {
    const c = price.get(d);
    if (c && Number.isFinite(c) && c > 0) prevClose = c;
    else if (prevClose) { price.set(d, prevClose); filled++; }
  }
  if (filled) console.warn(`ef_fetch_onchain_pvr: forward-filled ${filled} missing close(s)`);

  const { rows, sthW: sthWFinal, lthW: lthWFinal } = computeRows(
    org_id, dates, price, priceAvg, sthSupply, sthRp, lthSupply, lthRp, coinblockValueCumDestroyed, sthW, lthW,
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

  // ---- Chain: refresh the sth_cb band source for the new dates --------------
  // Non-fatal: the PVR series is the primary product; band rows can be rebuilt
  // any time with { "sth_cb_bands": "backfill" }.
  let sthCbBands: unknown = null;
  try {
    sthCbBands = await refreshSthCbBands(sb, org_id, isBackfill ? null : rows[0].date);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    await logAlert(sb, "warn", "sth_cb bands refresh failed after PVR append", { org_id, error: msg }, org_id);
    sthCbBands = { error: msg };
  }

  // ---- Chain: rebuild the STH_CB strategy tracker (paper record) -------------
  // Fire-and-forget; the tracker rebuilds its full history from scratch each run.
  try {
    const baseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
    const key = getServiceKey();
    if (baseUrl && key) {
      const resp = await fetch(`${baseUrl}/functions/v1/ef_sth_cb_tracker`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ org_id }),
      });
      console.info(`ef_fetch_onchain_pvr: sth_cb tracker trigger -> HTTP ${resp.status}`);
    }
  } catch (e) {
    console.warn(`ef_fetch_onchain_pvr: sth_cb tracker trigger failed (non-fatal): ${String((e as Error)?.message ?? e)}`);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      mode: isBackfill ? "backfill" : "daily",
      rows_written: rows.length,
      last_date: lastDate,
      sth_n: sthWFinal.n,
      lth_n: lthWFinal.n,
      sth_cb_bands: sthCbBands,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
