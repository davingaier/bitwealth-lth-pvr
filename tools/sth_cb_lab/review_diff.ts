// tools/sth_cb_lab/review_diff.ts
// Before/after table for the published STH_CB figures: docs/*.js (RB daily-average prices, published) vs the staged
// _review_close/*.js (Binance UTC closes). Prints Markdown; writes nothing.
//   deno run -A tools/sth_cb_lab/review_diff.ts
import { REPO_ROOT } from "./lab_core.ts";

// deno-lint-ignore no-explicit-any
type R = Record<string, any>;
const load = async (p: string, g: string): Promise<R> => { const w: R = {}; new Function("window", await Deno.readTextFile(p))(w); return w[g]; };
const money = (v: unknown) => Number.isFinite(Number(v)) ? "$" + Math.round(Number(v)).toLocaleString("en-US") : "–";
const d = (a: unknown, b: unknown) => (Number.isFinite(Number(a)) && Number(a) !== 0) ? (((Number(b) / Number(a) - 1) * 100 >= 0 ? "+" : "") + ((Number(b) / Number(a) - 1) * 100).toFixed(0) + " %") : "–";

const opL = await load(`${REPO_ROOT}docs/sth_cb_one_pager_data.js`, "STHCB_OP");
const opS = await load(`${REPO_ROOT}_review_close/sth_cb_one_pager_data.js`, "STHCB_OP");
const fsL = await load(`${REPO_ROOT}docs/sth_cb_factsheet_data_v2_2.js`, "STHCB");
const fsS = await load(`${REPO_ROOT}_review_close/sth_cb_factsheet_data_v2_2.js`, "STHCB");

const hL = opL.headline, hS = opS.headline;
console.log(`\n## Headline (fact sheet / website hero): $1 000 lump ${hL.start} → ${hS.end}, full fees\n`);
console.log("| metric | published (RB average) | new (Binance UTC close) | Δ |\n|---|---:|---:|---:|");
console.log(`| Final NAV | ${money(hL.final_nav)} | ${money(hS.final_nav)} | ${d(hL.final_nav, hS.final_nav)} |`);
console.log(`| ROI | ${Number(hL.roi_pct).toLocaleString()} % | ${Number(hS.roi_pct).toLocaleString()} % | ${d(hL.roi_pct, hS.roi_pct)} |`);
console.log(`| CAGR | ${hL.cagr_pct} % | ${hS.cagr_pct} % | |`);
console.log(`| **NAV ÷ HODL** | **${hL.nav_vs_hodl}×** | **${hS.nav_vs_hodl}×** | ${d(hL.nav_vs_hodl, hS.nav_vs_hodl)} |`);
console.log(`| HODL NAV | ${money(hL.hodl_nav)} | ${money(hS.hodl_nav)} | ${d(hL.hodl_nav, hS.hodl_nav)} |`);
console.log(`| Max drawdown | ${hL.max_dd_pct} % | ${hS.max_dd_pct} % | |`);
console.log(`| Trades | ${hL.trades} | ${hS.trades} | |`);
console.log(`| Time in market | ${hL.pct_in_market} % | ${hS.pct_in_market} % | |`);
console.log(`| Walk-forward (years beating HODL) | ${hL.wf_beat}/${hL.wf_total} | ${hS.wf_beat}/${hS.wf_total} | |`);

console.log(`\n## Website / one-pager table: $2 400 upfront + $200/month, trailing windows to ${opS.basis.end}, management plan\n`);
console.log("| window | NAV published | NAV new | Δ | HODL (new) | ×HODL published | ×HODL new | Std DCA (new) | max DD published | max DD new |");
console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
for (let i = 0; i < opL.periods.length; i++) {
  const a = opL.periods[i], b = opS.periods[i];
  const xa = (a.strategy.final_nav / a.hodl.final_nav).toFixed(2), xb = (b.strategy.final_nav / b.hodl.final_nav).toFixed(2);
  console.log(`| ${a.label} | ${money(a.strategy.final_nav)} | ${money(b.strategy.final_nav)} | ${d(a.strategy.final_nav, b.strategy.final_nav)} | ${money(b.hodl.final_nav)} | ${xa}× | ${xb}× | ${money(b.std_dca.final_nav)} | ${a.strategy.max_dd_pct} % | ${b.strategy.max_dd_pct} % |`);
}

const flat = (o: R, pre = ""): [string, number][] => Object.entries(o).flatMap(([k, v]) => typeof v === "number" ? [[pre + k, v] as [string, number]] : (v && typeof v === "object" && !Array.isArray(v) && !/series|daily|rows|trades$/i.test(k)) ? flat(v, pre + k + ".") : []);
const a = new Map(flat(fsL)), b = new Map(flat(fsS));
console.log(`\n## Fact sheet v2.2 data (${fsL.window?.start} → ${fsS.window?.end}) — every scalar that changed\n`);
console.log("| field | published | new | Δ |\n|---|---:|---:|---:|");
for (const [k, v] of a) { const n = b.get(k); if (n === undefined || n === v) continue; console.log(`| ${k} | ${Math.abs(v) >= 1000 ? money(v) : v} | ${Math.abs(n) >= 1000 ? money(n) : n} | ${d(v, n)} |`); }
