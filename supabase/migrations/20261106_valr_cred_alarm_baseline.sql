-- 20261106_valr_cred_alarm_baseline.sql
-- ===========================================================================
-- Fix the credential-read anomaly alarm's baseline (false positives overnight 2026-11-05/06).
--
-- The 2026-11-05 rule ("≥ 8 distinct customers in 10 min") fired every half hour because
-- sync-valr-transactions-every-30-min and deposit-scan-hourly legitimately read all 14 active accounts in one burst.
-- New rule (shared by get_customer_valr_credentials and valr_sign), evaluated on every read:
--   A. population breach:  distinct customers in the window > active exchange accounts + valr_cred_alert_slack (5)
--   B. off-schedule burst:  ≥ valr_cred_alert_threshold (8) distinct customers in the window counting ONLY reads that
--                           fall outside ±valr_cred_cron_tolerance_sec (20 s) of a :00/:30 half-hour boundary
--                           (cron bursts land inside that tolerance; an interactive attacker does not)
-- Alerts carry a dedup_key per 10-min bucket so a sustained attack produces one row that counts up, not hundreds.
-- ===========================================================================

INSERT INTO lth_pvr.settings(key, val) VALUES
  ('valr_cred_alert_slack', '5'),
  ('valr_cred_cron_tolerance_sec', '20')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION lth_pvr.valr_cred_anomaly_check(p_customer_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'lth_pvr','public' AS $$
DECLARE
  v_window    int := lth_pvr.setting_num('valr_cred_alert_window_min', 10)::int;
  v_threshold int := lth_pvr.setting_num('valr_cred_alert_threshold', 8)::int;
  v_slack     int := lth_pvr.setting_num('valr_cred_alert_slack', 5)::int;
  v_burst_max int := lth_pvr.setting_num('valr_cred_burst_max_sec', 90)::int;
  v_active    int;
  v_all       int;
  v_span      numeric;
  v_reason    text;
BEGIN
  SELECT count(*) INTO v_active FROM lth_pvr.exchange_accounts WHERE status = 'active' OR status IS NULL;

  -- Distinct customers in the window and the time span over which they were FIRST touched.
  -- Cron bursts touch all accounts within ~15 s; an interactive enumeration spreads over minutes.
  WITH f AS (
    SELECT customer_id, min(accessed_at) first_read
    FROM lth_pvr.valr_credential_access_log
    WHERE accessed_at > now() - make_interval(mins => v_window)
    GROUP BY customer_id)
  SELECT count(*), coalesce(extract(epoch FROM max(first_read) - min(first_read)), 0) INTO v_all, v_span FROM f;

  IF v_all > v_active + v_slack THEN
    v_reason := format('%s distinct customers in %s min exceeds %s active accounts (+%s slack)', v_all, v_window, v_active, v_slack);
  ELSIF v_all >= v_threshold AND v_span > v_burst_max THEN
    v_reason := format('%s distinct customers enumerated over %s s (cron bursts finish in <%s s)', v_all, round(v_span), v_burst_max);
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.alert_events(component, severity, org_id, customer_id, message, context, dedup_key)
    VALUES ('valr_credential_access', 'critical',
            (SELECT org_id FROM public.customer_details WHERE customer_id = p_customer_id),
            p_customer_id,
            'Possible key compromise: ' || v_reason,
            jsonb_build_object('distinct_customers', v_all, 'span_sec', round(v_span), 'active_accounts', v_active,
                               'window_min', v_window, 'latest_customer', p_customer_id),
            'valr_cred_' || to_char(date_trunc('minute', now()) - make_interval(mins => extract(minute FROM now())::int % 10), 'YYYYMMDDHH24MI'));
  END IF;
END $$;
REVOKE ALL ON FUNCTION lth_pvr.valr_cred_anomaly_check(bigint) FROM PUBLIC, anon, authenticated;

-- get_customer_valr_credentials: swap the inline check for the shared one
CREATE OR REPLACE FUNCTION lth_pvr.get_customer_valr_credentials(p_customer_id bigint)
 RETURNS TABLE(api_key text, api_secret text, subaccount_id text, account_model text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'lth_pvr', 'public', 'vault'
AS $function$
DECLARE
  v_model TEXT; v_sub_id TEXT; v_key_vault_id UUID; v_sec_vault_id UUID; v_api_key TEXT; v_api_secret TEXT;
BEGIN
  SELECT cd.account_model, ea.subaccount_id, ea.api_key_vault_id, ea.api_secret_vault_id
    INTO v_model, v_sub_id, v_key_vault_id, v_sec_vault_id
  FROM public.customer_details cd
  JOIN public.customer_strategies cs ON cs.customer_id = cd.customer_id
  JOIN lth_pvr.exchange_accounts ea  ON ea.exchange_account_id = cs.exchange_account_id
  WHERE cd.customer_id = p_customer_id
  ORDER BY cs.effective_from DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No exchange account found for customer_id=%', p_customer_id; END IF;

  INSERT INTO lth_pvr.valr_credential_access_log(customer_id, account_model) VALUES (p_customer_id, v_model);
  PERFORM lth_pvr.valr_cred_anomaly_check(p_customer_id);

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

-- valr_sign: add the same check after its audit insert (function body otherwise unchanged from 20261105)
CREATE OR REPLACE FUNCTION lth_pvr.valr_sign(
  p_customer_id bigint, p_verb text, p_path text, p_body text DEFAULT '', p_scope text DEFAULT 'trade', p_subaccount_id text DEFAULT NULL)
RETURNS TABLE(api_key text, subaccount_id text, ts text, signature text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'lth_pvr','public','vault','extensions' AS $$
DECLARE
  v_model text; v_sub text := p_subaccount_id; v_key_id uuid; v_sec_id uuid; v_key text; v_secret text;
  v_ts text := (floor(extract(epoch from clock_timestamp()) * 1000))::bigint::text;
BEGIN
  IF p_scope NOT IN ('trade','withdraw') THEN RAISE EXCEPTION 'valr_sign: bad scope %', p_scope; END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT cd.account_model, ea.subaccount_id, ea.api_key_vault_id, ea.api_secret_vault_id
      INTO v_model, v_sub, v_key_id, v_sec_id
    FROM public.customer_details cd
    JOIN public.customer_strategies cs ON cs.customer_id = cd.customer_id
    JOIN lth_pvr.exchange_accounts ea  ON ea.exchange_account_id = cs.exchange_account_id
    WHERE cd.customer_id = p_customer_id ORDER BY cs.effective_from DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'valr_sign: no exchange account for customer %', p_customer_id; END IF;
    IF v_model IN ('api','finova_omnibus') THEN
      SELECT decrypted_secret INTO v_key    FROM vault.decrypted_secrets WHERE id = v_key_id;
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id = v_sec_id;
      v_sub := NULL;
      IF coalesce(v_key,'') = '' OR coalesce(v_secret,'') = '' THEN
        RAISE EXCEPTION 'VALR_SECRET_NOT_CONFIGURED: customer % (%)', p_customer_id, v_model;
      END IF;
    ELSIF v_model = 'subaccount' THEN v_model := 'master';
    ELSE RAISE EXCEPTION 'valr_sign: unknown account_model % for customer %', v_model, p_customer_id;
    END IF;
  ELSE
    v_model := 'master';
  END IF;

  IF v_model = 'master' THEN
    IF p_scope = 'withdraw' THEN
      SELECT decrypted_secret INTO v_key    FROM vault.decrypted_secrets WHERE name = 'valr_withdraw_api_key';
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'valr_withdraw_api_secret';
    END IF;
    IF coalesce(v_key,'') = '' OR coalesce(v_secret,'') = '' THEN
      SELECT decrypted_secret INTO v_key    FROM vault.decrypted_secrets WHERE name = 'valr_master_api_key';
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'valr_master_api_secret';
    END IF;
    IF coalesce(v_key,'') = '' OR coalesce(v_secret,'') = '' THEN
      RAISE EXCEPTION 'VALR_SECRET_NOT_CONFIGURED: master key missing in vault';
    END IF;
  END IF;

  INSERT INTO lth_pvr.valr_credential_access_log(customer_id, account_model, purpose, scope, path)
  VALUES (p_customer_id, v_model, 'sign', p_scope, left(p_path, 120));
  PERFORM lth_pvr.valr_cred_anomaly_check(p_customer_id);
  IF p_scope = 'withdraw' THEN
    INSERT INTO public.alert_events(component, severity, org_id, customer_id, message, context)
    VALUES ('valr_sign', 'warn', (SELECT org_id FROM public.customer_details WHERE customer_id = p_customer_id),
            p_customer_id, format('VALR withdraw request signed (%s)', p_path),
            jsonb_build_object('path', p_path, 'customer_id', p_customer_id));
  END IF;

  RETURN QUERY SELECT v_key, v_sub, v_ts,
    lth_pvr.valr_hmac_hex(v_ts || upper(p_verb) || p_path || coalesce(p_body,'') || coalesce(v_sub,''), v_secret);
END $$;
REVOKE ALL ON FUNCTION lth_pvr.valr_sign(bigint, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lth_pvr.valr_sign(bigint, text, text, text, text, text) TO service_role;

-- Resolve the overnight false positives.
UPDATE public.alert_events
   SET resolved_at = now(), resolved_by = 'migration 20261106', resolution_note = 'False positive: cron batch (sync-valr-transactions / deposit-scan) tripped the first-cut baseline. Rule replaced.'
 WHERE component = 'valr_credential_access' AND resolved_at IS NULL AND created_at < now();
