-- 20261105_security_hardening.sql
-- ===========================================================================
-- Post-incident hardening (2026-11-05), DB layer. Pairs with the Edge Function caller-auth changes.
--   Item 2: audit + anomaly detection on lth_pvr.get_customer_valr_credentials (it hands out decrypted VALR
--           key+secret; during the breach it was called 18× across customers with no trace or alert).
--   Item 3: withdrawal controls on lth_pvr.withdrawal_requests — global kill-switch, per-customer destination
--           allow-list, velocity cap, and an alert on EVERY withdrawal insert. Triggers fire regardless of who
--           inserts (even a stolen service-role key writing straight to the table), which is exactly the gap the
--           attacker used.
-- All objects are idempotent.
-- ===========================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- Settings defaults (lth_pvr.settings is a simple key/val table)
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO lth_pvr.settings(key, val) VALUES
  ('withdrawals_enabled',            'true'),   -- global kill-switch: set 'false' to block ALL new crypto withdrawals
  ('withdrawal_require_allowlist',   'true'),   -- crypto destination must be allow-listed, else the request is held
  ('withdrawal_velocity_max',        '3'),      -- max crypto withdrawals per customer within the window below
  ('withdrawal_velocity_window_min', '60'),
  ('valr_cred_alert_threshold',      '8'),      -- credential reads across distinct customers within the window …
  ('valr_cred_alert_window_min',     '10')      -- … that trips a critical alert (the breach did 18 in ~22 min)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION lth_pvr.setting_num(p_key text, p_default numeric)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT NULLIF(val,'')::numeric FROM lth_pvr.settings WHERE key = p_key), p_default);
$$;

CREATE OR REPLACE FUNCTION lth_pvr.setting_bool(p_key text, p_default boolean)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT lower(val) IN ('true','t','1','yes') FROM lth_pvr.settings WHERE key = p_key), p_default);
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Item 2: credential-access audit + anomaly alert
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lth_pvr.valr_credential_access_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  customer_id bigint,
  db_user     text        NOT NULL DEFAULT current_user,
  account_model text
);
CREATE INDEX IF NOT EXISTS ix_valr_cred_access_at ON lth_pvr.valr_credential_access_log (accessed_at DESC);
REVOKE ALL ON lth_pvr.valr_credential_access_log FROM PUBLIC, anon, authenticated;

