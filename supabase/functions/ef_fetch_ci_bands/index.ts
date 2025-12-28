// ef_fetch_ci_bands/index.ts
// Fetch CI bands and upsert into lth_pvr.ci_bands_daily,
// with alert logging into lth_pvr.alert_events.

import { getServiceClient } from "./client.ts";

Deno.serve(async (req: Request) => {
  const sb = getServiceClient();

  // ---- small helpers -------------------------------------------------
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  async function fetchJSONWithRetry(
    url: string,
    headers: Record<string, string>,
    attempts = 5,
  ) {
    let wait = 1000; // 1s -> 2s -> 4s -> 8s -> 15s cap
    let lastError: unknown = null;

    for (let i = 0; i < attempts; i++) {
      try {
        const resp = await fetch(url, { headers });
        if (resp.ok) return await resp.json();
        const ra = Number(resp.headers.get("retry-after"));
        await sleep(ra ? ra * 1000 : wait);
        wait = Math.min(wait * 2, 15000);
      } catch (e) {
        lastError = e;
        await sleep(wait);
        wait = Math.min(wait * 2, 15000);
      }
    }
    throw new Error(
      `CI fetch failed after ${attempts} attempts: ${url} – ${String(lastError ?? "")}`,
    );
  }

  // Simple alert helper writing to lth_pvr.alert_events
  async function logAlert(
    severity: "info" | "warn" | "error" | "critical",
    message: string,
    context: Record<string, unknown> = {},
    orgId?: string | null,
  ) {
    try {
      const payload: any = {
        component: "ef_fetch_ci_bands",
        severity,
        message,
        context,
      };
      if (orgId) payload.org_id = orgId;
      await sb.schema("lth_pvr").from("alert_events").insert(payload);
    } catch (e) {
      console.error("ef_fetch_ci_bands: alert_events insert failed", e);
    }
  }
  // --------------------------------------------------------------------

  // parse payload once (it may be empty {})
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

  const mode: string =
    (typeof body.mode === "string" && body.mode) || "static";

  // optional range inputs for catch-up/backfill
  const start =
    typeof body.start === "string" && body.start ? body.start : null;
  const end = typeof body.end === "string" && body.end ? body.end : null;

  // if neither start nor end provided, pull a small rolling window by default to self-heal gaps
  const days = Number.isFinite(Number(body?.days)) && Number(body.days) > 0
    ? Number(body.days)
    : 5;

  if (!org_id) {
    await logAlert(
      "error",
      "ef_fetch_ci_bands invoked without org_id",
      {
        payload_org_id: body.org_id ?? null,
        env_org_id: Deno.env.get("ORG_ID") ?? null,
      },
    );
    return new Response(
      "missing org_id (set ORG_ID secret or pass in payload)",
      {
        status: 400,
        headers: { "content-type": "text/plain" },
      },
    );
  }

  const apiKey = Deno.env.get("CI_API_KEY");
  if (!apiKey) {
    await logAlert(
      "critical",
      "CI_API_KEY missing in environment for ef_fetch_ci_bands",
      { org_id },
      org_id,
    );
    return new Response("CI_API_KEY missing", { status: 500 });
  }

  // Build URL; prefer explicit range else a short trailing window (days) for self-heal
  let url =
    `https://chartinspect.com/api/v1/onchain/lth-pvr-bands?mode=${
      encodeURIComponent(mode)
    }`;
  if (start) url += `&start=${encodeURIComponent(start)}`;
  if (end) url += `&end=${encodeURIComponent(end)}`;
  if (!start && !end && days > 1) url += `&days=${days}`;

  console.info("CI GET", url);

  let json: any;
  try {
    json = await fetchJSONWithRetry(url, { "X-API-Key": apiKey });
  } catch (e) {
    console.error("ef_fetch_ci_bands: CI fetch failed", e);
    await logAlert(
      "error",
      "CI API fetch failed in ef_fetch_ci_bands",
      {
        org_id,
        mode,
        start,
        end,
        days,
        url,
        error: String((e as any)?.message ?? e),
      },
      org_id,
    );
    return new Response("CI fetch failed", { status: 502 });
  }

  const data = Array.isArray(json?.data) ? json.data : [];
  console.info("ci status ok; rows:", data.length);
  console.info(
    "ci fetch ok; rows:",
    data.length,
    "first:",
    data[0]?.date,
    "last:",
    data.at(-1)?.date,
  );

  if (!Array.isArray(data) || data.length === 0) {
    await logAlert(
      "warn",
      "CI API returned no data in ef_fetch_ci_bands",
      {
        org_id,
        mode,
        start,
        end,
        days,
        url,
      },
      org_id,
    );
    return new Response("No data", { status: 502 });
  }

  // --- helpers for safe numeric lookups ---
  const asNum = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  const pickNum = (obj: any, ...keys: string[]) => {
    for (const k of keys) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
        const n = asNum((obj as any)[k]);
        if (n !== null) return n;
      }
    }
    return null;
  };

  const pickByRegex = (obj: any, ...regexes: (RegExp | string)[]) => {
    for (const r of regexes) {
      const re = r instanceof RegExp ? r : new RegExp(r as string, "i");
      for (const [k, v] of Object.entries(obj ?? {})) {
        if (re.test(k)) {
          const n = asNum(v);
          if (n !== null) return n;
        }
      }
    }
    return null;
  };

  // --- row normalizer ---
  const toRec = (r: any) => {
    const dstr =
      (typeof r?.date === "string" && r.date)
        ? r.date
        : new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

    const val = (...aliasesOrRegex: any[]) =>
      pickNum(
        r,
        ...aliasesOrRegex.filter((a) => typeof a === "string"),
      ) ??
      pickByRegex(r, ...aliasesOrRegex);

    return {
      org_id,
      date: dstr,
      mode,
      btc_price: val("btc_price", "price", "close", /price.*usd/i),
      price_at_mean: val(
        "price_at_pvr_mean",
        "lth_realized_price",
        "mean_price",
      ),
      price_at_m025: val("price_at_pvr_minus_quarter_sigma"),
      price_at_m050: val("price_at_pvr_minus_half_sigma"),
      price_at_m075: val("price_at_pvr_minus_three_quarters_sigma"),
      price_at_m100: val("price_at_pvr_minus_1sigma"),
      price_at_p050: val("price_at_pvr_plus_half_sigma"),
      price_at_p100: val("price_at_pvr_plus_1sigma"),
      price_at_p150: val("price_at_pvr_plus_1half_sigma"),
      price_at_p200: val("price_at_pvr_plus_2sigma"),
      price_at_p250: val("price_at_pvr_plus_2half_sigma"),
      fetched_at: new Date().toISOString(),
      source_hash: crypto.randomUUID(),
    };
  };

  const records = data.map(toRec);

  const up = await sb
    .schema("lth_pvr")
    .from("ci_bands_daily")
    .upsert(records, {
      onConflict: "org_id,date,mode",
    })
    .select();

  // If yesterday's row is still missing, try a 1-day refetch once.
  // CI bands are always for dates < today, so "yesterday" is the
  // latest date we expect to exist.
  try {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1); // yesterday in UTC
    const expectedDate = d.toISOString().slice(0, 10);

    const chk = await sb.schema("lth_pvr").from("ci_bands_daily")
      .select("date")
      .eq("org_id", org_id)
      .eq("mode", mode)
      .eq("date", expectedDate)
      .maybeSingle();

    if (!chk.data) {
      console.warn("latest CI day missing (yesterday), refetching 1 day window");
      const url1d =
        `https://chartinspect.com/api/v1/onchain/lth-pvr-bands?mode=${
          encodeURIComponent(mode)
        }&days=1`;
      try {
        const json2 = await fetchJSONWithRetry(
          url1d,
          { "X-API-Key": apiKey },
          3,
        );
        const data2 = Array.isArray(json2?.data) ? json2.data : [];
        if (data2.length) {
          const rec2 = data2.map(toRec);
          await sb.schema("lth_pvr").from("ci_bands_daily").upsert(rec2, {
            onConflict: "org_id,date,mode",
          });
        } else {
          await logAlert(
            "warn",
            "Self-heal refetch (1-day window) returned no data for expected CI date",
            {
              org_id,
              mode,
              url: url1d,
              expectedDate,
            },
            org_id,
          );
        }
      } catch (e) {
        console.error("self-heal check/refetch failed", e);
        await logAlert(
          "warn",
          "Self-heal refetch failed in ef_fetch_ci_bands",
          {
            org_id,
            mode,
            url: url1d,
            expectedDate,
            error: String((e as any)?.message ?? e),
          },
          org_id,
        );
      }
    }
  } catch (e) {
    console.error("self-heal check failed", e);
    await logAlert(
      "warn",
      "Self-heal presence check failed in ef_fetch_ci_bands",
      {
        org_id,
        mode,
        error: String((e as any)?.message ?? e),
      },
      org_id,
    );
  }

  if (up.error) {
    console.error("UPSERT ERROR", up.error);
    await logAlert(
      "error",
      "ci_bands_daily upsert failed in ef_fetch_ci_bands",
      {
        org_id,
        mode,
        rows: records.length,
        error: up.error.message ?? up.error,
      },
      org_id,
    );
    return new Response(up.error.message, {
      status: 500,
    });
  }

  console.info("upsert ok", up.data?.[0] ?? null);
  return new Response("ok");
});
