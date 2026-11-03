-- STH CB Hybrid v2.2 — "no-loss ladder" (2026-11-03).
-- v2.1 plus sliceAboveLastBuyPct = 0 (a partial scale-out slice is only taken when price is above the last buy /
-- re-buy price, so ladder round-trips can no longer lose money). With that guard an earlier first rung becomes
-- profitable: 50 / 20 / 10 / 0 % BTC at LTH PVR +0.5 / +1 / +1.5 / +2.5σ (was 30/20/10/0 at +1/1.5/2/2.5σ).
-- The cooldown is dropped (the guard replaces it). $1k 2017→2026: 439,825 % ROI / 52.7× HODL, WF 8/10.
-- v1, v2 and v2.1 stay active for comparison in Admin UI → On-Chain Charts → Strategy Tracker.

INSERT INTO sth_cb.tracker_config (org_id, tracker_key, label, extras)
VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 'hybrid_v2_2', 'STH CB Hybrid v2.2 — no-loss ladder 50/20/10/0 at +0.5/1/1.5/2.5σ (2026-11-03)',
  '{"capBuyRatio":0.75,"capExitRatio":0.95,"trendEnterRatio":1.12,"trendExitRatio":0.97,"momoLength":2,"momoThreshold":-0.02,
    "cbSlopeDays":21,"trailingStopPct":0.35,"reentryRocThreshold":0.1,"minHoldDays":15,
    "blockEntryAboveSigma":2.5,"distReentryClearRatio":0.85,"capBuyAtLthSigma":-0.5,"trendReentryRatio":1.02,"capBuyRocThreshold":0,
    "lthSellTiers":[{"sigma":0.5,"alloc":0.5},{"sigma":1,"alloc":0.2},{"sigma":1.5,"alloc":0.1},{"sigma":2.5,"alloc":0}],
    "lthSellMomoGate":true,"dipRebuyPct":0.1,"dipRebuyAtCbRatio":1.05,"dipRebuyMax":1,"sliceAboveLastBuyPct":0}'::jsonb
)
ON CONFLICT (org_id, tracker_key) DO UPDATE SET extras = EXCLUDED.extras, label = EXCLUDED.label, updated_at = now();
