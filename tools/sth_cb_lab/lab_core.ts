// tools/sth_cb_lab/lab_core.ts
// Shared helpers for the local STH_CB lab: env, series cache, param building,
// objectives, walk-forward folds, CSV output.

import {
  simulateSthCb,
  SthCbMetrics,
  SthCbSeriesRow,
  SthCbSimParams,
  SthCbSimResult,
} from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { DEFAULT_STH_CB_CONFIG, SthCbConfig } from "../../supabase/functions/_shared/sth_cb_strategy_logic.ts";

export const LAB_DIR = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
export const DATA_FILE = `${LAB_DIR}data/series.json`;
export const RESULTS_DIR = `${LAB_DIR}results/`;
export const REPO_ROOT = `${LAB_DIR}../../`;

// ---------------------------------------------------------------------------
// .env (repo root) — only the three keys the lab needs
// ---------------------------------------------------------------------------
export async function loadEnv(): Promise<{ url: string; key: string; orgId: string }> {
  const env: Record<string, string> = {};
  // .env lives OUTSIDE the Dropbox-synced repo since 2026-11-05; point BW_ENV_FILE at it (default: repo root, then ~/Desktop/.env).
  const candidates = [Deno.env.get("BW_ENV_FILE"), `${REPO_ROOT}.env`, `${Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ""}/Desktop/.env`].filter(Boolean) as string[];
  for (const file of candidates) {
    try {
      const txt = await Deno.readTextFile(file);
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
      break;
    } catch { /* try next */ }
  }
  const url = Deno.env.get("SUPABASE_URL") ?? env.SUPABASE_URL;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? env.SUPABASE_SERVICE_ROLE_KEY;
  const orgId = Deno.env.get("ORG_ID") ?? env.ORG_ID;
  if (!url || !key || !orgId) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ORG_ID missing (.env at repo root)");
  return { url, key, orgId };
}

// ---------------------------------------------------------------------------
// Series cache
// ---------------------------------------------------------------------------
export interface SeriesFile {
  fetched_at: string;
  from: string;
  to: string;
  rows: SthCbSeriesRow[];
}

export async function loadSeries(): Promise<SeriesFile> {
  // --series close (or SERIES=close) switches every lab script to data/series_close.json (true UTC closes, 2026-11-06).
  const pick = (Deno.args.find((a) => a.startsWith("--series="))?.slice(9)) ??
    (Deno.args.includes("--series") ? Deno.args[Deno.args.indexOf("--series") + 1] : undefined) ??
    Deno.env.get("SERIES") ?? "rb";
  const file = pick === "close" ? `${LAB_DIR}data/series_close.json` : DATA_FILE;
  try {
    return JSON.parse(await Deno.readTextFile(file)) as SeriesFile;
  } catch {
    throw new Error(`No cached series at ${file}. Run: deno run -A tools/sth_cb_lab/${pick === "close" ? "fetch_closes" : "fetch"}.ts`);
  }
}

// ---------------------------------------------------------------------------
// CLI args → simulation params
// ---------------------------------------------------------------------------
export interface LabArgs {
  start: string;
  end: string;
  upfront: number;
  monthly: number;
  sameDay: boolean;
  fees: "full" | "exchange_only";
  tradeBps: number;
  contribBps: number;
  config: SthCbConfig;
  /** false = cash parked as plain USDT, no USDPC yield (--no-usdpc) */
  usdpc?: boolean;
  stageBand?: number; unstageDays?: number; usdtFloor?: number; unstagedFrac?: number; unstagedDelay?: number;
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true;
  }
  return out;
}

export function labArgsFrom(a: Record<string, string | boolean>, seriesTo: string): LabArgs {
  const num = (k: string, def: number) => { const v = Number(a[k]); return Number.isFinite(v) ? v : def; };
  const extras = typeof a.extras === "string" ? JSON.parse(a.extras) : {};
  const base = typeof a.config === "string" ? JSON.parse(a.config) : {};
  return {
    start: String(a.start ?? "2015-01-04"),
    end: String(a.end ?? seriesTo),
    upfront: num("upfront", 10_000),
    monthly: num("monthly", 500),
    sameDay: a["same-day"] === true || a.sameDay === true,
    fees: a.fees === "exchange_only" ? "exchange_only" : "full",
    tradeBps: num("trade-bps", 8),
    contribBps: num("contrib-bps", 18),
    config: { ...DEFAULT_STH_CB_CONFIG, ...base, ...extras },
    usdpc: a["no-usdpc"] !== true,   // --no-usdpc: park cash in plain USDT (no yield)
    stageBand: Number(a["stage-band"]) || 0,          // --stage-band 0.05 : hold USDT while an entry trigger is within 5 %
    unstageDays: Number(a["unstage-days"]) || 3,
    usdtFloor: Number(a["usdt-floor"]) || 0,          // --usdt-floor 0.3 : always keep 30 % of cash as USDT
    unstagedFrac: a["unstaged-frac"] !== undefined ? Number(a["unstaged-frac"]) : 1,   // --unstaged-frac 0.25 --unstaged-delay 2
    unstagedDelay: Number(a["unstaged-delay"]) || 0,
  };
}

