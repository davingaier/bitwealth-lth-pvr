-- STH CB Hybrid v2.1 — v2 with slice sizes optimised by tools/sth_cb_lab/ladder_optimize.ts (2026-10-27):
-- 30 / 20 / 10 / 0 % BTC at LTH PVR +1 / +1.5 / +2 / +2.5σ (was 75 / 50 / 25 / 0 %). Everything else as v2.
-- v1 and v2 stay active for comparison in Admin UI → On-Chain Charts → Strategy Tracker.

INSERT INTO sth_cb.tracker_config (org_id, tracker_key, label, extras)
VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 'hybrid_v2_1', 'STH CB Hybrid v2.1 — optimised slice sizes 30/20/10/0 (2026-10-27)',
  '{"capBuyRatio":0.75,"capExitRatio":0.95,"trendEnterRatio":1.12,"trendExitRatio":0.97,"momoLength":2,"momoThreshold":-0.02,
    "cbSlopeDays":21,"trailingStopPct":0.35,"reentryRocThreshold":0.1,"minHoldDays":15,
    "blockEntryAboveSigma":2.5,"distReentryClearRatio":0.85,"capBuyAtLthSigma":-0.5,"trendReentryRatio":1.02,"capBuyRocThreshold":0,
    "lthSellTiers":[{"sigma":1,"alloc":0.3},{"sigma":1.5,"alloc":0.2},{"sigma":2,"alloc":0.1},{"sigma":2.5,"alloc":0}],
    "lthSellMomoGate":true,"dipRebuyPct":0.1,"dipRebuyAtCbRatio":1.1,"dipRebuyMax":3,"scaleCooldownDays":5}'::jsonb
)
ON CONFLICT (org_id, tracker_key) DO UPDATE SET extras = EXCLUDED.extras, label = EXCLUDED.label, updated_at = now();
