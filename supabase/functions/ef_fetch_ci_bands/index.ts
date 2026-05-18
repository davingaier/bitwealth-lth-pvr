// ef_fetch_ci_bands/index.ts
// Fetch CI bands from ChartInspect's /lth-pvr endpoint and upsert into
// lth_pvr.ci_bands_daily.
//
// History note (2026-05-18):
//   We previously used /lth-pvr-bands?mode=static, which silently changed
//   behaviour and started returning a single set of "as-of-now" bands
//   applied to every historical date — overwriting all 5,784 historical
//   rows on the nightly cron run. We now use /lth-pvr (matches the
//   ChartInspect playground) which returns per-day expanding-window
//   bands, plus:
//     - Defensive filtering: only rows inside the requested [start,end]
//       window are upserted.
//     - Hard safety cap: if more rows survive the filter than expected
//       (default 31 for a daily call), abort with a critical alert.
//     - Frozen-row protection: rows with a date older than yesterday are
//       marked frozen, and a BEFORE UPDATE trigger silently rejects any
//       future attempt to mutate them.
//
// The /lth-pvr endpoint does NOT return -1σ or +1.5σ band fields. Because
// price_at_pvr_X is exactly linear in X (within a single day's params),
// we derive them as:
//   price_at_m100 = 2*mean - p100
//   price_at_p150 = 1.5*p100 - 0.5*mean

import { getServiceClient } from "./client.ts";

const CI_BASE = "https://chartinspect.com/api/v1/onchain/lth-pvr";
const ALLOWED_FIELD_DRIFT_PCT = 0.10; // 10% day-over-day drift => alert