export function simParams(l: LabArgs, config: SthCbConfig = l.config): SthCbSimParams {
  const full = l.fees === "full";
  return {
    startDate: l.start,
    endDate: l.end,
    upfront: l.upfront,
    monthly: l.monthly,
    tradeFeeRate: l.tradeBps / 10_000,
    contribFeeRate: l.contribBps / 10_000,
    feePlan: "management",
    platformFeeRate: 0.0075,
    managementFeeRate: full ? 0.01 : 0,
    performanceFeeRate: full ? 0.10 : 0,
    usdpcEnabled: full && l.usdpc !== false,
    usdpcStagingBandPct: l.stageBand || undefined,
    usdpcUnstageDays: l.unstageDays || undefined,
    usdpcUsdtFloorFrac: l.usdtFloor || undefined,
    usdpcUnstagedFillFrac: typeof l.unstagedFrac === "number" ? l.unstagedFrac : undefined,
    usdpcUnstagedDelayDays: l.unstagedDelay || undefined,
    usdpcApy: 0.10,
    usdpcConvFee: 0.001,
    executionLag: l.sameDay ? 0 : 1,
    config,
  };
}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------
export type Objective = "nav_vs_hodl" | "calmar" | "cagr" | "sharpe" | "final_nav" | "nav_vs_std_dca";
export const OBJECTIVES: Objective[] = ["nav_vs_hodl", "calmar", "cagr", "sharpe", "final_nav", "nav_vs_std_dca"];

export function objectiveValue(m: SthCbMetrics, o: Objective): number {
  switch (o) {
    case "nav_vs_hodl": return m.nav_vs_hodl;
    case "calmar": return Number.isFinite(m.calmar) ? m.calmar : 0;
    case "cagr": return m.final_cagr_percent;
    case "sharpe": return m.sharpe;
    case "final_nav": return m.final_nav_usd;
    case "nav_vs_std_dca": return m.nav_vs_std_dca;
  }
}

// ---------------------------------------------------------------------------
// Walk-forward folds (anchored, annual OOS — same shape as the LTH PVR WFT)
// ---------------------------------------------------------------------------
export interface Fold { oosStart: string; oosEnd: string }

export function annualFolds(start: string, end: string): Fold[] {
  const y0 = Number(start.slice(0, 4));
  const y1 = Number(end.slice(0, 4));
  const folds: Fold[] = [];
  for (let y = y0; y <= y1; y++) {
    const s = y === y0 ? start : `${y}-01-01`;
    const e = y === y1 ? end : `${y}-12-31`;
    if (s < e) folds.push({ oosStart: s, oosEnd: e });
  }
  return folds;
}

// ---------------------------------------------------------------------------
// Evaluate one config (optionally per fold)
// ---------------------------------------------------------------------------
export interface EvalResult {
  config: SthCbConfig;
  metrics: SthCbMetrics;
  hodl_final_nav: number;
  std_final_nav: number;
  folds?: Array<{ fold: Fold; nav_vs_hodl: number; cagr: number; beat_hodl: boolean }>;
  folds_beating_hodl?: number;
}

export function evaluate(rows: SthCbSeriesRow[], l: LabArgs, config: SthCbConfig, folds?: Fold[]): EvalResult {
  const sim: SthCbSimResult = simulateSthCb(rows, simParams(l, config), { ledger: false, daily: false });
  const out: EvalResult = {
    config,
    metrics: sim.summary.sth_cb,
    hodl_final_nav: sim.summary.hodl?.final_nav_usd ?? NaN,
    std_final_nav: sim.summary.std_dca?.final_nav_usd ?? NaN,
  };
  if (folds?.length) {
    out.folds = folds.map((f) => {
      const s = simulateSthCb(rows.filter((r) => r.close_date <= f.oosEnd), { ...simParams(l, config), startDate: f.oosStart, endDate: f.oosEnd }, { ledger: false, daily: false });
      const nvh = s.summary.sth_cb.nav_vs_hodl;
      return { fold: f, nav_vs_hodl: nvh, cagr: s.summary.sth_cb.final_cagr_percent, beat_hodl: nvh > 1 };
    });
    out.folds_beating_hodl = out.folds.filter((f) => f.beat_hodl).length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------
export const fmtUsd = (v: number) => Number.isFinite(v) ? v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "–";
export const fmtPct = (v: number, d = 2) => Number.isFinite(v) ? `${v.toFixed(d)}%` : "–";
export const fmtX = (v: number, d = 3) => Number.isFinite(v) ? `${v.toFixed(d)}×` : "–";

const OFF_VALUES: Partial<Record<keyof SthCbConfig, unknown>> = { trendExitConfirmDays: 1, disableTrendExit: false };

export function configDiff(c: SthCbConfig, base: SthCbConfig = DEFAULT_STH_CB_CONFIG): string {
  const parts: string[] = [];
  for (const k of Object.keys(c) as (keyof SthCbConfig)[]) {
    const v = c[k], b = base[k];
    if (v === null || typeof v === "undefined") continue;
    if (JSON.stringify(v) === JSON.stringify(b)) continue;
    if (typeof b === "undefined" && JSON.stringify(v) === JSON.stringify(OFF_VALUES[k])) continue;
    parts.push(`${k}=${JSON.stringify(v)}`);
  }
  // Keys present in the base but switched OFF in c (removed / null) — otherwise a config that only *drops* a rule
  // (e.g. no scaleCooldownDays) prints as "(defaults)" and cannot be told apart from the base.
  for (const k of Object.keys(base) as (keyof SthCbConfig)[]) {
    const v = c[k], b = base[k];
    if (b === null || typeof b === "undefined") continue;
    if (v === null || typeof v === "undefined") parts.push(`${k}=off`);
  }
  return parts.join(" ") || "(defaults)";
}

/**
 * Stable identity for a config: keys sorted at EVERY level, null/undefined dropped.
 * (Do not use `JSON.stringify(c, Object.keys(c).sort())` — a replacer array filters nested objects too, so
 *  the {sigma, alloc} tiers inside lthSellTiers / sellTiers / capBuyTiers would be stripped and distinct
 *  ladders would collide.)
 */
export function configKey(c: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (x === null || typeof x === "undefined") continue;
        o[k] = norm(x);
      }
      return o;
    }
    return v;
  };
  return JSON.stringify(norm(c));
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
