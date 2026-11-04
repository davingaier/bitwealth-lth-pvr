// _shared/sth_cb_live.ts
// ===========================================================================
// STH Cost Basis Strategy — LIVE per-customer translation (pure, DB-free).
//
// The strategy's state machine runs ONCE per day at org level (ef_sth_cb_tracker → sth_cb.tracker_daily). Each live
// customer then adopts that state: this module turns "the strategy wants target allocation T tomorrow" into ONE
// decision row for a customer, given the customer's own balances. The output feeds lth_pvr.decisions_daily, whose
// consumers size orders as
//     BUY : notional = available cash (USDT + USDPC value) × amount_pct
//     SELL: quantity = BTC balance × amount_pct
// so amount_pct is a fraction of the customer's CASH for buys and of their BTC for sells.
//
// Rules (2026-11-04, Policy A):
//   • target > current allocation  → BUY up to the target (all-in when target = 1). This also covers the join rule
//     (a client funded while the strategy is in the market buys immediately) and monthly deposits.
//   • target < current allocation  → SELL down to the target. A PARTIAL slice (target > 0) is skipped for THIS customer
//     when price is below their own last buy price (no-loss ladder, per customer). Full exits are never gated.
//   • join_policy 'next_signal'     → a customer who has never held BTC waits in cash until the strategy's target
//     allocation INCREASES (a genuine entry / re-buy), then follows the strategy normally.
//   • dust: orders below min_order_usdt are HOLDs with an explanatory note.
// ===========================================================================

export interface LiveSignal {
  /** Decision taken at the latest close (sth_cb.tracker_daily row for signal_date). */
  inMarket: boolean;
  targetAlloc: number;          // 0..1
  /** Target allocation decided the previous day (to detect allocation increases = entries / re-buys). */
  prevTargetAlloc: number;
  rule: string;
  note: string;
  priceUsd: number;             // close price on signal_date (used for allocation maths + dust checks)
}

export interface LiveCustomer {
  customerId: number;
  btcBalance: number;
  usdtBalance: number;
  usdpcValueUsd: number;        // USDPC units × price (0 when USDPC is off)
  /** Price of the customer's most recent BTC buy fill, or null if they have never bought. */
  lastBuyPx: number | null;
  joinPolicy: "immediate" | "next_signal";
  minOrderUsdt: number;
}

export interface LiveDecision {
  customerId: number;
  action: "BUY" | "SELL" | "HOLD";
  /** Fraction of cash (BUY) or of BTC (SELL); 0 for HOLD. */
  amountPct: number;
  rule: string;
  note: string;
  /** Customer's BTC share of NAV before the action (diagnostic). */
  currentAlloc: number;
  targetAlloc: number;
}

const EPS = 0.01; // allocation differences below 1 pp are noise (price drift), not a re-balance

export function planCustomerDecision(sig: LiveSignal, c: LiveCustomer): LiveDecision {
  const px = sig.priceUsd;
  const btcUsd = c.btcBalance * px;
  const cashUsd = Math.max(0, c.usdtBalance) + Math.max(0, c.usdpcValueUsd);
  const nav = btcUsd + cashUsd;
  const current = nav > 0 ? btcUsd / nav : 0;
  const target = sig.inMarket ? Math.min(1, Math.max(0, sig.targetAlloc)) : 0;
  const base = { customerId: c.customerId, currentAlloc: +current.toFixed(4), targetAlloc: target };
  const hold = (rule: string, note: string): LiveDecision => ({ ...base, action: "HOLD", amountPct: 0, rule, note });

  if (!(px > 0)) return hold("Hold", "No price available for the signal date");
  if (nav < c.minOrderUsdt) return hold("Hold", `Portfolio below minimum order (${nav.toFixed(2)} < ${c.minOrderUsdt} USDT)`);

  // Join policy: wait for the next allocation increase before the first BTC purchase.
  const neverBought = c.lastBuyPx == null && c.btcBalance <= 0;
  const allocationIncreased = target > sig.prevTargetAlloc + EPS;
  if (c.joinPolicy === "next_signal" && neverBought && target > 0 && !allocationIncreased) {
    return hold("Join: waiting for next entry signal", `join_policy=next_signal — strategy is in the market (${Math.round(target * 100)}% BTC) but no new entry today; cash held in USDT/USDPC`);
  }

  // ── Increase exposure ─────────────────────────────────────────────────────
  // Full target: any idle cash (deposits, dust left from a previous fill) is deployed. Partial target: only when the
  // customer's allocation is materially below target (avoids daily re-balancing on price drift).
  const fullTarget = target >= 1 - EPS;
  if ((fullTarget && cashUsd > 0) || target > current + EPS) {
    if (cashUsd < c.minOrderUsdt) return hold("Hold", `In market but idle cash ${cashUsd.toFixed(2)} < minimum order ${c.minOrderUsdt} USDT`);
    const wantBtcUsd = target * nav;
    const buyUsd = fullTarget ? cashUsd : Math.min(cashUsd, Math.max(0, wantBtcUsd - btcUsd));
    if (buyUsd < c.minOrderUsdt) return hold("Hold", `Top-up ${buyUsd.toFixed(2)} USDT below minimum order`);
    const pct = fullTarget ? 1 : Math.min(1, buyUsd / cashUsd);
    const isJoin = c.btcBalance <= 0 && current <= EPS && !allocationIncreased;
    const rule = isJoin ? "Join: adopt current state" : (allocationIncreased ? sig.rule : "Deploy contribution");
    const note = isJoin
      ? `Strategy is in the market (${Math.round(target * 100)}% BTC) — deploying all cash on joining (join_policy=${c.joinPolicy})`
      : (allocationIncreased ? sig.note : `In market (${Math.round(target * 100)}% BTC) — idle cash deployed`);
    return { ...base, action: "BUY", amountPct: +pct.toFixed(6), rule, note };
  }

  // ── Reduce exposure ───────────────────────────────────────────────────────
  if (target < current - EPS) {
    if (c.btcBalance <= 0) return hold("Hold", "Nothing to sell");
    const isPartial = target > 0;
    if (isPartial && c.lastBuyPx != null && px < c.lastBuyPx) {
      return hold("R15 deferred (below last buy)", `No-loss ladder: price ${px.toFixed(0)} is below this customer's last buy ${c.lastBuyPx.toFixed(0)} — slice skipped`);
    }
    const pct = isPartial ? Math.min(1, Math.max(0, 1 - target / current)) : 1;
    const sellUsd = c.btcBalance * pct * px;
    if (sellUsd < c.minOrderUsdt) return hold("Hold", `Sell ${sellUsd.toFixed(2)} USDT below minimum order`);
    const allocationDecreased = target < sig.prevTargetAlloc - EPS;
    return { ...base, action: "SELL", amountPct: +pct.toFixed(6), rule: allocationDecreased ? sig.rule : "Rebalance to target", note: allocationDecreased ? sig.note : `Allocation ${Math.round(current * 100)}% above target ${Math.round(target * 100)}% — trimmed` };
  }

  return hold("Hold", sig.inMarket ? `In market (${Math.round(target * 100)}% BTC) — allocation on target` : "In cash — no entry signal");
}
