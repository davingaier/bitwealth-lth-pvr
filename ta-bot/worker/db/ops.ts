import { db, jsonb } from "./client.ts";
import { WORKER_VERSION } from "../config.ts";

export type AgentName = "analyst" | "executor" | "manager" | "improver" | "market_data" | "scheduler";

export interface AgentRunHandle {
  runId: string;
  ok(extra?: Partial<AgentRunFinish>): Promise<void>;
  fail(error: unknown, extra?: Partial<AgentRunFinish>): Promise<void>;
}

export interface AgentRunFinish {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  prompt?: string;
  response?: string;
  meta?: Record<string, unknown>;
}

export async function startAgentRun(
  agent: AgentName,
  opts: { orgId?: string; customerId?: number; symbol?: string; meta?: Record<string, unknown> } = {},
): Promise<AgentRunHandle> {
  const sql = db();
  const [row] = await sql<{ run_id: string }[]>`
    INSERT INTO ta_bot.agent_runs (agent, org_id, customer_id, symbol, meta)
    VALUES (${agent}, ${opts.orgId ?? null}, ${opts.customerId ?? null}, ${opts.symbol ?? null}, ${jsonb(opts.meta ?? {})})
    RETURNING run_id`;
  const runId = row!.run_id;

  const finish = async (status: "ok" | "error", error: string | null, extra: Partial<AgentRunFinish>) => {
    await sql`
      UPDATE ta_bot.agent_runs SET
        status = ${status},
        error = ${error},
        finished_at = now(),
        model = COALESCE(${extra.model ?? null}, model),
        input_tokens = COALESCE(${extra.inputTokens ?? null}, input_tokens),
        output_tokens = COALESCE(${extra.outputTokens ?? null}, output_tokens),
        cost_usd = COALESCE(${extra.costUsd ?? null}, cost_usd),
        prompt = COALESCE(${extra.prompt ?? null}, prompt),
        response = COALESCE(${extra.response ?? null}, response),
        meta = meta || ${jsonb(extra.meta ?? {})}
      WHERE run_id = ${runId}`;
  };

  return {
    runId,
    ok: (extra = {}) => finish("ok", null, extra),
    fail: (e, extra = {}) => finish("error", e instanceof Error ? e.message : String(e), extra),
  };
}

export async function heartbeat(workerId: string, meta: Record<string, unknown>): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO ta_bot.worker_heartbeat (worker_id, version, last_seen_at, meta)
    VALUES (${workerId}, ${WORKER_VERSION}, now(), ${jsonb(meta)})
    ON CONFLICT (worker_id) DO UPDATE
      SET version = EXCLUDED.version, last_seen_at = now(), meta = EXCLUDED.meta`;
}
