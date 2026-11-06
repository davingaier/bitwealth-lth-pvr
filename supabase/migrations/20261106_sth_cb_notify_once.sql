-- 2026-11-06 · STH_CB position-change emails: send once, never for retries, never for failed orders
--
-- Incident: customers 49 and 999 received the same "Moved into Bitcoin … Order status: error" email 7× in two days.
-- ef_sth_cb_generate_decisions emailed on EVERY run that planned a BUY/SELL (the 00:20 cron, plus every manual tracker /
-- backfill run that chains the live step), and the decision repeated daily because the VALR orders failed (account
-- blocked → 401) so the balance never changed and the "Join: adopt current state" BUY was re-planned each morning.
--
-- Fix (function side): (1) one notification per (customer, trade_date) — stamped here; (2) a decision that repeats an
-- earlier notified decision with the same action / rule / target while the customer's allocation is unchanged is a
-- retry of an unexecuted order → ops alert, no client email; (3) an order outcome of `error` → ops alert, no client email.

ALTER TABLE sth_cb.decisions_daily
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS notify_skipped text;   -- why no client email went out: 'retry' | 'order_error' | 'already_notified' | 'no_email'

COMMENT ON COLUMN sth_cb.decisions_daily.notified_at IS 'When the sth_cb_position_change email for this decision was sent (null = not sent)';
COMMENT ON COLUMN sth_cb.decisions_daily.notify_skipped IS 'Reason the client email was suppressed: retry | order_error | already_notified | no_email';

-- Back-fill: mark every past BUY/SELL as notified so the next run cannot re-send for an old trade_date.
UPDATE sth_cb.decisions_daily SET notified_at = COALESCE(notified_at, updated_at) WHERE action <> 'HOLD' AND notified_at IS NULL;
