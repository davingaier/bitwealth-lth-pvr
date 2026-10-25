// tools/sth_cb_lab/lth_worker.ts
// Web Worker for lth_optimize.ts: evaluates batches of gene dictionaries.

import { annualFolds, LabArgs, loadSeries } from "./lab_core.ts";
import { candidateFromGenes, evaluateLth, muteConsole } from "./lth_core.ts";
import { SthCbSeriesRow } from "../../supabase/functions/_shared/sth_cb_simulator.ts";

let rows: SthCbSeriesRow[] = [];
let lab: LabArgs | null = null;
let folds: ReturnType<typeof annualFolds> = [];

(self as unknown as Worker).onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === "init") {
    muteConsole();
    const series = await loadSeries();
    lab = msg.lab as LabArgs;
    rows = series.rows.filter((r) => r.close_date <= lab!.end);
    folds = annualFolds(lab.start, lab.end);
    (self as unknown as Worker).postMessage({ type: "ready" });
    return;
  }
  if (msg.type === "eval") {
    const out = [];
    for (const genes of msg.genes as Record<string, unknown>[]) {
      try {
        const ev = evaluateLth(rows, lab!, candidateFromGenes(genes), msg.walkForward ? folds : undefined);
        out.push({ genes, metrics: ev.metrics, folds: ev.folds, folds_beating_hodl: ev.folds_beating_hodl });
      } catch (e) {
        out.push({ genes, error: String((e as Error)?.message ?? e) });
      }
    }
    (self as unknown as Worker).postMessage({ type: "result", id: msg.id, results: out });
  }
};
