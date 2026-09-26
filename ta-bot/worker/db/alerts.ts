// Mirrors supabase/functions/_shared/alerting.ts::logAlert, but over direct SQL.
// Writes to public.alert_events (dedup handled by the DB trigger).
import { db, jsonb } from "./client.ts";
import { logger } from "../log.ts";

const log = logger("alerts");

export type AlertSeverity = "info" | "warn" | "error" | "critical";

export async function logAlert(
  component: string,
  severity: AlertSeverity,
  message: string,
  context: Record<string, unknown> = {},
  orgId?: string | null,
  customerId?: number | null,
): Promise<void> {
  try {
    await db()`
      INSERT INTO public.alert_events (component, severity, message, context, org_id, customer_id)
      VALUES (${component}, ${severity}, ${message}, ${jsonb(context)}, ${orgId ?? null}, ${customerId ?? null})`;
  } catch (e) {
    log.error("alert_events insert failed", { component, message, err: (e as Error).message });
  }
}
