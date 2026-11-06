import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { labArgsFrom, loadSeries, parseArgs, simParams } from "./lab_core.ts";
const args = parseArgs(Deno.args);
const series = await loadSeries();
const cands = JSON.parse(await Deno.readTextFile(String(args.file))) as Array<{label:string; config:Record<string,unknown>}>;
const lab0 = labArgsFrom(args, series.to);
const rows = series.rows.filter((r) => r.close_date <= lab0.end);
const pick = String(args.pick ?? "").split(",").map(Number);
const sel = pick.length && pick[0] >= 0 && args.pick !== undefined ? pick.map((i) => cands[i]) : cands;
const trails = sel.map((c) => {
  const lab = { ...lab0, config: { ...lab0.config, ...c.config } as typeof lab0.config };
  const sim = simulateSthCb(rows, simParams(lab), { ledger: false, daily: true });
  return { label: c.label, nav: sim.summary.sth_cb.final_nav_usd, buys: sim.results.filter((r) => r.action === "BUY" && /Capitulation/.test(r.rule)).map((r) => ({ d: r.trade_date, px: r.price_usd, ratio: r.price_to_cb_ratio ?? 0, rule: r.rule, nav: r.nav_usd })) };
});
// group by episode: buys within 60 days of each other across configs
const all = trails.flatMap((t, i) => t.buys.map((b) => ({ ...b, i })));
all.sort((a, b) => a.d.localeCompare(b.d));
const eps: Array<typeof all> = [];
for (const b of all) { const e = eps[eps.length - 1]; if (e && (new Date(b.d).getTime() - new Date(e[0].d).getTime()) / 86400000 <= 60) e.push(b); else eps.push([b]); }
console.log("episode    " + trails.map((t) => t.label.padEnd(30)).join(""));
for (const e of eps) {
  const cells = trails.map((_, i) => { const b = e.filter((x) => x.i === i); return b.length ? b.map((x) => `${x.d.slice(2)} $${x.px.toFixed(0)} (${(x.ratio*100).toFixed(0)}%)`).join("+").padEnd(30) : "—".padEnd(30); });
  console.log(e[0].d.slice(0, 7) + "    " + cells.join(""));
}
console.log("final NAV  " + trails.map((t) => ("$" + Math.round(t.nav).toLocaleString("en-US")).padEnd(30)).join(""));
