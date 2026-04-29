// _shared/statement_template.ts
// Renders the monthly customer statement HTML. The same HTML is used as input to
// the Browserless PDF endpoint AND served as a preview in-browser. There are no
// runtime template-engine dependencies — we use a tiny mustache-style replacer.

import { BRAND } from "./branding.ts";

export interface StatementFeeRow {
  /** "Platform fee (0.75%)" */
  label: string;
  /** Formatted USD amount, e.g. "$ 6.13"; pass empty string to render "—". */
  amount_usd: string;
}

export interface StatementTransactionRow {
  /** ISO date — already formatted for display, e.g. "26 Mar 2026". */
  date: string;
  /** "deposit" | "buy" | "sell" | "platform fee" | "performance fee" | "exchange fee" | "withdraw" */
  type: string;
  /** Pre-formatted strings — pass "—" or "" for empty cells. */
  btc: string;
  usdt: string;
  zar: string;
  fee_usd: string;
  btc_balance: string;
  usdt_balance: string;
}

export interface StatementSparkPoint {
  /** Position 0..1 along the X axis. */
  x: number;
  /** Position 0..1 along the Y axis where 0 = bottom, 1 = top. */
  y: number;
}

export interface StatementData {
  // ── Identity ──────────────────────────────────────────────────────────
  customer_name: string;
  customer_id: number | string;
  period_label: string;          // "1 – 31 March 2026"
  generated_at: string;          // "29 Apr 2026 14:32 UTC"
  statement_filename: string;    // shown in the footer

  // ── KPI strip ────────────────────────────────────────────────────────
  closing_nav_usd: string;
  closing_nav_zar: string;
  net_change_usd: string;
  net_change_pct: string;
  net_change_positive: boolean;
  btc_balance: string;
  btc_balance_sub: string;       // small caption, e.g. "Awaiting next buy signal"
  usdt_balance_usd: string;
  usdt_balance_sub: string;

  // ── Performance summary ──────────────────────────────────────────────
  opening_date: string;          // "28 Feb 2026"
  closing_date: string;          // "31 Mar 2026"
  opening_nav_usd: string;
  contributions_usd: string;
  withdrawals_usd: string;
  trading_pnl_usd: string;
  trading_pnl_positive: boolean;
  fees_deducted_usd: string;
  twr_pct: string;
  twr_positive: boolean;
  itd_roi_pct: string;
  itd_roi_positive: boolean;
  cagr_pct: string;
  cagr_positive: boolean;
  cost_basis_usd: string;
  fx_rate_label: string;         // "USD 1 = ZAR 18.42"
  fx_source_label: string;       // "VALR · 29 Apr 2026 14:32 UTC"

  // ── Spark line ───────────────────────────────────────────────────────
  show_chart: boolean;
  chart_lth_points: StatementSparkPoint[];
  chart_std_points: StatementSparkPoint[];
  chart_lth_label: string;       // "LTH PVR DCA — $ 1 122.57"
  chart_std_label: string;       // "Standard DCA benchmark — $ 903.68"

  // ── Fees (Mockup B) ─────────────────────────────────────────────────
  deducted_fees: StatementFeeRow[];
  deducted_total_usd: string;
  show_accrued_block: boolean;
  accrued_fees: StatementFeeRow[];
  accrued_ytd_usd: string;
  next_billing_date: string;     // "15 Jan 2027"

  // ── Benchmark comparison ────────────────────────────────────────────
  std_dca_closing_nav_usd: string;
  std_dca_roi_pct: string;
  std_dca_cagr_pct: string;
  outperformance_label: string;  // "+19.88 pp"
  outperformance_positive: boolean;

  // ── Transactions ────────────────────────────────────────────────────
  transactions: StatementTransactionRow[];
  tx_count: number;
  tx_total_btc: string;
  tx_total_usdt: string;
  tx_total_zar: string;
  tx_total_fees_usd: string;

