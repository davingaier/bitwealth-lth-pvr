-- STH CB Hybrid v2 — add a second tracked configuration (scale-out ladder + dip re-buy).
-- v1 stays active so both can be compared in Admin UI → On-Chain Charts → Strategy Tracker.
-- Rows are rebuilt daily by ef_sth_cb_tracker (chained from ef_fetch_onchain_pvr).

INSERT INTO sth_cb.tracker_config (org_id, tracker_key, label, extras)
VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 'hybrid_v2', 'STH CB Hybrid v2 — scale-out ladder (optimised 2026-10-26)',
  '{"capBuyRatio":0.75,"capExitRatio":0.95,"trendEnterRatio":1.12,"trendExitRatio":0.97,"momoLength":2,"momoThreshold":-0.02,
    "cbSlopeDays":21,"trailingStopPct":0.35,"reentryRocThreshold":0.1,"minHoldDays":15,
    "blockEntryAboveSigma":2.5,"distReentryClearRatio":0.85,"capBuyAtLthSigma":-0.5,"trendReentryRatio":1.02,"capBuyRocThreshold":0,
    "lthSellTiers":[{"sigma":1,"alloc":0.75},{"sigma":1.5,"alloc":0.5},{"sigma":2,"alloc":0.25},{"sigma":2.5,"alloc":0}],
    "lthSellMomoGate":true,"dipRebuyPct":0.1,"dipRebuyAtCbRatio":1.1,"dipRebuyMax":3,"scaleCooldownDays":5}'::jsonb
)
ON CONFLICT (org_id, tracker_key) DO UPDATE SET extras = EXCLUDED.extras, label = EXCLUDED.label, updated_at = now();
