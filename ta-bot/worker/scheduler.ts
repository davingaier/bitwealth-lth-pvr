import { logger, errMsg } from "./log.ts";

const log = logger("scheduler");

export interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<void>;
  runOnStart?: boolean;
}

interface JobState {
  job: Job;
  timer?: ReturnType<typeof setInterval>;
  running: boolean;
  lastRunAt?: number;
  lastError?: string;
  runs: number;
}

/** Fixed-interval scheduler; a job never overlaps itself. */
export class Scheduler {
  private jobs = new Map<string, JobState>();

  add(job: Job): void {
    this.jobs.set(job.name, { job, running: false, runs: 0 });
  }

  start(): void {
    for (const st of this.jobs.values()) {
      if (st.job.runOnStart) void this.tick(st);
      st.timer = setInterval(() => void this.tick(st), st.job.everyMs);
    }
  }

  stop(): void {
    for (const st of this.jobs.values()) {
      if (st.timer !== undefined) clearInterval(st.timer);
    }
  }

  async runNow(name: string): Promise<void> {
    const st = this.jobs.get(name);
    if (!st) throw new Error(`Unknown job ${name}`);
    await this.tick(st);
  }

  snapshot(): Record<string, { runs: number; lastRunAt?: string; lastError?: string; running: boolean }> {
    const out: Record<string, { runs: number; lastRunAt?: string; lastError?: string; running: boolean }> = {};
    for (const [name, st] of this.jobs) {
      out[name] = {
        runs: st.runs,
        running: st.running,
        lastRunAt: st.lastRunAt ? new Date(st.lastRunAt).toISOString() : undefined,
        lastError: st.lastError,
      };
    }
    return out;
  }

  private async tick(st: JobState): Promise<void> {
    if (st.running) return;
    st.running = true;
    const t0 = Date.now();
    try {
      await st.job.run();
      st.lastError = undefined;
    } catch (e) {
      st.lastError = errMsg(e);
      log.error("job failed", { job: st.job.name, err: st.lastError });
    } finally {
      st.running = false;
      st.runs++;
      st.lastRunAt = t0;
    }
  }
}