-- Wrap the existing resolver: log every call, and raise a critical alert when one backend reads credentials for an
-- abnormal number of distinct customers in a short window (the breach signature). Returns the same columns as before.
CREATE OR REPLACE FUNCTION lth_pvr.get_customer_valr_credentials(p_customer_id bigint)
 RETURNS TABLE(api_key text, api_secret text, subaccount_id text, account_model text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'lth_pvr', 'public', 'vault'
AS $function$
DECLARE
  v_model        TEXT;
  v_sub_id       TEXT;
  v_key_vault_id UUID;
  v_sec_vault_id UUID;
  v_api_key      TEXT;
  v_api_secret   TEXT;
  v_distinct     INT;
  v_threshold    INT := lth_pvr.setting_num('valr_cred_alert_threshold', 8)::int;
  v_window       INT := lth_pvr.setting_num('valr_cred_alert_window_min', 10)::int;
BEGIN
  SELECT cd.account_model, ea.subaccount_id, ea.api_key_vault_id, ea.api_secret_vault_id
    INTO v_model, v_sub_id, v_key_vault_id, v_sec_vault_id
  FROM public.customer_details cd
  JOIN public.customer_strategies cs ON cs.customer_id = cd.customer_id
  JOIN lth_pvr.exchange_accounts ea  ON ea.exchange_account_id = cs.exchange_account_id
  WHERE cd.customer_id = p_customer_id
  ORDER BY cs.effective_from DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No exchange account found for customer_id=%', p_customer_id;
  END IF;

  -- Audit every access.
  INSERT INTO lth_pvr.valr_credential_access_log(customer_id, account_model) VALUES (p_customer_id, v_model);

  -- Anomaly detection: distinct customers whose credentials were read in the last window.
  SELECT count(DISTINCT customer_id) INTO v_distinct
  FROM lth_pvr.valr_credential_access_log
  WHERE accessed_at > now() - make_interval(mins => v_window);

  IF v_distinct >= v_threshold THEN
    INSERT INTO public.alert_events(component, severity, org_id, message, context)
    VALUES ('valr_credential_access', 'critical',
            (SELECT org_id FROM public.customer_details WHERE customer_id = p_customer_id),
            format('VALR credentials read for %s distinct customers in %s min — possible key compromise', v_distinct, v_window),
            jsonb_build_object('distinct_customers', v_distinct, 'window_min', v_window, 'latest_customer', p_customer_id));
  END IF;

  IF v_model IN ('api', 'finova_omnibus') THEN
    SELECT decrypted_secret INTO v_api_key    FROM vault.decrypted_secrets WHERE id = v_key_vault_id;
    SELECT decrypted_secret INTO v_api_secret FROM vault.decrypted_secrets WHERE id = v_sec_vault_id;
    IF v_api_key IS NULL OR v_api_secret IS NULL THEN
      RAISE EXCEPTION 'Vault secret missing for customer_id=% (model=%)', p_customer_id, v_model;
    END IF;
    RETURN QUERY SELECT v_api_key, v_api_secret, NULL::TEXT, v_model;
  ELSIF v_model = 'subaccount' THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, v_sub_id, 'subaccount'::TEXT;
  ELSE
    RAISE EXCEPTION 'Unknown account_model % for customer_id=% — refusing to guess credentials', v_model, p_customer_id;
  END IF;
END;
$function$;

-- Keep execution restricted to the service role (defence in depth; it was already the only grantee).
REVOKE ALL ON FUNCTION lth_pvr.get_customer_valr_credentials(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lth_pvr.get_customer_valr_credentials(bigint) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Item 3: withdrawal destination allow-list
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lth_pvr.withdrawal_allowlist (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      uuid        NOT NULL,
  customer_id bigint      NOT NULL,
  currency    text        NOT NULL CHECK (currency IN ('BTC','USDT')),
  address     text        NOT NULL,
  label       text,
  active      boolean     NOT NULL DEFAULT true,
  added_by    text        NOT NULL DEFAULT current_user,
  added_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, currency, address)
);
ALTER TABLE lth_pvr.withdrawal_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lth_pvr.withdrawal_allowlist FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS wa_service_all ON lth_pvr.withdrawal_allowlist;
CREATE POLICY wa_service_all ON lth_pvr.withdrawal_allowlist FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS wa_admin_read ON lth_pvr.withdrawal_allowlist;
CREATE POLICY wa_admin_read ON lth_pvr.withdrawal_allowlist FOR SELECT TO authenticated USING (public.is_any_org_admin());

-- Seed from history: any address that already received a COMPLETED withdrawal is implicitly trusted.
INSERT INTO lth_pvr.withdrawal_allowlist(org_id, customer_id, currency, address, label, added_by)
SELECT DISTINCT w.org_id, w.customer_id, w.currency, w.withdrawal_address, 'seeded from completed history', 'migration'
FROM lth_pvr.withdrawal_requests w
WHERE w.status = 'completed' AND w.currency IN ('BTC','USDT') AND w.withdrawal_address IS NOT NULL
ON CONFLICT (customer_id, currency, address) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- Item 3: BEFORE INSERT guard — kill-switch, allow-list hold, velocity hold
-- ─────────────────────────────────────────────────────────────────────────
-- ─────────────────────────────────────────────────────────────────────────
-- Item 3: allow the held status value on the table
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE lth_pvr.withdrawal_requests DROP CONSTRAINT IF EXISTS wr_status_check;
ALTER TABLE lth_pvr.withdrawal_requests DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check;
ALTER TABLE lth_pvr.withdrawal_requests ADD CONSTRAINT withdrawal_requests_status_check
  CHECK (status = ANY (ARRAY['needs_approval','pending','approved','rejected','converting','awaiting_partner','paying_out','completed','failed','cancelled']::text[]));

CREATE OR REPLACE FUNCTION lth_pvr.withdrawal_request_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'lth_pvr','public' AS $$
DECLARE
  v_recent int;
  v_reason text;
BEGIN
  -- Only police outbound crypto. ZAR/fiat has its own bank-linked controls.
  IF NEW.currency NOT IN ('BTC','USDT') THEN
    RETURN NEW;
  END IF;

  -- Global kill-switch — hard stop.
  IF NOT lth_pvr.setting_bool('withdrawals_enabled', true) THEN
    RAISE EXCEPTION 'Crypto withdrawals are globally disabled (lth_pvr.settings.withdrawals_enabled=false)';
  END IF;

  -- Hold (do not dispatch) unless the destination is allow-listed; the queue only processes 'pending'/'converting'.
  IF lth_pvr.setting_bool('withdrawal_require_allowlist', true)
     AND NOT EXISTS (
       SELECT 1 FROM lth_pvr.withdrawal_allowlist a
       WHERE a.customer_id = NEW.customer_id AND a.currency = NEW.currency
         AND a.address = NEW.withdrawal_address AND a.active)
  THEN
    v_reason := 'destination address not allow-listed';
    NEW.status := 'needs_approval';
  END IF;

  -- Velocity: too many crypto withdrawals in the window → also hold.
  SELECT count(*) INTO v_recent FROM lth_pvr.withdrawal_requests w
  WHERE w.customer_id = NEW.customer_id AND w.currency IN ('BTC','USDT')
    AND w.requested_at > now() - make_interval(mins => lth_pvr.setting_num('withdrawal_velocity_window_min',60)::int);
  IF v_recent >= lth_pvr.setting_num('withdrawal_velocity_max',3)::int THEN
    v_reason := COALESCE(v_reason || '; ', '') || format('velocity cap (%s recent)', v_recent);
    NEW.status := 'needs_approval';
  END IF;

  IF NEW.status = 'needs_approval' THEN
    NEW.notes := COALESCE(NEW.notes || ' | ', '') || 'held: ' || v_reason;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdrawal_request_guard ON lth_pvr.withdrawal_requests;
CREATE TRIGGER trg_withdrawal_request_guard
  BEFORE INSERT ON lth_pvr.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION lth_pvr.withdrawal_request_guard();

-- ─────────────────────────────────────────────────────────────────────────
-- Item 3: AFTER INSERT — alert on EVERY withdrawal, escalate held ones
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lth_pvr.withdrawal_request_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'lth_pvr','public' AS $$
BEGIN
  INSERT INTO public.alert_events(component, severity, org_id, customer_id, message, context)
  VALUES ('withdrawal_request',
          CASE WHEN NEW.status = 'needs_approval' THEN 'critical' ELSE 'warn' END,
          NEW.org_id, NEW.customer_id,
          format('%s withdrawal of %s %s for customer %s (%s)',
                 initcap(NEW.status), COALESCE(NEW.amount_usdt, NEW.amount_zar, 0),
                 NEW.currency, NEW.customer_id, NEW.request_id),
          jsonb_build_object('request_id', NEW.request_id, 'currency', NEW.currency,
                             'amount_usdt', NEW.amount_usdt, 'address', NEW.withdrawal_address,
                             'status', NEW.status, 'notes', NEW.notes));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdrawal_request_alert ON lth_pvr.withdrawal_requests;
CREATE TRIGGER trg_withdrawal_request_alert
  AFTER INSERT ON lth_pvr.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION lth_pvr.withdrawal_request_alert();

-- ─────────────────────────────────────────────────────────────────────────
-- Lock down the helper/trigger functions (advisor: anon/authenticated must not EXECUTE SECURITY DEFINER; pin path)
-- ─────────────────────────────────────────────────────────────────────────
ALTER FUNCTION lth_pvr.setting_num(text, numeric)  SET search_path TO 'lth_pvr','public';
ALTER FUNCTION lth_pvr.setting_bool(text, boolean) SET search_path TO 'lth_pvr','public';
REVOKE ALL ON FUNCTION lth_pvr.setting_num(text, numeric)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lth_pvr.setting_bool(text, boolean)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lth_pvr.withdrawal_request_guard()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lth_pvr.withdrawal_request_alert()   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lth_pvr.setting_num(text, numeric)  TO service_role;
GRANT EXECUTE ON FUNCTION lth_pvr.setting_bool(text, boolean) TO service_role;
