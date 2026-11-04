// _shared/strategyEmail.ts
// ===========================================================================
// Strategy-aware email helpers.
//
//   templateKeyFor('registration_complete_welcome', 'STH_CB') → 'registration_complete_welcome_sth_cb'
//   customerStrategy(sb, customerId)                          → { code, configKey, joinPolicy, usdpcEnabled }
//   sthCbStateCopy(sb, orgId, configKey, joinPolicy, ctx)     → { headline, detail } for the blue "what happens next" box
//   sthCbReason(rule)                                         → client-friendly explanation of an engine rule (no thresholds)
//
// Copy deliberately describes concepts only (never σ levels, ratios or thresholds) — the rules are BitWealth IP.
// ===========================================================================

// deno-lint-ignore no-explicit-any
type Sb = any;

export const STRATEGY_NAMES: Record<string, string> = {
  LTH_PVR: "LTH PVR Bitcoin DCA Strategy",
  STH_CB: "STH Cost Basis Strategy",
  ADV_DCA: "Advanced BTC DCA Strategy",
};

/** Templates that have an STH CB variant (suffix _sth_cb). Anything else falls back to the base key. */
const STH_CB_VARIANTS = new Set([
  "registration_complete_welcome",
  "subsequent_deposit_notification",
  "kyc_verified_notification",
  "monthly_statement",
]);

export function templateKeyFor(base: string, strategyCode?: string | null): string {
  return strategyCode === "STH_CB" && STH_CB_VARIANTS.has(base) ? `${base}_sth_cb` : base;
}

export interface CustomerStrategyInfo {
  code: string;
  configKey: string;
  joinPolicy: "immediate" | "next_signal";
  usdpcEnabled: boolean;
  orgId: string | null;
}

/** The customer's open strategy row (active preferred). Null when none. */
export async function customerStrategy(sb: Sb, customerId: number): Promise<CustomerStrategyInfo | null> {
  const { data } = await sb.schema("public").from("customer_strategies")
    .select("strategy_code, config_key, join_policy, usdpc_enabled, status, org_id, created_at")
    .eq("customer_id", customerId).in("status", ["active", "pending", "suspended"])
    .order("created_at", { ascending: false }).limit(5);
  const rows = (data ?? []) as Record<string, unknown>[];
  const row = rows.find((r) => r.status === "active") ?? rows[0];
  if (!row) return null;
  return {
    code: String(row.strategy_code),
    configKey: String(row.config_key ?? "hybrid_v2_2"),
    joinPolicy: row.join_policy === "next_signal" ? "next_signal" : "immediate",
    usdpcEnabled: !!row.usdpc_enabled,
    orgId: row.org_id ? String(row.org_id) : null,
  };
}

export interface SthCbSignalState {
  date: string | null;
  inMarket: boolean;
  targetAlloc: number;      // 0..1
  rule: string;
}

export async function sthCbSignalState(sb: Sb, orgId: string, configKey = "hybrid_v2_2"): Promise<SthCbSignalState> {
  const { data } = await sb.schema("sth_cb").from("tracker_daily")
    .select("date, signal_in_market, signal_target_alloc, signal_rule")
    .eq("org_id", orgId).eq("tracker_key", configKey).order("date", { ascending: false }).limit(1);
  const r = data?.[0];
  if (!r) return { date: null, inMarket: false, targetAlloc: 0, rule: "Hold" };
  const t = r.signal_target_alloc == null ? (r.signal_in_market ? 1 : 0) : Number(r.signal_target_alloc);
  return { date: String(r.date), inMarket: !!r.signal_in_market, targetAlloc: t, rule: String(r.signal_rule ?? "Hold") };
}

export type StateCopyContext = "welcome" | "deposit" | "switch";

/**
 * Blue-box copy explaining what the strategy will do with the client's cash, given its current state.
 * `hasBtc` lets the switch email say what happens to existing Bitcoin when the strategy is in cash.
 */
export function sthCbStateCopy(sig: SthCbSignalState, joinPolicy: "immediate" | "next_signal", ctx: StateCopyContext, hasBtc = false): { headline: string; detail: string } {
  const pct = Math.round(sig.targetAlloc * 100);
  const when = "on the next daily run (around 02:00 UTC)";
  if (!sig.date) {
    return { headline: "Your portfolio joins the strategy on its next run", detail: `The strategy's current position will be applied ${when}.` };
  }
  if (!sig.inMarket) {
    return {
      headline: "The strategy is currently in cash",
      detail: (hasBtc ? `Your existing Bitcoin will be sold to cash ${when} so your portfolio matches the strategy. ` : "") +
        "Your money is held in USDT / USDPC (earning yield where enabled) and will be invested in full at the strategy's next entry signal. We will email you the moment that happens.",
    };
  }
  if (joinPolicy === "next_signal") {
    return {
      headline: "Waiting for the next entry signal",
      detail: `The strategy is currently in Bitcoin (${pct}%), but you chose to wait for a fresh entry rather than buy into an existing position. Your cash stays in USDT / USDPC until the strategy next adds to Bitcoin, then it is invested in full.`,
    };
  }
  if (pct >= 100) {
    return {
      headline: ctx === "deposit" ? "Your deposit will be invested in Bitcoin" : "The strategy is currently fully invested in Bitcoin",
      detail: `All of your available cash will be bought into Bitcoin ${when}, so your portfolio matches the strategy from day one.`,
    };
  }
  return {
    headline: `The strategy is currently scaling out (${pct}% Bitcoin)`,
    detail: `Your portfolio will be brought to ${pct}% Bitcoin / ${100 - pct}% cash ${when}; the cash portion waits in USDT / USDPC for the strategy's next re-entry.`,
  };
}