Deno.serve(async (req: Request) => {
  const sb = getServiceClient();

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  async function fetchJSONWithRetry(
    url: string,
    headers: Record<string, string>,
    attempts = 5,
  ) {
    let wait = 1000;
    let lastError: unknown = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const resp = await fetch(url, { headers });
        if (resp.ok) return await resp.json();
        const errorBody = await resp.text().catch(() => "");
        lastError =
          `HTTP ${resp.status} ${resp.statusText}` +
          (errorBody ? `: ${errorBody.substring(0, 200)}` : "");
        console.warn(`CI attempt ${i + 1}/${attempts} failed: ${lastError}`);
        const ra = Number(resp.headers.get("retry-after"));
        await sleep(ra ? ra * 1000 : wait);
        wait = Math.min(wait * 2, 15000);
      } catch (e) {
        lastError = e;
        console.warn(`CI attempt ${i + 1}/${attempts} failed: ${String(e)}`);
        await sleep(wait);
        wait = Math.min(wait * 2, 15000);
      }
    }
    throw new Error(
      `CI fetch failed after ${attempts} attempts: ${url} – ${String(lastError ?? "")}`,
    );
  }

  async function logAlert(
    severity: "info" | "warn" | "error" | "critical",
    message: string,
    context: Record<string, unknown> = {},
    orgId?: string | null,
  ) {
    try {
      const payload: Record<string, unknown> = {
        component: "ef_fetch_ci_bands",
        severity,
        message,
        context,
      };
      if (orgId) payload.org_id = orgId;
      await sb.schema("public").from("alert_events").insert(payload);
    } catch (e) {
      console.error("alert_events insert failed", e);
    }
  }

  const asNum = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  const isoDate = (msFromUTCMidnightOffset = 0) => {
    const now = new Date();
    const todayUTC = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    return new Date(todayUTC + msFromUTCMidnightOffset)
      .toISOString()
      .slice(0, 10);
  };

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const org_id =
    (typeof body.org_id === "string" && body.org_id) ||
    Deno.env.get("ORG_ID") ||
    null;

  // mode is retained as a label only — we always hit /lth-pvr now.
  const mode: string =
    (typeof body.mode === "string" && body.mode) || "static";

  const start =
    typeof body.start === "string" && body.start ? body.start : null;
  const end = typeof body.end === "string" && body.end ? body.end : null;
  const allowBackfill = body.allow_backfill === true; // bypasses 31-row cap

  const todayStr = isoDate(0);
  const yesterdayStr = isoDate(-24 * 60 * 60 * 1000);

  // Effective window: explicit start/end if given; else yesterday only.
  const wantStart = start ?? yesterdayStr;
  const wantEnd = end ?? yesterdayStr;

  if (!org_id) {
    await logAlert(
      "error",
      "ef_fetch_ci_bands invoked without org_id",
      {
        payload_org_id: body.org_id ?? null,
        env_org_id: Deno.env.get("ORG_ID") ?? null,
      },
    );
    return new Response("missing org_id", {
      status: 400,
      headers: { "content-type": "text/plain" },
    });
  }

  const apiKey = Deno.env.get("CI_API_KEY");
  if (!apiKey) {
    await logAlert("critical", "CI_API_KEY missing", { org_id }, org_id);
    return new Response("CI_API_KEY missing", { status: 500 });
  }

  // Build URL. /lth-pvr supports ?days=N (count back from today).
  // If explicit start/end requested, use a `days` value wide enough to cover.
  let url: string;
  if (start || end) {
    const startDate = new Date(`${wantStart}T00:00:00Z`).getTime();
    const endDate = new Date(`${wantEnd}T00:00:00Z`).getTime();
    const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
    const daysBack = Math.ceil((todayMs - startDate) / 86_400_000) + 1;
    if (!Number.isFinite(daysBack) || daysBack < 1 || endDate < startDate) {
      await logAlert(
        "error",
        "Invalid start/end window passed to ef_fetch_ci_bands",
        { org_id, start: wantStart, end: wantEnd },
        org_id,
      );
      return new Response("bad window", { status: 400 });
    }
    url = `${CI_BASE}?days=${daysBack}`;
  } else {
    // Default cron path: days=2 covers today + yesterday.
    url = `${CI_BASE}?days=2`;
  }

  console.info("CI GET", url, "window", wantStart, "→", wantEnd);

  let json: any;
  try {
    json = await fetchJSONWithRetry(url, { "X-API-Key": apiKey });
  } catch (e) {
    await logAlert(
      "error",
      "CI API fetch failed",
      { org_id, url, error: String((e as any)?.message ?? e) },
      org_id,
    );
    return new Response("CI fetch failed", { status: 502 });
  }

  const rawData = Array.isArray(json?.data) ? json.data : [];
  console.info(
    "ci rows:",
    rawData.length,
    "first:",
    rawData[0]?.date,
    "last:",
    rawData.at(-1)?.date,
  );

  // Defensive: keep only rows whose date falls inside [wantStart, wantEnd]
  // AND strictly before today. This is the critical guard that prevents
  // a misbehaving API from rewriting unrelated rows.
  const filteredData = rawData.filter((row: any) => {
    const d = typeof row?.date === "string" ? row.date : "";
    return d && d >= wantStart && d <= wantEnd && d < todayStr;
  });

  if (filteredData.length < rawData.length) {
    console.warn(
      `dropped ${rawData.length - filteredData.length} rows outside window/in future`,
    );
  }

  if (filteredData.length === 0) {
    await logAlert(
      "warn",
      "CI API returned no data for requested window",
      { org_id, url, wantStart, wantEnd, rawRows: rawData.length },
      org_id,
    );
    return new Response("No data in window", { status: 502 });
  }

  // Hard safety cap.
  const maxRows = allowBackfill ? 20_000 : 31;
  if (filteredData.length > maxRows) {
    await logAlert(
      "critical",
      `CI API returned ${filteredData.length} rows for window — refusing to upsert (max ${maxRows})`,
      { org_id, url, wantStart, wantEnd, rows: filteredData.length, allowBackfill },
      org_id,
    );
    return new Response("Too many rows for window", { status: 502 });
  }

  // --- row normaliser ----------------------------------------------
  // Field name reference (response from /lth-pvr):
  //   price_at_pvr_mean
  //   price_at_pvr_minus_quarter_sigma          -> m025
  //   price_at_pvr_minus_half_sigma             -> m050
  //   price_at_pvr_minus_three_quarters_sigma   -> m075
  //   price_at_pvr_plus_half_sigma              -> p050
  //   price_at_pvr_plus_1sigma                  -> p100
  //   price_at_pvr_plus_2sigma                  -> p200
  //   price_at_pvr_plus_2half_sigma             -> p250
  //   (-1σ and +1.5σ are derived linearly from mean and p100.)
  const toRec = (r: any) => {
    const mean = asNum(r?.price_at_pvr_mean);
    const p100 = asNum(r?.price_at_pvr_plus_1sigma);
    const m100 = mean !== null && p100 !== null ? 2 * mean - p100 : null;
    const p150 = mean !== null && p100 !== null ? 1.5 * p100 - 0.5 * mean : null;

    return {
      org_id,
      date: r.date,
      mode,
      btc_price: asNum(r?.btc_price),
      price_at_mean: mean,
      price_at_m025: asNum(r?.price_at_pvr_minus_quarter_sigma),
      price_at_m050: asNum(r?.price_at_pvr_minus_half_sigma),
      price_at_m075: asNum(r?.price_at_pvr_minus_three_quarters_sigma),
      price_at_m100: m100,
      price_at_p050: asNum(r?.price_at_pvr_plus_half_sigma),
      price_at_p100: p100,
      price_at_p150: p150,
      price_at_p200: asNum(r?.price_at_pvr_plus_2sigma),
      price_at_p250: asNum(r?.price_at_pvr_plus_2half_sigma),
      fetched_at: new Date().toISOString(),
      source_hash: crypto.randomUUID(),
    };
  };

  const records = filteredData.map(toRec);

  // --- drift sanity check on the most-recent row ------------------
  // Flags incidents like the 2026-05-18 overwrite (mean jumped ~47%).
  try {
    const latestNew = records
      .filter((r) => r.price_at_mean !== null)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (latestNew) {
      const { data: prev } = await sb
        .schema("lth_pvr")
        .from("ci_bands_daily")
        .select("date, price_at_mean")
        .eq("org_id", org_id)
        .eq("mode", mode)
        .lt("date", latestNew.date)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const prevMean = prev?.price_at_mean ? Number(prev.price_at_mean) : null;
      if (prevMean && latestNew.price_at_mean !== null) {
        const drift = Math.abs(latestNew.price_at_mean - prevMean) / prevMean;
        if (drift > ALLOWED_FIELD_DRIFT_PCT) {
          await logAlert(
            "critical",
            `CI mean band drifted ${(drift * 100).toFixed(1)}% day-over-day`,
            {
              org_id,
              previous: { date: prev?.date, price_at_mean: prevMean },
              new: { date: latestNew.date, price_at_mean: latestNew.price_at_mean },
              threshold_pct: ALLOWED_FIELD_DRIFT_PCT * 100,
            },
            org_id,
          );
        }
      }
    }
  } catch (e) {
    console.warn("drift check failed", e);
  }

  // Upsert. The trigger lth_pvr.ci_bands_daily_freeze_guard silently
  // drops UPDATEs on frozen rows.
  const up = await sb
    .schema("lth_pvr")
    .from("ci_bands_daily")
    .upsert(records, { onConflict: "org_id,date,mode" })
    .select();

  if (up.error) {
    await logAlert(
      "error",
      "ci_bands_daily upsert failed",
      { org_id, mode, rows: records.length, error: up.error.message ?? up.error },
      org_id,
    );
    return new Response(up.error.message, { status: 500 });
  }

  // Freeze any row now older than yesterday and not yet frozen.
  try {
    const { error: fz } = await sb
      .schema("lth_pvr")
      .from("ci_bands_daily")
      .update({ frozen_at: new Date().toISOString() })
      .eq("org_id", org_id)
      .lt("date", yesterdayStr)
      .is("frozen_at", null);
    if (fz) console.warn("freeze sweep error", fz);
  } catch (e) {
    console.warn("freeze sweep failed", e);
  }

  console.info("upsert ok", {
    written: up.data?.length ?? 0,
    window: [wantStart, wantEnd],
  });
  return new Response(
    JSON.stringify({
      ok: true,
      url,
      window: { start: wantStart, end: wantEnd },
      written: up.data?.length ?? 0,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
