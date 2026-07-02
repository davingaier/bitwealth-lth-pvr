// balance_anchor.ts — Anchor-based balance reconciliation.
//
// WHY: `lth_pvr.balances_daily` was historically derived incrementally
// (prev_day + today's ledger delta) and, on some days, manually patched — so it
// could drift from a pure cumulative ledger sum. Compounding this, legacy
// ledgers do NOT reconcile from inception (e.g. customer 49's all-time ledger
// sums to a balance ~$400 away from the real VALR balance because early history
// predates the ledger). A day-after drift bug (an exchange fee re-appearing the
// following day) further inflated some accounts, producing phantom idle USDT.
//
// FIX: anchor each customer at a KNOWN-GOOD balance/date (seeded by migration
// `add_balance_anchors` from the latest corrected balances_daily row) and always
// recompute the daily balance as:
//
//     balance(date) = anchor + Σ(ledger deltas WHERE trade_date > anchor_date AND <= date)
//
// This is deterministic, idempotent and order-independent: re-runs and cron
// races can never accumulate error, and we never trust inconsistent pre-anchor
// history. Only ledger activity strictly AFTER the anchor date is applied.

import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface AnchoredBalance {
  btc: number;
  usdt: number;
  usdpc: number;
  zar: number;
  costBasis: number;
  anchorDate: string;
}

/**
 * Compute the authoritative balance for a customer on `dateStr` from their
 * anchor plus cumulative ledger deltas since the anchor date.
 *
 * Returns null when the customer has no anchor AND no balances_daily history to
 * lazily seed one, OR when `dateStr` is before the anchor date — in both cases
 * the caller should fall back to its legacy prev+delta computation.
 */
export async function computeAnchoredBalance(
  sb: SupabaseClient,
  org_id: string,
  customer_id: number,
  dateStr: string,
): Promise<AnchoredBalance | null> {
  // 1) Resolve the customer's anchor (lazily seeding one for customers onboarded
  //    after the seed migration — their earliest balances_daily row is a clean
  //    opening balance, so cumulative-since-anchor is exact).
  let anchor = await fetchAnchor(sb, org_id, customer_id);
  if (!anchor) {
    const { data: firstRow } = await sb
      .from("balances_daily")
      .select("date, btc_balance, usdt_balance, usdpc_balance, zar_balance, cost_basis_usd")
      .eq("org_id", org_id)
      .eq("customer_id", customer_id)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!firstRow) return null; // nothing to anchor to yet

    const seed = {
      org_id,
      customer_id,
      anchor_date: firstRow.date as string,
      btc_balance: Number(firstRow.btc_balance ?? 0),
      usdt_balance: Number(firstRow.usdt_balance ?? 0),
      usdpc_balance: Number(firstRow.usdpc_balance ?? 0),
      zar_balance: Number(firstRow.zar_balance ?? 0),
      cost_basis_usd: Number(firstRow.cost_basis_usd ?? 0),
    };
    await sb.from("balance_anchors").upsert(seed, { onConflict: "org_id,customer_id" });
    anchor = seed;
  }

  // Dates before the anchor keep legacy behaviour (we never rewrite history from
  // a forward-looking anchor).
  if (dateStr < anchor.anchor_date) return null;

  // 2) Cumulative ledger deltas strictly after the anchor date, through dateStr.
  const { data: sums, error } = await sb
    .from("ledger_lines")
    .select("kind, amount_btc, amount_usdt, amount_zar, amount_usdpc, fee_btc, fee_usdt, fee_usdpc")
    .eq("org_id", org_id)
    .eq("customer_id", customer_id)
    .gt("trade_date", anchor.anchor_date)
    .lte("trade_date", dateStr);
  if (error) {
    throw new Error(`computeAnchoredBalance: ledger query failed: ${error.message}`);
  }

  let dBtc = 0, dUsdt = 0, dZar = 0, dUsdpc = 0, fBtc = 0, fUsdt = 0, fUsdpc = 0, dContrib = 0;
  for (const s of (sums ?? []) as any[]) {
    dBtc += Number(s.amount_btc ?? 0);
    dUsdt += Number(s.amount_usdt ?? 0);
    dZar += Number(s.amount_zar ?? 0);
    dUsdpc += Number(s.amount_usdpc ?? 0);
    fBtc += Number(s.fee_btc ?? 0);
    fUsdt += Number(s.fee_usdt ?? 0);
    fUsdpc += Number(s.fee_usdpc ?? 0);
    const k = String(s.kind ?? "").toLowerCase();
    if (k === "topup" || k === "deposit") dContrib += Number(s.amount_usdt ?? 0);
    else if (k === "withdrawal" || k === "withdraw") dContrib -= Math.abs(Number(s.amount_usdt ?? 0));
  }

  return {
    btc: Number(anchor.btc_balance ?? 0) + dBtc - fBtc,
    usdt: Number(anchor.usdt_balance ?? 0) + dUsdt - fUsdt,
    usdpc: Number(anchor.usdpc_balance ?? 0) + dUsdpc - fUsdpc,
    zar: Number(anchor.zar_balance ?? 0) + dZar,
    costBasis: Math.max(0, Number(anchor.cost_basis_usd ?? 0) + dContrib),
    anchorDate: anchor.anchor_date,
  };
}

interface AnchorRow {
  anchor_date: string;
  btc_balance: number;
  usdt_balance: number;
  usdpc_balance: number;
  zar_balance: number;
  cost_basis_usd: number;
}

async function fetchAnchor(
  sb: SupabaseClient,
  org_id: string,
  customer_id: number,
): Promise<AnchorRow | null> {
  const { data } = await sb
    .from("balance_anchors")
    .select("anchor_date, btc_balance, usdt_balance, usdpc_balance, zar_balance, cost_basis_usd")
    .eq("org_id", org_id)
    .eq("customer_id", customer_id)
    .maybeSingle();
  return (data as AnchorRow) ?? null;
}
