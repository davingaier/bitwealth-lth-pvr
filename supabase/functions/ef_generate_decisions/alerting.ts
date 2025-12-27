// Shared alerting utilities for LTH PVR edge functions

// Minimal type for Supabase client - avoids import issues in shared files
interface SupabaseClient {
  from(table: string): any;
}

export type AlertSeverity = "info" | "warn" | "error" | "critical";

export interface AlertContext {
  [key: string]: unknown;
  trade_date?: string;
  signal_date?: string;
  customer_id?: number;
  intent_id?: string;
  order_id?: string;
  exchange_order_id?: string;
  ext_order_id?: string;
  error_code?: string;
  retries?: number;
}

export async function logAlert(
  sb: SupabaseClient,
  component: string,
  severity: AlertSeverity,
  message: string,
  context: AlertContext = {},
  orgId?: string | null,
  customerId?: number | null,
  portfolioId?: string | null,
): Promise<void> {
  try {
    const payload: any = {
      component,
      severity,
      message,
      context,
    };
    if (orgId) payload.org_id = orgId;
    if (customerId) payload.customer_id = customerId;
    if (portfolioId) payload.portfolio_id = portfolioId;

    await sb.from("alert_events").insert(payload);
  } catch (e) {
    console.error(`${component}: alert_events insert failed`, e);
  }
}

export async function hasUnresolvedAlert(
  sb: SupabaseClient,
  component: string,
  orgId: string,
  additionalFilters?: Record<string, any>,
): Promise<boolean> {
  try {
    let query = sb
      .from("alert_events")
      .select("alert_id")
      .eq("component", component)
      .eq("org_id", orgId)
      .is("resolved_at", null)
      .limit(1);

    if (additionalFilters) {
      Object.entries(additionalFilters).forEach(([key, value]) => {
        query = query.eq(key, value);
      });
    }

    const { data } = await query;
    return (data?.length ?? 0) > 0;
  } catch (e) {
    console.error("hasUnresolvedAlert check failed", e);
    return false;
  }
}
