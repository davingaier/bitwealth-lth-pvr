// tools/sth_cb_lab/pool.ts
// Shared Web-Worker pool used by optimize.ts and ladder_optimize.ts.

import { SthCbConfig } from "../../supabase/functions/_shared/sth_cb_strategy_logic.ts";
import { annualFolds, EvalResult, LabArgs } from "./lab_core.ts";

export interface Pool {
  workersN: number;
  /** Evaluate every config (optionally with walk-forward folds); prints a progress line labelled `label`. */
  evalAll(list: SthCbConfig[], wf: boolean, label: string): Promise<EvalResult[]>;
  terminate(): void;
}

export async function createPool(lab: LabArgs, workersN: number): Promise<Pool> {
  const workers: Worker[] = [];
  const ready: Promise<void>[] = [];
  for (let i = 0; i < workersN; i++) {
    const w = new Worker(new URL("./worker.ts", import.meta.url).href, { type: "module" });
    workers.push(w);
    ready.push(new Promise<void>((res) => {
      const h = (ev: MessageEvent) => { if (ev.data?.type === "ready") { w.removeEventListener("message", h); res(); } };
      w.addEventListener("message", h);
    }));
    w.postMessage({ type: "init", lab, folds: annualFolds(lab.start, lab.end) });
  }
  await Promise.all(ready);

  let msgId = 0;
  const pendingCb = new Map<number, (r: EvalResult[]) => void>();
  for (const w of workers) {
    w.addEventListener("message", (ev: MessageEvent) => {
      if (ev.data?.type !== "result") return;
      const cb = pendingCb.get(ev.data.id); pendingCb.delete(ev.data.id); cb?.(ev.data.results);
    });
  }
  let rr = 0;
  const evalBatch = (cfgs: SthCbConfig[], wf: boolean): Promise<EvalResult[]> => new Promise((res) => {
    const id = msgId++; pendingCb.set(id, res);
    workers[rr++ % workers.length].postMessage({ type: "eval", id, configs: cfgs, walkForward: wf });
  });

  async function evalAll(list: SthCbConfig[], wf: boolean, label: string): Promise<EvalResult[]> {
    const batch = Math.max(1, Math.min(wf ? 5 : 50, Math.ceil(list.length / (workersN * 8))));
    const chunks: SthCbConfig[][] = [];
    for (let i = 0; i < list.length; i += batch) chunks.push(list.slice(i, i + batch));
    const out: EvalResult[] = [];
    let done = 0, next = 0;
    const t0 = performance.now();
    const runOne = async () => {
      while (next < chunks.length) {
        const c = chunks[next++];
        const r = await evalBatch(c, wf);
        for (const x of r as (EvalResult & { error?: string })[]) { if (x.error) console.warn("eval error:", x.error); else out.push(x); }
        done += c.length;
        Deno.stdout.writeSync(new TextEncoder().encode(`\r  ${label}: ${done}/${list.length} · ${(done / ((performance.now() - t0) / 1000)).toFixed(0)} evals/s   `));
      }
    };
    await Promise.all(Array.from({ length: workersN * 2 }, runOne));
    console.log("");
    return out;
  }

  return { workersN, evalAll, terminate: () => { for (const w of workers) w.terminate(); } };
}
