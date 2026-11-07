-- 2026-11-07 · Credential-read alarm: trimmed first-read span + ignore master (NULL-customer) signs
--
-- Two more false positives today (10:00 / 10:30 SAST): legitimate pipeline activity on 1–2 customers in the minutes
-- BEFORE a cron tick (operator recon reads at 07:54–07:57; the USDPC chunked executor + poller for customer 49 from
-- 08:22) was gap-chained into the cron's 14-customer burst, so "first reads of 15 distinct customers spanned 327 / 492 s".
-- The attacker enumerated MANY customers at human pace; a legitimate pre-tick burst touches 1–2 customers many times.
--
-- Rule B now measures the span from the 3rd-earliest first-read to the latest (trimmed span): an enumerator of ≥ 8
-- customers at ≈ 75 s/read still shows ≥ 375 s after trimming two, while "2 pipeline customers + cron" collapses to the
-- cron's own ≤ 13 s. NULL customer_id rows (master-key signs for org-level calls) no longer count as a distinct customer.

CREATE OR REPLACE FUNCTION lth_pvr.valr_cred_anomaly_check(p_customer_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'lth_pvr', 'public'
AS $function$
DECLARE
  v_window    int := lth_pvr.setting_num('valr_cred_alert_window_min', 10)::int;
  v_threshold int := lth_pvr.setting_num('valr_cred_alert_threshold', 8)::int;
  v_slack     int := lth_pvr.setting_num('valr_cred_alert_slack', 5)::int;
  v_burst_max int := lth_pvr.setting_num('valr_cred_burst_max_sec', 90)::int;
  v_gap       int := lth_pvr.setting_num('valr_cred_burst_gap_sec', 60)::int;
  v_trim      int := lth_pvr.setting_num('valr_cred_burst_trim', 2)::int;
  v_active    int;
  v_all       int;
  v_bad_burst record;
  v_reason    text;
BEGIN
  SELECT count(*) INTO v_active FROM lth_pvr.exchange_accounts WHERE status = 'active' OR status IS NULL;
  SELECT count(DISTINCT customer_id) INTO v_all
  FROM lth_pvr.valr_credential_access_log
  WHERE accessed_at > now() - make_interval(mins => v_window) AND customer_id IS NOT NULL;

  IF v_all > v_active + v_slack THEN
    v_reason := format('%s distinct customers in %s min exceeds %s active accounts (+%s slack)', v_all, v_window, v_active, v_slack);
  ELSE
    WITH r AS (
      SELECT customer_id, accessed_at,
             CASE WHEN accessed_at - lag(accessed_at) OVER (ORDER BY accessed_at) > make_interval(secs => v_gap) THEN 1 ELSE 0 END AS new_burst
      FROM lth_pvr.valr_credential_access_log
      WHERE accessed_at > now() - make_interval(mins => v_window) AND customer_id IS NOT NULL
    ), b AS (
      SELECT customer_id, accessed_at, sum(new_burst) OVER (ORDER BY accessed_at) AS burst_id FROM r
    ), f AS (
      SELECT burst_id, customer_id, min(accessed_at) AS first_read FROM b GROUP BY burst_id, customer_id
    ), ranked AS (
      SELECT burst_id, first_read, row_number() OVER (PARTITION BY burst_id ORDER BY first_read) AS rn, count(*) OVER (PARTITION BY burst_id) AS dc
      FROM f
    )
    SELECT burst_id, max(dc) AS dc,
           extract(epoch FROM max(first_read) - min(first_read) FILTER (WHERE rn > v_trim)) AS span
      INTO v_bad_burst
    FROM ranked
    GROUP BY burst_id
    HAVING max(dc) >= v_threshold
       AND extract(epoch FROM max(first_read) - min(first_read) FILTER (WHERE rn > v_trim)) > v_burst_max
    ORDER BY span DESC LIMIT 1;

    IF v_bad_burst.dc IS NOT NULL THEN
      v_reason := format('%s distinct customers enumerated over %s s within one burst (trimmed %s; cron bursts finish in <%s s)',
                         v_bad_burst.dc, round(v_bad_burst.span), v_trim, v_burst_max);
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.alert_events(component, severity, org_id, customer_id, message, context, dedup_key)
    VALUES ('valr_credential_access', 'critical',
            (SELECT org_id FROM public.customer_details WHERE customer_id = p_customer_id), p_customer_id,
            'Possible key compromise: ' || v_reason,
            jsonb_build_object('distinct_customers', v_all, 'active_accounts', v_active, 'window_min', v_window, 'latest_customer', p_customer_id),
            'valr_cred_' || to_char(date_trunc('minute', now()) - make_interval(mins => extract(minute FROM now())::int % 10), 'YYYYMMDDHH24MI'));
  END IF;
END $function$;

INSERT INTO lth_pvr.settings(key, val) VALUES ('valr_cred_burst_trim', '2') ON CONFLICT (key) DO NOTHING;
