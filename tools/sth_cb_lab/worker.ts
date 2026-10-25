// tools/sth_cb_lab/worker.ts
// Web Worker: loads the cached series once, then evaluates batches of configs.

import { evaluate, Fold, LabArgs, loadSeries } from "./lab_core.ts";
import { SthCbConfig } from "../../supabase/functions/_shared/sth_cb_strategy_logic.ts";
import { SthCbSeriesRow } from "../../supabase/functions/_shared/sth_cb_simulator.ts";

let rows: SthCbSeriesRow[] = [];
let lab: LabArgs | null = null;
let folds: Fold[] | undefined;

(self as unknown as Worker).onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === "init") {
    const series = await loadSeries();
    lab = msg.lab as LabArgs;
    rows = series.rows.filter((r) => r.close_date <= lab!.end);
    folds = msg.folds as Fold[] | undefined;
    (self as unknown as Worker).postMessage({ type: "ready" });
    return;
  }
  if (msg.type === "eval") {
    const out = [];
    const useFolds = msg.walkForward ? folds : undefined;
    for (const cfg of msg.configs as SthCbConfig[]) {
      try {
        const r = evaluate(rows, lab!, cfg, useFolds);
        out.push(r);
      } catch (e) {
        out.push({ config: cfg, error: String((e as Error)?.message ?? e) });
      }
    }
    (self as unknown as Worker).postMessage({ type: "result", id: msg.id, results: out });
  }
};