  // ── Strategy details ────────────────────────────────────────────────
  strategy_name: string;
  strategy_status: string;       // "Active" | "Paused"
  exchange_label: string;        // "VALR (subaccount)"
  inception_label: string;       // "15 Jan 2026"
  platform_fee_label: string;    // "0.75 % · immediate"
  performance_fee_label: string; // "10.00 % · annual (HWM)"
  next_anniversary_label: string; // "15 Jan 2027"
  hwm_usd: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML escape — defensive, even though all incoming data should already be safe.
// ─────────────────────────────────────────────────────────────────────────────
function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline SVG sparkline. `points` are normalised 0..1 in both axes.
// ─────────────────────────────────────────────────────────────────────────────
function renderSpark(points: StatementSparkPoint[], stroke: string, dashed: boolean): string {
  if (!points?.length) return "";
  const W = 600;
  const H = 110;
  const pad = 6;
  const polyPoints = points
    .map((p) => {
      const x = pad + p.x * (W - 2 * pad);
      const y = pad + (1 - p.y) * (H - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const dash = dashed ? ' stroke-dasharray="4,3"' : "";
  return `<polyline fill="none" stroke="${stroke}" stroke-width="${dashed ? 2 : 2.5}"${dash} points="${polyPoints}" />`;
}

function renderFeeRows(rows: StatementFeeRow[]): string {
  if (!rows?.length) return `<tr><td class="k">No fees this period</td><td class="v">—</td></tr>`;
  return rows
    .map(
      (r) =>
        `<tr><td class="k">${escapeHtml(r.label)}</td><td class="v">${escapeHtml(r.amount_usd) || "—"}</td></tr>`,
    )
    .join("");
}

function renderTxRows(rows: StatementTransactionRow[]): string {
  if (!rows?.length) {
    return `<tr><td colspan="8" style="text-align:center; color:#6b7280; padding:14px;">No transactions this month</td></tr>`;
  }
  const tagClass = (kind: string) => {
    const k = kind.toLowerCase();
    if (k.includes("deposit")) return "deposit";
    if (k.includes("buy")) return "buy";
    if (k.includes("fee")) return "fee";
    if (k.includes("withdraw") || k.includes("sell")) return "withdraw";
    return "buy";
  };
  return rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.date)}</td>
        <td><span class="tag ${tagClass(r.type)}">${escapeHtml(r.type)}</span></td>
        <td class="num">${escapeHtml(r.btc) || "—"}</td>
        <td class="num">${escapeHtml(r.usdt) || "—"}</td>
        <td class="num">${escapeHtml(r.zar) || "—"}</td>
        <td class="num">${escapeHtml(r.fee_usd) || "—"}</td>
        <td class="num">${escapeHtml(r.btc_balance) || "—"}</td>
        <td class="num">${escapeHtml(r.usdt_balance) || "—"}</td>
      </tr>`,
    )
    .join("");
}

export function renderStatementHtml(d: StatementData): string {
  const e = escapeHtml;
  const navy = BRAND.navy;
  const gold = BRAND.gold;
  const sparkLth = d.show_chart ? renderSpark(d.chart_lth_points, navy, false) : "";
  const sparkStd = d.show_chart ? renderSpark(d.chart_std_points, "#94a3b8", true) : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>BitWealth Statement — ${e(d.customer_name)} — ${e(d.period_label)}</title>
<style>
  @page { size: A4; margin: 11mm 16mm 22mm 16mm; }
  :root {
    --navy: ${navy};
    --gold: ${gold};
    --ink:   #1f2937;
    --muted: #6b7280;
    --line:  #e5e7eb;
    --soft:  #f8fafc;
    --green: #10b981;
    --red:   #dc2626;
    --amber: #f59e0b;
  }
  * { box-sizing: border-box; }
  html, body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    font-size: 10.5pt;
    line-height: 1.45;
    margin: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { max-width: 178mm; margin: 0 auto; padding: 6mm 0; }

  header.brand { display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; border-bottom: 2px solid var(--navy); }
  header.brand .logo { display: flex; align-items: center; gap: 12px; }
  header.brand .logo img { height: 180px; width: 180px; display: block; max-width: none; }
  header.brand .meta { text-align: right; font-size: 9.5pt; }
  header.brand .meta .title { font-size: 13pt; font-weight: 700; color: var(--navy); }
  header.brand .meta .row { margin-top: 2px; }
  header.brand .meta .row span { color: var(--muted); margin-right: 4px; }

  h2.section { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.6px; color: var(--navy); margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }

  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
  .kpi  { background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; }
  .kpi .label { font-size: 8pt; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; }
  .kpi .value { font-size: 14pt; font-weight: 700; color: var(--navy); margin-top: 4px; }
  .kpi .sub   { font-size: 8.5pt; color: var(--muted); margin-top: 2px; }
  .pos { color: var(--green); }
  .neg { color: var(--red); }

  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  /* Avoid awkward page splits inside cards, fee blocks, the spark line and any
     of the data tables. Browsers will move the entire block to the next page
     instead of cutting it in half. */
  table, .kpi, .fee-block, .spark, .outperf, .disclaim {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  table tr, table thead, table tfoot { page-break-inside: avoid; break-inside: avoid; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  h2.section { page-break-after: avoid; break-after: avoid; }

  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  table.kv td { padding: 4px 0; vertical-align: top; }
  table.kv td.k { color: var(--muted); }
  table.kv td.v { text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
  table.kv tr.total td { border-top: 1px solid var(--line); padding-top: 8px; font-weight: 700; color: var(--navy); }

  table.tx { margin-top: 6px; }
  table.tx th, table.tx td { padding: 6px 6px; border-bottom: 1px solid var(--line); font-size: 9.5pt; }
  table.tx th { background: var(--navy); color: #fff; text-align: left; font-weight: 600; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.4px; }
  table.tx td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.tx tfoot td { font-weight: 700; border-top: 2px solid var(--navy); border-bottom: none; padding-top: 8px; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 8.5pt; font-weight: 600; }
  .tag.deposit  { background: #dcfce7; color: #166534; }
  .tag.buy      { background: #dbeafe; color: #1e40af; }
  .tag.fee      { background: #fef3c7; color: #92400e; }
  .tag.withdraw { background: #fee2e2; color: #991b1b; }

  .fee-block { border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; background: #fff; }
  .fee-block + .fee-block { margin-top: 10px; }
  .fee-block.accrued { border-color: var(--amber); background: #fffbeb; }
  .fee-block h3 { margin: 0 0 6px; font-size: 10.5pt; color: var(--navy); }
  .fee-block.accrued h3 { color: #92400e; }
  .fee-block .next { margin-top: 8px; font-size: 9pt; color: var(--muted); }

  table.bench { margin-top: 6px; }
  table.bench th, table.bench td { padding: 6px 8px; border-bottom: 1px solid var(--line); font-size: 9.5pt; }
  table.bench th { background: var(--navy); color: #fff; text-align: left; font-weight: 600; font-size: 8.5pt; text-transform: uppercase; }
  table.bench td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .outperf { display: inline-block; padding: 4px 10px; border-radius: 4px; background: #dcfce7; color: #166534; font-weight: 700; margin-top: 6px; }
  .outperf.neg { background: #fee2e2; color: #991b1b; }

  .spark { margin-top: 10px; background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: 10px; }
  .spark .legend { display: flex; gap: 14px; font-size: 8.5pt; color: var(--muted); margin-top: 4px; }
  .spark .legend .dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: middle; margin-right: 4px; }

  footer.foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 8pt; color: var(--muted); display: flex; justify-content: space-between; }

  .disclaim { margin-top: 12px; font-size: 8pt; color: var(--muted); line-height: 1.5; border-left: 3px solid var(--line); padding-left: 10px; }
</style>
</head>
<body>
<div class="page">

  <header class="brand">
    <div class="logo">
      <img src="${e(BRAND.logoTransparentSvg)}" alt="BitWealth" />
    </div>
    <div class="meta">
      <div class="title">Monthly Statement</div>
      <div class="row"><span>Period:</span> ${e(d.period_label)}</div>
      <div class="row"><span>Account:</span> ${e(d.customer_name)} (#${e(d.customer_id)})</div>
      <div class="row"><span>Generated:</span> ${e(d.generated_at)}</div>
    </div>
  </header>

  <section class="kpis">
    <div class="kpi">
      <div class="label">Closing NAV</div>
      <div class="value">${e(d.closing_nav_usd)}</div>
      <div class="sub">${e(d.closing_nav_zar)}</div>
    </div>
    <div class="kpi">
      <div class="label">Net change this month</div>
      <div class="value ${d.net_change_positive ? "pos" : "neg"}">${e(d.net_change_usd)}</div>
      <div class="sub ${d.net_change_positive ? "pos" : "neg"}">${e(d.net_change_pct)}</div>
    </div>
    <div class="kpi">
      <div class="label">Bitcoin held</div>
      <div class="value">${e(d.btc_balance)}</div>
      <div class="sub">${e(d.btc_balance_sub)}</div>
    </div>
    <div class="kpi">
      <div class="label">USDT cash</div>
      <div class="value">${e(d.usdt_balance_usd)}</div>
      <div class="sub">${e(d.usdt_balance_sub)}</div>
    </div>
  </section>

  <h2 class="section">Performance summary</h2>
  <div class="cols">
    <div>
      <table class="kv">
        <tr><td class="k">Opening NAV (${e(d.opening_date)})</td><td class="v">${e(d.opening_nav_usd)}</td></tr>
        <tr><td class="k">Contributions this month</td><td class="v">${e(d.contributions_usd)}</td></tr>
        <tr><td class="k">Withdrawals this month</td><td class="v">${e(d.withdrawals_usd)}</td></tr>
        <tr><td class="k">Trading P&amp;L</td><td class="v ${d.trading_pnl_positive ? "pos" : "neg"}">${e(d.trading_pnl_usd)}</td></tr>
        <tr><td class="k">Fees deducted</td><td class="v neg">${e(d.fees_deducted_usd)}</td></tr>
        <tr class="total"><td>Closing NAV (${e(d.closing_date)})</td><td class="v">${e(d.closing_nav_usd)}</td></tr>
      </table>
    </div>
    <div>
      <table class="kv">
        <tr><td class="k">Time-weighted return (TWR)</td><td class="v ${d.twr_positive ? "pos" : "neg"}">${e(d.twr_pct)}</td></tr>
        <tr><td class="k">Inception-to-date ROI</td><td class="v ${d.itd_roi_positive ? "pos" : "neg"}">${e(d.itd_roi_pct)}</td></tr>
        <tr><td class="k">Annualised return (CAGR)</td><td class="v ${d.cagr_positive ? "pos" : "neg"}">${e(d.cagr_pct)}</td></tr>
        <tr><td class="k">Cost basis</td><td class="v">${e(d.cost_basis_usd)}</td></tr>
      </table>
    </div>
  </div>

  ${
    d.show_chart
      ? `<div class="spark">
    <strong style="color: var(--navy); font-size: 10pt;">NAV vs Standard DCA — last 30 days</strong>
    <svg viewBox="0 0 600 120" width="100%" height="110" preserveAspectRatio="none" style="margin-top:6px;">
      <line x1="0" y1="20"  x2="600" y2="20"  stroke="#e5e7eb" stroke-width="1"/>
      <line x1="0" y1="60"  x2="600" y2="60"  stroke="#e5e7eb" stroke-width="1"/>
      <line x1="0" y1="100" x2="600" y2="100" stroke="#e5e7eb" stroke-width="1"/>
      ${sparkStd}
      ${sparkLth}
    </svg>
    <div class="legend">
      <span><span class="dot" style="background:${navy};"></span>${e(d.chart_lth_label)}</span>
      <span><span class="dot" style="background:#94a3b8;"></span>${e(d.chart_std_label)}</span>
    </div>
  </div>`
      : ""
  }

  <h2 class="section">Fees</h2>
  <div class="fee-block">
    <h3>Deducted this month</h3>
    <table class="kv">
      ${renderFeeRows(d.deducted_fees)}
      <tr class="total"><td>Total deducted</td><td class="v">${e(d.deducted_total_usd)}</td></tr>
    </table>
  </div>

  ${
    d.show_accrued_block
      ? `<div class="fee-block accrued">
    <h3>Accrued — to be billed later</h3>
    <table class="kv">
      ${renderFeeRows(d.accrued_fees)}
      <tr class="total"><td>Year-to-date accrual</td><td class="v">${e(d.accrued_ytd_usd)}</td></tr>
    </table>
    <div class="next">
      Accrued fees will be collected on your <strong>annual fee anniversary, ${e(d.next_billing_date)}</strong>. The figures above are interim estimates and may be adjusted at year-end based on final NAV and high-water-mark.
    </div>
  </div>`
      : ""
  }

  <h2 class="section">Benchmark comparison</h2>
  <table class="bench">
    <thead><tr><th>Metric</th><th class="num">LTH PVR DCA</th><th class="num">Standard DCA</th><th class="num">Difference</th></tr></thead>
    <tbody>
      <tr><td>Closing NAV</td><td class="num">${e(d.closing_nav_usd)}</td><td class="num">${e(d.std_dca_closing_nav_usd)}</td><td class="num ${d.outperformance_positive ? "pos" : "neg"}">${e(d.outperformance_label)}</td></tr>
      <tr><td>ROI (inception-to-date)</td><td class="num">${e(d.itd_roi_pct)}</td><td class="num">${e(d.std_dca_roi_pct)}</td><td class="num"></td></tr>
      <tr><td>CAGR</td><td class="num">${e(d.cagr_pct)}</td><td class="num">${e(d.std_dca_cagr_pct)}</td><td class="num"></td></tr>
    </tbody>
  </table>
  <div class="outperf ${d.outperformance_positive ? "" : "neg"}">Outperformance vs Standard DCA: ${e(d.outperformance_label)}</div>

  <h2 class="section">Transaction history</h2>
  <table class="tx">
    <thead>
      <tr>
        <th>Date</th><th>Type</th>
        <th class="num">BTC</th><th class="num">USDT</th><th class="num">ZAR</th>
        <th class="num">Fee (USD)</th><th class="num">BTC bal.</th><th class="num">USDT bal.</th>
      </tr>
    </thead>
    <tbody>
      ${renderTxRows(d.transactions)}
    </tbody>
    ${
      d.tx_count > 0
        ? `<tfoot>
      <tr>
        <td colspan="2">Totals (${d.tx_count} transaction${d.tx_count === 1 ? "" : "s"})</td>
        <td class="num">${e(d.tx_total_btc)}</td>
        <td class="num">${e(d.tx_total_usdt)}</td>
        <td class="num">${e(d.tx_total_zar)}</td>
        <td class="num">${e(d.tx_total_fees_usd)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>`
        : ""
    }
  </table>

  <h2 class="section">Strategy details</h2>
  <div class="cols">
    <table class="kv">
      <tr><td class="k">Strategy</td><td class="v">${e(d.strategy_name)}</td></tr>
      <tr><td class="k">Status</td><td class="v">${e(d.strategy_status)}</td></tr>
      <tr><td class="k">Exchange</td><td class="v">${e(d.exchange_label)}</td></tr>
      <tr><td class="k">Inception</td><td class="v">${e(d.inception_label)}</td></tr>
    </table>
    <table class="kv">
      <tr><td class="k">Platform fee</td><td class="v">${e(d.platform_fee_label)}</td></tr>
      <tr><td class="k">Performance fee</td><td class="v">${e(d.performance_fee_label)}</td></tr>
      <tr><td class="k">Next fee anniversary</td><td class="v">${e(d.next_anniversary_label)}</td></tr>
      <tr><td class="k">High-water mark</td><td class="v">${e(d.hwm_usd)}</td></tr>
    </table>
  </div>

  <div class="disclaim">
    This statement is provided for information only and does not constitute financial advice. NAV figures reflect end-of-day BTC mid-market prices on VALR. Cryptocurrency investments are volatile; past performance does not guarantee future returns. ${e(BRAND.legalName)} is registered in South Africa. For queries please contact <a href="mailto:${e(BRAND.supportEmail)}" style="color:${navy};">${e(BRAND.supportEmail)}</a>.
  </div>

  <footer class="foot">
    <span>${e(d.statement_filename)}</span>
    <span>${e(BRAND.legalName)} · ${e(BRAND.websiteUrl.replace(/^https?:\/\//, ""))}</span>
  </footer>

</div>
</body>
</html>`;
}
