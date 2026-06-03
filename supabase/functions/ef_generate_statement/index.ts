// ef_generate_statement/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Purpose:  Generate the monthly statement for ONE customer for ONE (year, month).
//           Renders an HTML template, converts it to PDF via Browserless,
//           uploads the PDF to Supabase Storage, records an idempotency row,
//           and returns a signed download URL.
//
// Body:     { customer_id: number, year: number, month: number, force?: boolean }
// Query:    ?preview=html  → returns the rendered HTML (no PDF, no upload, no DB write).
//                            Useful for in-browser preview during development and for
//                            a future "Preview" button in the customer portal.
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID, BROWSERLESS_TOKEN.
// Storage:  Bucket `customer-statements` (private, signed URLs only).
//           Bucket `branding`            (public, holds the SVG logo).
//
// History:  v2 (2026-04-29) — full rewrite. Replaces the jsPDF implementation that
//                              suffered from missing logo, overlapping columns,
//                              hard-coded $0.00 fees, and a broken CAGR formula.
//                              See docs/Statement_Redesign_Proposal.md.
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { logAlert } from "../_shared/alerting.ts";
import { bandsTableForSource, normaliseBandSource, BandSource } from "../_shared/band_source.ts";
import {
  renderStatementHtml,
  StatementData,
  StatementFeeRow,
  StatementSparkPoint,
  StatementTransactionRow,
} from "../_shared/statement_template.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID = Deno.env.get("ORG_ID");
const BROWSERLESS_TOKEN = Deno.env.get("BROWSERLESS_TOKEN");
const BROWSERLESS_BASE = Deno.env.get("BROWSERLESS_BASE") ?? "https://chrome.browserless.io";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmtUsd = (n: number, signed = false) => {
  const s = (Math.abs(n)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (signed && n > 0) return `+ $ ${s}`;
  if (n < 0) return `– $ ${s}`;
  return `$ ${s}`;
};
const fmtZar = (n: number) =>
  `R ${(Math.abs(n)).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtBtc = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 8, maximumFractionDigits: 8 }) + " ₿";
const fmtPct = (n: number, signed = true) => {
  if (!isFinite(n)) return "—";
  // When inception NAV is tiny (e.g. first day after deposit), CAGR can explode
  // into the millions or billions of percent and produce scientific notation.
  // Cap the displayed value so the statement stays legible; the underlying number
  // is logged and the cap (±999.99 %) is loud enough to flag review.
  if (Math.abs(n) > 9999.99) return n > 0 ? "> +999.99 %" : "< -999.99 %";
  const sign = signed && n > 0 ? "+ " : n < 0 ? "– " : "";
  return `${sign}${Math.abs(n).toFixed(2)} %`;
};
const fmtPp = (n: number) => {
  // Render percentage-point differences as "%" too — most readers don't know what "pp" means.
  if (!isFinite(n)) return "—";
  if (Math.abs(n) > 9999.99) return n > 0 ? "> +999.99 %" : "< -999.99 %";
  const sign = n > 0 ? "+ " : n < 0 ? "– " : "";
  return `${sign}${Math.abs(n).toFixed(2)} %`;
};
const fmtDateLong = (iso: string) => {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
  if (isNaN(d.valueOf())) return iso;
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
};
const fmtTimestampUtc = (d: Date) => {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getUTCDate())} ${MONTH_NAMES[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Browserless: HTML → PDF
// ─────────────────────────────────────────────────────────────────────────────
async function htmlToPdf(html: string): Promise<Uint8Array> {
  if (!BROWSERLESS_TOKEN) {
    throw new Error("BROWSERLESS_TOKEN env var is not set");
  }
  const url = `${BROWSERLESS_BASE.replace(/\/$/, "")}/pdf?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`;
  // Footer template injected by Chrome. Uses the special <span class="pageNumber">
  // and <span class="totalPages"> placeholders. Inline styles are required because
  // header/footer templates run in an isolated context with no shared CSS.
  const footerTemplate = `
    <div style="width:100%; font-family:-apple-system, 'Segoe UI', Roboto, Arial, sans-serif; font-size:8pt; color:#6b7280; padding:0 16mm; display:flex; justify-content:space-between; align-items:center;">
      <span>BitWealth (Pty) Ltd · bitwealth.co.za</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      html,
      // Browserless margins (top/right/bottom/left). The bottom margin reserves
      // room for the page-number footer; the @page rule in the template is
      // ignored when displayHeaderFooter is enabled.
      options: {
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate,
        margin: { top: "11mm", bottom: "16mm", left: "0", right: "0" },
      },
      gotoOptions: { waitUntil: "networkidle0", timeout: 25000 },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Browserless PDF render failed (${res.status}): ${detail.slice(0, 500)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Data assembly
// ─────────────────────────────────────────────────────────────────────────────
interface BuildArgs {
  supabase: SupabaseClient;
  orgId: string;
  customerId: number;
  year: number;
  month: number; // 1-12
  bandSource?: BandSource;
}

interface BuildResult {
  data: StatementData;
  filename: string;
  storagePath: string;
  statementMonth: string; // YYYY-MM-01
}

async function buildStatementData(a: BuildArgs): Promise<BuildResult> {
  const { supabase, orgId, customerId, year, month } = a;
  // Day 5 of CI->RB migration (2026-05-19): default is now RB.
  const bandSource: BandSource = a.bandSource ?? "rb";
  const bandsTable = bandsTableForSource(bandSource);

  const monthIdx = month - 1;
  const periodStart = new Date(Date.UTC(year, monthIdx, 1));
  const periodEnd = new Date(Date.UTC(year, monthIdx + 1, 0));
  const prevMonthEnd = new Date(Date.UTC(year, monthIdx, 0));
  const startStr = periodStart.toISOString().split("T")[0];
  const endStr = periodEnd.toISOString().split("T")[0];
  const prevEndStr = prevMonthEnd.toISOString().split("T")[0];
  const statementMonth = startStr; // YYYY-MM-01

  // ── Customer + strategy ────────────────────────────────────────────
  const { data: customer, error: customerErr } = await supabase
    .schema("public")
    .from("customer_details")
    .select("customer_id, first_names, last_name, email, org_id, trade_start_date, account_model")
    .eq("customer_id", customerId)
    .single();
  if (customerErr || !customer) throw new Error(`Customer ${customerId} not found`);

  const { data: strategies, error: strategyErr } = await supabase
    .schema("public")
    .from("customer_strategies")
    .select("*")
    .eq("customer_id", customerId)
    .eq("org_id", orgId);
  if (strategyErr || !strategies?.length) throw new Error(`No strategy for customer ${customerId}`);
  const strategy = strategies[0];
  const perfRate = Number(strategy.performance_fee_rate ?? 0.10);
  const platRate = Number(strategy.platform_fee_rate ?? 0.0075);
  const perfSchedule = String(strategy.performance_fee_schedule ?? "monthly");
  const platSchedule = String(strategy.platform_fee_schedule ?? "immediate");
  // Inception = the date the customer's account became active. We prefer the
  // human-curated `customer_details.trade_start_date` and fall back to the
  // strategy creation timestamp only when no activation date has been recorded.
  const inceptionDate = customer.trade_start_date
    ? new Date(customer.trade_start_date + "T00:00:00Z")
    : (strategy.created_at ? new Date(strategy.created_at) : periodStart);
  const accountModel = String(customer.account_model ?? "subaccount").toLowerCase();
  const exchangeLabel = accountModel === "api" ? "VALR (API)" : "VALR (subaccount)";

  // ── Balances (opening = last row ≤ prev-month-end; closing = last row ≤ end) ──
  const { data: openingBal } = await supabase
    .schema("lth_pvr")
    .from("balances_daily")
    .select("date, btc_balance, usdt_balance, nav_usd")
    .eq("org_id", orgId)
    .eq("customer_id", customerId)
    .lte("date", prevEndStr)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: closingBal } = await supabase
    .schema("lth_pvr")
    .from("balances_daily")
    .select("date, btc_balance, usdt_balance, usdpc_balance, usdpc_price_usd, nav_usd")
    .eq("org_id", orgId)
    .eq("customer_id", customerId)
    .lte("date", endStr)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const openingNav = Number(openingBal?.nav_usd ?? 0);
  const closingNav = Number(closingBal?.nav_usd ?? 0);
  const btcBalance = Number(closingBal?.btc_balance ?? 0);
  const usdtBalance = Number(closingBal?.usdt_balance ?? 0);
  const usdpcBalance = Number(closingBal?.usdpc_balance ?? 0);
  const usdpcPriceUsd = Number(closingBal?.usdpc_price_usd ?? 1);
  const usdpcValueUsd = usdpcBalance * (usdpcPriceUsd > 0 ? usdpcPriceUsd : 1);

  // ── Inception NAV (for honest CAGR — not the broken month-open one) ──
  const inceptionStr = inceptionDate.toISOString().split("T")[0];
  const { data: inceptionBal } = await supabase
    .schema("lth_pvr")
    .from("balances_daily")
    .select("date, nav_usd")
    .eq("org_id", orgId)
    .eq("customer_id", customerId)
    .gte("date", inceptionStr)
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();
  const inceptionNav = Number(inceptionBal?.nav_usd ?? 0);
  const inceptionAnchorStr = inceptionBal?.date ?? inceptionStr;

  // ── Transactions for the month ────────────────────────────────────
  // NB: lth_pvr.ledger_lines does NOT have an exchange_rate column. Selecting
  // a non-existent column makes PostgREST return null `data` silently, which
  // previously caused the entire Performance Summary + Transaction History to
  // render as empty (issues #2 and #6, 2026-05-01 review).
  const { data: txRows, error: txRowsErr } = await supabase
    .schema("lth_pvr")
    .from("ledger_lines")
    .select("trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, performance_fee_usdt, platform_fee_usdt, platform_fee_btc, note")
    .eq("org_id", orgId)
    .eq("customer_id", customerId)
    .gte("trade_date", startStr)
    .lte("trade_date", endStr)
    .order("trade_date", { ascending: true });
  if (txRowsErr) {
    console.error("[ef_generate_statement] ledger_lines query failed:", txRowsErr);
  }

  // ── BTC price (used for fee USD conversion when the line is BTC-denominated) ──
  const { data: ciRow } = await supabase
    .schema("lth_pvr")
    .from(bandsTable)
    .select("date, btc_price")
    .lte("date", endStr)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const btcPrice = Number(ciRow?.btc_price ?? 0);

  // ── FX rate (USDT/ZAR) ──
  // ledger_lines does not carry a per-fill USD/ZAR rate, and pending_zar_conversions
  // has not yet recorded a completed conversion. As a pragmatic best-effort, fetch
  // VALR's public USDT/ZAR mid-price (no auth required) so the closing-NAV ZAR
  // equivalent and the FX-rate footer row render with a real number rather than
  // an em-dash. This is an "as-of statement-generation" rate, not the rate that
  // was applied to any specific historical fill — the footer label makes that
  // explicit. If the call fails the value falls back to 0 and the report
  // gracefully renders "—" exactly as before.
  let fxRate = 0;
  let fxSourceLabel = "No FX rate available";
  try {
    const fxRes = await fetch("https://api.valr.com/v1/public/USDTZAR/marketsummary", {
      headers: { "Accept": "application/json" },
    });
    if (fxRes.ok) {
      const fxJson = await fxRes.json();
      const bid = Number(fxJson?.bidPrice ?? 0);
      const ask = Number(fxJson?.askPrice ?? 0);
      const last = Number(fxJson?.lastTradedPrice ?? 0);
      const mid = (bid > 0 && ask > 0) ? (bid + ask) / 2 : last;
      if (mid > 0) {
        fxRate = mid;
        fxSourceLabel = `As of ${fmtTimestampUtc(new Date())} · VALR USDT/ZAR mid`;
      }
    }
  } catch (e) {
    console.warn("[ef_generate_statement] VALR USDT/ZAR fetch failed:", (e as Error).message);
  }

  // ── Aggregates from ledger_lines (raw legs) ───────────────────────
  // Summary figures are computed from the raw ledger_lines legs (not the merged
  // conversion view) because they need performance_fee_usdt and the per-leg
  // deposit/withdrawal classification. Conversion legs net out correctly here:
  // the ZAR in/out legs carry 0 USDT, so contributions reflect the USDT result.
  let contributionsUsd = 0;
  let withdrawalsUsd = 0;
  let exchangeFeesUsd = 0;
  let platformFeeUsdtSum = 0;
  let platformFeeBtcSum = 0;
  let performanceFeeUsdtSum = 0;
  let totalBtc = 0;
  let totalUsdt = 0;
  let totalZar = 0;

  for (const t of txRows ?? []) {
    const amtBtc = Number(t.amount_btc ?? 0);
    const amtUsdt = Number(t.amount_usdt ?? 0);
    const amtZar = Number(t.amount_zar ?? 0);
    const feeBtc = Number(t.fee_btc ?? 0);
    const feeUsdt = Number(t.fee_usdt ?? 0);
    const platFeeUsdt = Number(t.platform_fee_usdt ?? 0);
    const platFeeBtc = Number(t.platform_fee_btc ?? 0);
    const perfFeeUsdt = Number(t.performance_fee_usdt ?? 0);

    totalBtc += amtBtc;
    totalUsdt += amtUsdt;
    totalZar += amtZar;
    exchangeFeesUsd += feeUsdt + (feeBtc * btcPrice);
    platformFeeUsdtSum += platFeeUsdt;
    platformFeeBtcSum += platFeeBtc;
    performanceFeeUsdtSum += perfFeeUsdt;

    const kind = String(t.kind ?? "").toLowerCase();
    if (kind === "deposit" || kind === "topup") contributionsUsd += amtUsdt;
    if (kind === "withdrawal" || kind === "withdraw") withdrawalsUsd += Math.abs(amtUsdt);
  }

  const platformFeeUsdSum = platformFeeUsdtSum + (platformFeeBtcSum * btcPrice);

  // ── Transaction-history display rows (merged conversions) ─────────
  // Reuse public.list_customer_transactions — the same RPC the customer portal
  // uses — so multi-leg ZAR<->USDT conversions collapse into a single
  // "conversion" row (grouped on conversion_metadata.original_transaction_id /
  // conversion_approval_id) instead of separate ZAR-withdrawal + USDT-topup legs.
  // The RPC returns all four fee columns, letting the Fees cell show exchange
  // and platform fees in both BTC and USDT, matching the portal exactly.
  const { data: mergedTx, error: mergedTxErr } = await supabase
    .schema("public")
    .rpc("list_customer_transactions", { p_customer_id: customerId, p_limit: 1000 });
  if (mergedTxErr) {
    console.error("[ef_generate_statement] list_customer_transactions RPC failed:", mergedTxErr);
  }

  // Keep only this statement month, ascending for running-balance accumulation.
  const monthTx = ((mergedTx ?? []) as Array<Record<string, unknown>>)
    .filter((t) => {
      const d = String(t.trade_date ?? "");
      return d >= startStr && d <= endStr;
    })
    .sort((a, b) => {
      const ad = String(a.trade_date ?? ""), bd = String(b.trade_date ?? "");
      if (ad !== bd) return ad < bd ? -1 : 1;
      const ac = String(a.created_at ?? ""), bc = String(b.created_at ?? "");
      return ac < bc ? -1 : (ac > bc ? 1 : 0);
    });

  let runningBtc = Number(openingBal?.btc_balance ?? 0);
  let runningUsdt = Number(openingBal?.usdt_balance ?? 0);
  const rows: StatementTransactionRow[] = [];
  for (const t of monthTx) {
    const amtBtc = Number(t.amount_btc ?? 0);
    const amtUsdt = Number(t.amount_usdt ?? 0);
    const amtZar = Number(t.amount_zar ?? 0);
    const feeBtc = Number(t.fee_btc ?? 0);
    const feeUsdt = Number(t.fee_usdt ?? 0);
    const platFeeBtc = Number(t.platform_fee_btc ?? 0);
    const platFeeUsdt = Number(t.platform_fee_usdt ?? 0);

    runningBtc += amtBtc;
    runningUsdt += amtUsdt;

    const kind = String(t.kind ?? "").toLowerCase();
    const typeLabel = kind === "topup" ? "deposit" : kind;

    // Stack every non-zero fee on its own line so all four fee types from the
    // portal (exchange BTC/USDT, platform BTC/USDT) are visible in one row.
    const fees: string[] = [];
    if (feeBtc > 0)      fees.push(`Exch ${feeBtc.toFixed(8)} BTC`);
    if (feeUsdt > 0)     fees.push(`Exch $${feeUsdt.toFixed(2)}`);
    if (platFeeBtc > 0)  fees.push(`Plat ${platFeeBtc.toFixed(8)} BTC`);
    if (platFeeUsdt > 0) fees.push(`Plat $${platFeeUsdt.toFixed(2)}`);

    rows.push({
      date: fmtDateLong(t.trade_date as string),
      type: typeLabel,
      btc: amtBtc !== 0 ? (amtBtc > 0 ? "+ " : "– ") + Math.abs(amtBtc).toFixed(8) : "—",
      usdt: amtUsdt !== 0 ? (amtUsdt > 0 ? "+ " : "– ") + Math.abs(amtUsdt).toFixed(2) : "—",
      zar: amtZar !== 0 ? (amtZar > 0 ? "+ " : "– ") + Math.abs(amtZar).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—",
      fees,
      btc_balance: runningBtc.toFixed(8),
      usdt_balance: runningUsdt.toFixed(2),
    });
  }
  const txCount = rows.length;

  // ── Standard DCA benchmark ────────────────────────────────────────
  const { data: stdClosing } = await supabase
    .schema("lth_pvr")
    .from("std_dca_balances_daily")
    .select("date, nav_usd")
    .eq("customer_id", customerId)
    .lte("date", endStr)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: stdInception } = await supabase
    .schema("lth_pvr")
    .from("std_dca_balances_daily")
    .select("date, nav_usd")
    .eq("customer_id", customerId)
    .gte("date", inceptionStr)
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();
  const stdClosingNav = Number(stdClosing?.nav_usd ?? 0);
  const stdInceptionNav = Number(stdInception?.nav_usd ?? 0);

  // ── Cost basis = cumulative net contributions to date ──
  const { data: contribAll } = await supabase
    .schema("lth_pvr")
    .from("ledger_lines")
    .select("kind, amount_usdt")
    .eq("org_id", orgId)
    .eq("customer_id", customerId)
    .in("kind", ["deposit", "topup", "withdrawal"])
    .lte("trade_date", endStr);
  const costBasisUsd = (contribAll ?? []).reduce((s: number, r: any) => {
    const kind = String(r.kind ?? "").toLowerCase();
    const amt = Number(r.amount_usdt ?? 0);
    if (kind === "deposit" || kind === "topup") return s + amt;
    if (kind === "withdrawal" || kind === "withdraw") return s - Math.abs(amt);
    return s;
  }, 0);

  // ── Returns ────────────────────────────────────────────────────────
  const netChange = closingNav - openingNav;
  const netChangePct = openingNav > 0 ? (netChange / openingNav) * 100 : 0;
  const tradingPnl = closingNav - openingNav - contributionsUsd + withdrawalsUsd;

  const itdRoi = costBasisUsd > 0 ? ((closingNav - costBasisUsd) / costBasisUsd) * 100 : 0;
  const stdItdRoi = costBasisUsd > 0 ? ((stdClosingNav - costBasisUsd) / costBasisUsd) * 100 : 0;

  const yearsSinceInception = Math.max(
    (periodEnd.getTime() - new Date(inceptionAnchorStr + "T00:00:00Z").getTime()) / (365.25 * 86400 * 1000),
    1 / 365,
  );
  const cagr = inceptionNav > 0
    ? (Math.pow(closingNav / inceptionNav, 1 / yearsSinceInception) - 1) * 100
    : 0;
  const stdCagr = stdInceptionNav > 0
    ? (Math.pow(stdClosingNav / stdInceptionNav, 1 / yearsSinceInception) - 1) * 100
    : 0;

  const twr = openingNav > 0
    ? (((closingNav - (contributionsUsd - withdrawalsUsd)) / openingNav) - 1) * 100
    : 0;

  // ── Fee classification per Mockup B ───────────────────────────────
  const accruedFees: StatementFeeRow[] = [];
  const deductedFees: StatementFeeRow[] = [];
  // Year-to-date accrual is split between platform and performance so customers
  // can distinguish the two on the PDF (issue #5, 2026-05-01 review).
  let accruedYtdPlatformUsd = 0;
  let accruedYtdPerformanceUsd = 0;
  let nextBillingDateLabel = "—";

  const totalFeesDeductedUsd = exchangeFeesUsd
    + (platSchedule === "immediate" ? platformFeeUsdSum : 0)
    + (perfSchedule !== "annual" ? performanceFeeUsdtSum : 0);

  if (platSchedule === "immediate" && platformFeeUsdSum > 0) {
    deductedFees.push({
      label: `Platform fee (${(platRate * 100).toFixed(2).replace(/\.?0+$/, "")}% of net contributions)`,
      amount_usd: fmtUsd(platformFeeUsdSum),
    });
  }
  if (perfSchedule !== "annual" && performanceFeeUsdtSum > 0) {
    deductedFees.push({
      label: `Performance fee (${(perfRate * 100).toFixed(2).replace(/\.?0+$/, "")}% of monthly gain, HWM)`,
      amount_usd: fmtUsd(performanceFeeUsdtSum),
    });
  }
  if (exchangeFeesUsd > 0) {
    deductedFees.push({ label: "Exchange fees (VALR fills)", amount_usd: fmtUsd(exchangeFeesUsd) });
  }

  // ── HWM lookup (used by the interim performance-fee formula and the strategy block) ──
  const { data: hwmRow } = await supabase
    .schema("lth_pvr")
    .from("customer_state_daily")
    .select("high_water_mark_usd, hwm_contrib_net_cum")
    .eq("org_id", orgId)
    .eq("customer_id", customerId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const hwmUsd = Number(hwmRow?.high_water_mark_usd ?? 0);
  const hwmContribCum = Number(hwmRow?.hwm_contrib_net_cum ?? 0);

  // ── Fee threshold (the figure shown as "High-water mark" on the statement) ──
  // high_water_mark_usd is the *profit-only* baseline (max(0, NAV − net
  // contributions)), which only ratchets when a performance fee is actually
  // charged. For a never-profited customer it is $0, so the bare value is
  // meaningless on its own. The figure customers care about is the level their
  // NAV must exceed before any new performance fee accrues:
  //   threshold = HWM + contributions_since_HWM
  //   contributions_since_HWM = max(0, cum_net_contrib_to_date − hwm_contrib_net_cum)
  // This matches the Customer Portal's "Fee Threshold (HWM)" line.
  const contribsSinceHwm = Math.max(0, costBasisUsd - hwmContribCum);
  const hwmThreshold = hwmUsd + contribsSinceHwm;

  // ── Annual accrual lookup (if either fee is on annual schedule) ──
  if (platSchedule === "annual" || perfSchedule === "annual") {
    const { data: accrualRows } = await supabase
      .schema("lth_pvr")
      .from("annual_fee_accrual")
      .select("accrual_year, accrued_platform_fee_btc, accrued_platform_fee_usdt, accrued_performance_fee_usdt, settled_at")
      .eq("org_id", orgId)
      .eq("customer_id", customerId)
      .order("accrual_year", { ascending: false });
    const latestAccrual =
      (accrualRows ?? []).find((r: any) => r.settled_at == null) ?? accrualRows?.[0];

    if (platSchedule === "annual") {
      const accruedPlatUsd =
        Number(latestAccrual?.accrued_platform_fee_usdt ?? 0) +
        Number(latestAccrual?.accrued_platform_fee_btc ?? 0) * btcPrice;
      if (platformFeeUsdSum > 0) {
        accruedFees.push({
          label: `Platform fee — ${MONTH_NAMES[monthIdx]} ${year}`,
          amount_usd: fmtUsd(platformFeeUsdSum),
        });
      }
      accruedYtdPlatformUsd += accruedPlatUsd;
    }
    if (perfSchedule === "annual") {
      // Interim monthly slice using the proper HWM-aware formula:
      //   gain_above_hwm = max(0, closingNav - HWM - contributions_since_HWM)
      //   contributions_since_HWM = cum_net_contrib_to_date - hwm_contrib_net_cum
      // This prevents deposits from being treated as performance (issue #4).
      const interimMonthlyPerfUsd = Math.max(0, closingNav - hwmThreshold) * perfRate;
      if (interimMonthlyPerfUsd > 0) {
        accruedFees.push({
          label: `Performance fee — ${MONTH_NAMES[monthIdx]} ${year} (interim)`,
          amount_usd: fmtUsd(interimMonthlyPerfUsd),
        });
      }
      accruedYtdPerformanceUsd += Number(latestAccrual?.accrued_performance_fee_usdt ?? 0);
    }

    // Anniversary = next yearly anniversary of inception after today.
    const today = new Date();
    const anniv = new Date(Date.UTC(today.getUTCFullYear(), inceptionDate.getUTCMonth(), inceptionDate.getUTCDate()));
    if (anniv.getTime() <= today.getTime()) {
      anniv.setUTCFullYear(anniv.getUTCFullYear() + 1);
    }
    nextBillingDateLabel = fmtDateLong(anniv.toISOString().split("T")[0]);
  }

  if (deductedFees.length === 0) {
    deductedFees.push({ label: "No fees deducted this month", amount_usd: "—" });
  }

  // ── Spark line: last 30 days of NAV vs Std DCA, normalised 0..1 ──
  const sparkStart = new Date(periodEnd.getTime() - 29 * 86400 * 1000).toISOString().split("T")[0];
  const [{ data: lthPts }, { data: stdPts }] = await Promise.all([
    supabase.schema("lth_pvr").from("balances_daily")
      .select("date, nav_usd").eq("org_id", orgId).eq("customer_id", customerId)
      .gte("date", sparkStart).lte("date", endStr).order("date", { ascending: true }),
    supabase.schema("lth_pvr").from("std_dca_balances_daily")
      .select("date, nav_usd").eq("customer_id", customerId)
      .gte("date", sparkStart).lte("date", endStr).order("date", { ascending: true }),
  ]);
  const allVals = [...(lthPts ?? []), ...(stdPts ?? [])].map((p: any) => Number(p.nav_usd ?? 0));
  const minV = allVals.length ? Math.min(...allVals) : 0;
  const maxV = allVals.length ? Math.max(...allVals) : 1;
  const range = Math.max(maxV - minV, 1e-9);
  const norm = (rs: any[] | null): StatementSparkPoint[] => {
    if (!rs?.length) return [];
    const n = rs.length;
    return rs.map((r, i) => ({
      x: n === 1 ? 1 : i / (n - 1),
      y: (Number(r.nav_usd ?? 0) - minV) / range,
    }));
  };
  const sparkLthPoints = norm(lthPts ?? null);
  const sparkStdPoints = norm(stdPts ?? null);
  const showChart = sparkLthPoints.length >= 2 || sparkStdPoints.length >= 2;

  // ── Filename + storage path ────────────────────────────────────────
  const lastName = String(customer.last_name ?? "").replace(/\s+/g, "_");
  const firstNames = String(customer.first_names ?? "").replace(/\s+/g, "_");
  const monthPadded = String(month).padStart(2, "0");
  const filename = `${endStr}_${lastName}_${firstNames}_statement_M${monthPadded}_${year}.pdf`;
  const storagePath = `${orgId}/customer-${customerId}/${filename}`;

  const outperfPp = itdRoi - stdItdRoi;

  const data: StatementData = {
    customer_name: `${customer.first_names} ${customer.last_name}`.trim(),
    customer_id: customerId,
    period_label: `1 – ${periodEnd.getUTCDate()} ${MONTH_NAMES[monthIdx]} ${year}`,
    generated_at: fmtTimestampUtc(new Date()),
    statement_filename: filename,

    closing_nav_usd: fmtUsd(closingNav),
    closing_nav_zar: fxRate > 0 ? fmtZar(closingNav * fxRate) : "—",
    net_change_usd: fmtUsd(netChange, true),
    net_change_pct: fmtPct(netChangePct),
    net_change_positive: netChange >= 0,
    btc_balance: fmtBtc(btcBalance),
    btc_balance_sub: btcBalance > 0 ? `≈ ${fmtUsd(btcBalance * btcPrice)}` : "Awaiting next buy signal",
    usdt_balance_usd: fmtUsd(usdtBalance),
    usdt_balance_sub: usdtBalance > 0 ? "Available for trading" : "—",
    usdpc_show: usdpcValueUsd > 0.005,
    usdpc_balance_usd: fmtUsd(usdpcValueUsd),
    usdpc_balance_sub: "Yield-earning idle cash",

    opening_date: fmtDateLong(prevEndStr),
    closing_date: fmtDateLong(endStr),
    opening_nav_usd: fmtUsd(openingNav),
    contributions_usd: fmtUsd(contributionsUsd, true),
    withdrawals_usd: withdrawalsUsd > 0 ? `– ${fmtUsd(withdrawalsUsd)}` : "– $ 0.00",
    trading_pnl_usd: fmtUsd(tradingPnl, true),
    trading_pnl_positive: tradingPnl >= 0,
    fees_deducted_usd: `– ${fmtUsd(totalFeesDeductedUsd)}`,
    twr_pct: fmtPct(twr),
    twr_positive: twr >= 0,
    itd_roi_pct: fmtPct(itdRoi),
    itd_roi_positive: itdRoi >= 0,
    cagr_pct: fmtPct(cagr),
    cagr_positive: cagr >= 0,
    cost_basis_usd: fmtUsd(costBasisUsd),
    fx_rate_label: fxRate > 0 ? `USD 1 = ZAR ${fxRate.toFixed(2)}` : "—",
    fx_source_label: fxRate > 0 ? fxSourceLabel : "No FX rate available",

    show_chart: showChart,
    chart_lth_points: sparkLthPoints,
    chart_std_points: sparkStdPoints,
    chart_lth_label: `LTH PVR DCA — ${fmtUsd(closingNav)}`,
    chart_std_label: `Standard DCA benchmark — ${fmtUsd(stdClosingNav)}`,

    deducted_fees: deductedFees,
    deducted_total_usd: fmtUsd(totalFeesDeductedUsd),
    show_accrued_block: accruedFees.length > 0 || accruedYtdPlatformUsd > 0 || accruedYtdPerformanceUsd > 0,
    accrued_fees: accruedFees,
    accrued_ytd_platform_usd: fmtUsd(accruedYtdPlatformUsd),
    accrued_ytd_performance_usd: fmtUsd(accruedYtdPerformanceUsd),
    next_billing_date: nextBillingDateLabel,

    std_dca_closing_nav_usd: fmtUsd(stdClosingNav),
    std_dca_roi_pct: fmtPct(stdItdRoi),
    std_dca_cagr_pct: fmtPct(stdCagr),
    outperformance_label: fmtPp(outperfPp),
    outperformance_positive: outperfPp >= 0,

    transactions: rows,
    tx_count: txCount,
    tx_total_btc: totalBtc.toFixed(8),
    tx_total_usdt: totalUsdt.toFixed(2),
    tx_total_zar: totalZar.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    tx_total_fees_usd: (exchangeFeesUsd + platformFeeUsdSum).toFixed(2),

    strategy_name: strategy.strategy_code === "STD_DCA" ? "Standard Bitcoin DCA" : "LTH PVR Bitcoin DCA",
    strategy_status: String(strategy.status ?? (strategy.live_enabled ? "active" : "paused")).replace(/^\w/, (c: string) => c.toUpperCase()),
    exchange_label: exchangeLabel,
    inception_label: fmtDateLong(inceptionDate.toISOString().split("T")[0]),
    platform_fee_label: `${(platRate * 100).toFixed(2)} % · ${platSchedule}`,
    performance_fee_label: `${(perfRate * 100).toFixed(2)} % · ${perfSchedule} (HWM)`,
    next_anniversary_label: nextBillingDateLabel,
    hwm_usd: hwmThreshold > 0 ? fmtUsd(hwmThreshold) : "—",
  };

  return { data, filename, storagePath, statementMonth };
}

// ─────────────────────────────────────────────────────────────────────────────
// Request handler
// ─────────────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ORG_ID) {
    return new Response(
      JSON.stringify({ error: "Missing required env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID)" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    db: { schema: "lth_pvr" },
  });

  try {
    const url = new URL(req.url);
    const previewMode = url.searchParams.get("preview") === "html";

    const body = await req.json().catch(() => ({}));
    const customer_id = Number(body.customer_id);
    const year = Number(body.year);
    const month = Number(body.month);
    const force = body.force === true;

    if (!customer_id || !year || !month || month < 1 || month > 12) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid parameters: customer_id, year, month (1-12)" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const built = await buildStatementData({
      supabase, orgId: ORG_ID, customerId: customer_id, year, month,
      bandSource: normaliseBandSource(body?.band_source),
    });

    const html = renderStatementHtml(built.data);

    // Preview mode: return HTML, no PDF, no DB writes.
    if (previewMode) {
      return new Response(html, {
        status: 200,
        headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Idempotency check (skippable with force=true).
    if (!force) {
      const { data: existing } = await supabase
        .from("statements_sent")
        .select("statement_id, storage_path")
        .eq("org_id", ORG_ID)
        .eq("customer_id", customer_id)
        .eq("statement_month", built.statementMonth)
        .maybeSingle();
      if (existing) {
        const { data: signed } = await supabase.storage
          .from("customer-statements")
          .createSignedUrl(existing.storage_path, 60 * 60 * 24 * 365);
        return new Response(
          JSON.stringify({
            success: true,
            already_generated: true,
            filename: built.filename,
            downloadUrl: signed?.signedUrl ?? "",
            message: "Statement already generated for this period; pass force=true to regenerate.",
          }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
    }

    const pdfBytes = await htmlToPdf(html);

    const { error: uploadErr } = await supabase.storage
      .from("customer-statements")
      .upload(built.storagePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    const { data: signed } = await supabase.storage
      .from("customer-statements")
      .createSignedUrl(built.storagePath, 60 * 60 * 24 * 365);
    const downloadUrl = signed?.signedUrl ?? "";

    await supabase
      .from("statements_sent")
      .upsert({
        org_id: ORG_ID,
        customer_id,
        statement_month: built.statementMonth,
        storage_path: built.storagePath,
        filename: built.filename,
        download_url: downloadUrl,
        pdf_bytes: pdfBytes.byteLength,
        generated_at: new Date().toISOString(),
        generator_version: "v2-html",
      }, { onConflict: "org_id,customer_id,statement_month" });

    return new Response(
      JSON.stringify({
        success: true,
        filename: built.filename,
        downloadUrl,
        bytes: pdfBytes.byteLength,
        message: "Statement generated and uploaded successfully",
      }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    console.error("[ef_generate_statement] error:", message);
    try {
      await logAlert(
        supabase,
        "ef_generate_statement",
        "error",
        message,
        { stack: (error as Error).stack?.slice(0, 1000) },
        ORG_ID,
        null,
      );
    } catch (_) { /* best-effort */ }
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
