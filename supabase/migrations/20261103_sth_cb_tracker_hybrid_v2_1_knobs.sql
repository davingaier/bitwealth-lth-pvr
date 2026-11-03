-- STH CB Hybrid v2.1 — re-buy knobs corrected (2026-11-03).
-- A same-tick slice/re-buy bug in the rules engine (fixed in _shared/sth_cb_strategy_logic.ts) had been masking an
-- oscillation between the +1σ slice and the ≤110 % CB re-buy. Re-optimised on the corrected engine:
--   dipRebuyAtCbRatio 1.10 → 1.05, dipRebuyMax 3 → 1, scaleCooldownDays 5 → 2.  Ladder 30/20/10/0 % unchanged.

UPDATE sth_cb.tracker_config
SET extras = extras || '{"dipRebuyAtCbRatio":1.05,"dipRebuyMax":1,"scaleCooldownDays":2}'::jsonb,
    label  = 'STH CB Hybrid v2.1 — optimised slice sizes 30/20/10/0 (knobs corrected 2026-11-03)',
    updated_at = now()
WHERE org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b' AND tracker_key = 'hybrid_v2_1';