export const STH_CB_SUMMARY =
  "Each day, once the previous day's on-chain data is in (around 02:00 UTC), the strategy compares Bitcoin's price with what recent buyers paid for their coins and decides whether to be in Bitcoin or in cash. " +
  "When it is in Bitcoin, all of your available cash is invested; near market extremes it may scale out in steps and buy back on dips. When it is in cash, your money waits in USDT / USDPC until the next entry. " +
  "Trades are placed automatically on VALR in your own account.";

export const LTH_PVR_SUMMARY =
  "Each morning the strategy compares Bitcoin's price with long-term holders' cost basis and places a measured daily buy or sell, accumulating more aggressively when Bitcoin is cheap relative to that cost basis and taking profit when it is expensive. " +
  "Trades are placed automatically on VALR in your own account.";

/** Client-friendly reason for a rule label from the engine / live translator. Never exposes thresholds. */
export function sthCbReason(rule: string): string {
  const r = rule || "";
  if (/^Join/i.test(r)) return "You joined the strategy while it was already invested, so your cash was brought in line with its current position.";
  if (/Deploy contribution|Rebalance to target/i.test(r)) return "New cash in your account was invested so your portfolio matches the strategy's current position.";
  if (/R1|R14|Capitulation buy/i.test(r)) return "Bitcoin fell into a deep-value zone relative to what recent buyers paid — historically one of the best times to accumulate — and the strategy went all in.";
  if (/R2|Capitulation exit/i.test(r)) return "After a deep-value entry, price recovered to the level recent buyers paid and momentum faded, so the strategy banked the recovery and moved to cash.";
  if (/R3 Trend entry|R5|R8|Trend re-entry/i.test(r)) return "Bitcoin reclaimed strength above what recent buyers paid, with momentum confirming, so the strategy moved into Bitcoin to ride the trend.";
  if (/R3 Trend exit/i.test(r)) return "Bitcoin lost the level recent buyers paid for their coins and momentum turned negative, so the strategy stepped aside to protect capital.";
  if (/R12|Trailing stop/i.test(r)) return "Price pulled back sharply from its recent peak and the strategy's trailing protection moved the portfolio to cash.";
  if (/R4|Distribution/i.test(r)) return "On-chain valuation reached an extreme typically seen near cycle tops, so the strategy distributed into strength.";
  if (/R15|scale-out/i.test(r)) return "Bitcoin reached an on-chain valuation level typically associated with market euphoria, so the strategy sold a slice to lock in gains while staying partly invested.";
  if (/R16|Dip re-buy/i.test(r)) return "After scaling out, price pulled back enough for the strategy to buy that slice back at a better level.";
  if (/R6|Sell tier/i.test(r)) return "Price extended far above what recent buyers paid, so the strategy took profit in steps.";
  return "The strategy's daily on-chain signal changed, and your portfolio was adjusted to match.";
}

/** Headline / detail / implication for a position-change email. amountPct is the fraction of cash (BUY) or BTC (SELL). */
export function sthCbActionCopy(action: "BUY" | "SELL", amountPct: number, currentAlloc: number, targetAlloc: number): { headline: string; detail: string; implication: string } {
  const tgt = Math.round(targetAlloc * 100);
  if (action === "BUY") {
    if (targetAlloc >= 0.999) {
      return {
        headline: currentAlloc <= 0.05 ? "Moved into Bitcoin" : "Added to Bitcoin",
        detail: currentAlloc <= 0.05 ? "100% of your available cash was invested in Bitcoin" : "Your remaining cash was invested so you are now fully in Bitcoin",
        implication: "Your portfolio now rises and falls with the Bitcoin price. The strategy watches the market every day and will move to cash, or scale out in steps, when its signals say so — you will be notified each time.",
      };
    }
    return {
      headline: `Increased to ${tgt}% Bitcoin`,
      detail: `${Math.round(amountPct * 100)}% of your cash was invested to bring your portfolio to ${tgt}% Bitcoin`,
      implication: `Your portfolio is now ${tgt}% Bitcoin / ${100 - tgt}% cash. The cash portion remains available for the strategy's next re-entry.`,
    };
  }
  if (targetAlloc <= 0.001) {
    return {
      headline: "Moved to cash",
      detail: "All of your Bitcoin was sold into USDT",
      implication: "Your portfolio is now protected in cash (swept into yield-bearing USDPC where enabled) and is no longer exposed to Bitcoin's price. It will be re-invested in full at the strategy's next entry signal.",
    };
  }
  return {
    headline: `Scaled out to ${tgt}% Bitcoin`,
    detail: `${Math.round(amountPct * 100)}% of your Bitcoin was sold to bring your portfolio to ${tgt}% Bitcoin / ${100 - tgt}% cash`,
    implication: `Part of your gains are now locked in as cash while ${tgt}% stays invested. The strategy may sell further slices if the market keeps rising, or buy this slice back on a pull-back.`,
  };
}
