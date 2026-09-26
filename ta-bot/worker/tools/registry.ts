import type { TaTool } from "./types.ts";
import { elliottFibTool } from "./elliott_fib/index.ts";
import { db, jsonb } from "../db/client.ts";
import { logger } from "../log.ts";

const log = logger("tools");

// deno-lint-ignore no-explicit-any
export const TOOL_IMPLEMENTATIONS: Record<string, TaTool<any>> = {
  [elliottFibTool.code]: elliottFibTool,
};

export interface LoadedTool {
  // deno-lint-ignore no-explicit-any
  tool: TaTool<any>;
  params: unknown;
  weight: number;
  enabled: boolean;
  version: number;
}

interface ToolRow {
  tool_code: string;
  enabled: boolean;
  weight: number;
  params: Record<string, unknown>;
  version: number;
}

/** Enabled tools from ta_bot.tools merged with code defaults; unknown DB codes are skipped with a warning. */
export async function loadEnabledTools(): Promise<LoadedTool[]> {
  const rows = await db()<ToolRow[]>`SELECT tool_code, enabled, weight, params, version FROM ta_bot.tools WHERE enabled`;
  const out: LoadedTool[] = [];
  for (const r of rows) {
    const tool = TOOL_IMPLEMENTATIONS[r.tool_code];
    if (!tool) {
      log.warn("enabled in DB but no implementation", { tool_code: r.tool_code });
      continue;
    }
    const parsed = tool.paramsSchema.safeParse({ ...(tool.defaultParams as object), ...r.params });
    if (!parsed.success) {
      log.error("invalid params in DB; using defaults", { tool_code: r.tool_code, issues: parsed.error.issues });
    }
    out.push({ tool, params: parsed.success ? parsed.data : tool.defaultParams, weight: r.weight, enabled: true, version: r.version });
  }
  return out;
}

/** Insert missing registry rows for implemented tools (disabled by default, so enabling is an explicit act). */
export async function registerImplementedTools(): Promise<void> {
  const sql = db();
  for (const t of Object.values(TOOL_IMPLEMENTATIONS)) {
    await sql`
      INSERT INTO ta_bot.tools (tool_code, name, description, version, enabled, params, knowledge_doc)
      VALUES (${t.code}, ${t.name}, ${t.description}, ${t.version}, false, ${jsonb(t.defaultParams)}, ${`knowledge/${t.code}.md`})
      ON CONFLICT (tool_code) DO UPDATE SET
        name = EXCLUDED.name, description = EXCLUDED.description, version = EXCLUDED.version`;
  }
}
