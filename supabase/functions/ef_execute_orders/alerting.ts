// Shared alerting utilities for LTH PVR edge functions
// Usage: import { logAlert } from "../_shared/alerting.ts";

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

/**
 * Log an alert to lth_pvr.alert_events table
 * 
 * @param sb - Supabase client (must be configured with lth_pvr schema)
 * @param component - Component name (e.g., 'ef_generate_decisions')
 * @param severity - Alert severity level
 * @param message - Human-readable alert message
 * @param context - Additional structured context data
 * @param orgId - Optional organization ID
 * @param customerId - Optional customer ID
 * @param portfolioId - Optional portfolio ID
 */
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

/**
 * Check if an unresolved alert already exists for this component/org
 * Useful to prevent duplicate alerts for the same issue
 * 
 * @param sb - Supabase client
 * @param component - Component name
 * @param orgId - Organization ID
 * @param additionalFilters - Optional additional filters (e.g., customer_id)
 */
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
