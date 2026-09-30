-- Finova omnibus — Phases 5 & 6 (fee invoicing, partner notifications, bank re-link)
-- Incorporates Finova's v0.3 spec feedback (2026-09-30):
--   * notifications go to bitwealth@finova.co.za
--   * SLA: new subaccount 1 business day, withdrawal 3 business days
--   * subaccount ID is never asked of Finova → fees that cannot be swept are
--     "deferred" (left in the client subaccount) and listed on the monthly invoice
--     for Finova to move themselves.

-- ── 1. Partner configuration ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partners (
  partner_code                 text PRIMARY KEY,
  display_name                 text NOT NULL,
  notify_email                 text NOT NULL,
  cc_email                     text,
  sla_provision_business_days  int  NOT NULL DEFAULT 1 CHECK (sla_provision_business_days BETWEEN 1 AND 30),
  sla_withdrawal_business_days int  NOT NULL DEFAULT 3 CHECK (sla_withdrawal_business_days BETWEEN 1 AND 30),
  is_active                    boolean NOT NULL DEFAULT true,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partners FROM anon, authenticated;

INSERT INTO public.partners (partner_code, display_name, notify_email, cc_email, sla_provision_business_days, sla_withdrawal_business_days)
VALUES ('finova', 'Finova', 'bitwealth@finova.co.za', 'support@bitwealth.co.za', 1, 3)
ON CONFLICT (partner_code) DO UPDATE
  SET notify_email = EXCLUDED.notify_email,
      sla_provision_business_days = EXCLUDED.sla_provision_business_days,
      sla_withdrawal_business_days = EXCLUDED.sla_withdrawal_business_days,
      updated_at = now();

-- ── 2. Notification bookkeeping ─────────────────────────────────────────────
ALTER TABLE public.subaccount_requests
  ADD COLUMN IF NOT EXISTS partner_email_sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS partner_reminder_sent_at timestamptz;

ALTER TABLE lth_pvr.withdrawal_requests
  ADD COLUMN IF NOT EXISTS partner_email_sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS partner_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_completed_email_sent_at timestamptz;

-- ── 3. Monthly consolidated fee invoice ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_invoices (
  invoice_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number    text NOT NULL UNIQUE,
  partner_code      text NOT NULL REFERENCES public.partners(partner_code),
  org_id            uuid NOT NULL,
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  lines             jsonb NOT NULL DEFAULT '[]'::jsonb,
  totals            jsonb NOT NULL DEFAULT '{}'::jsonb,
  held_line_count   int  NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'fees_confirmed')),
  sent_to           text,
  sent_at           timestamptz,
  email_error       text,
  fees_confirmed_at timestamptz,
  fees_confirmed_by uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_code, period_start)
);
ALTER TABLE public.partner_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_invoices FROM anon, authenticated;

ALTER TABLE lth_pvr.valr_transfer_log
  ADD COLUMN IF NOT EXISTS partner_invoice_id uuid REFERENCES public.partner_invoices(invoice_id),
  ADD COLUMN IF NOT EXISTS collected_at       timestamptz;

-- 'deferred' = fee charged to the client but left in their Finova subaccount for
-- Finova to move to its main account (subaccount ID unknown, so we cannot sweep).
ALTER TABLE lth_pvr.valr_transfer_log DROP CONSTRAINT IF EXISTS valr_transfer_log_status_check;
ALTER TABLE lth_pvr.valr_transfer_log ADD CONSTRAINT valr_transfer_log_status_check
  CHECK (status = ANY (ARRAY['pending', 'completed', 'failed', 'deferred']));

CREATE INDEX IF NOT EXISTS idx_valr_transfer_log_partner_main
  ON lth_pvr.valr_transfer_log (created_at) WHERE to_account = 'partner_main';

-- ── 4. Helpers ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_request_ip()
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT NULLIF(TRIM(split_part(
           COALESCE(NULLIF(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''),
           ',', 1)), '');
$$;

CREATE OR REPLACE FUNCTION public.partner_request_user_agent()
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT NULLIF(current_setting('request.headers', true), '')::json ->> 'user-agent';
$$;

-- ── 5. Partner-facing RPCs ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.partner_list_withdrawals(boolean);
CREATE FUNCTION public.partner_list_withdrawals(p_include_closed boolean DEFAULT false)
RETURNS TABLE(request_id uuid, customer_id bigint, client_name text, subaccount_name text,
              amount_zar numeric, status text, requested_at timestamptz, ready_at timestamptz,
              partner_reference text, reconciliation_status text, completed_at timestamptz,
              relink_pending boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'lth_pvr'
AS $$
  SELECT wr.request_id,
         wr.customer_id,
         COALESCE(cd.display_name, NULLIF(TRIM(COALESCE(cd.first_names,'') || ' ' || COALESCE(cd.last_name,'')), ''), 'Client ' || cd.customer_id),
         ea.label,
         COALESCE(wr.net_amount, wr.amount_zar),
         wr.status,
         wr.requested_at,
         wr.partner_notified_at,
         wr.partner_reference,
         wr.reconciliation_status,
         wr.completed_at,
         EXISTS (SELECT 1 FROM public.subaccount_requests sr
                  WHERE sr.customer_id = wr.customer_id
                    AND sr.request_type = 'bank_relink'
                    AND sr.status IN ('pending','submitted'))
  FROM lth_pvr.withdrawal_requests wr
  JOIN public.customer_details cd ON cd.customer_id = wr.customer_id
  LEFT JOIN public.customer_strategies cs ON cs.customer_id = wr.customer_id
  LEFT JOIN public.exchange_accounts ea ON ea.exchange_account_id = cs.exchange_account_id
  WHERE public.partner_session_ok()
    AND cd.account_model = 'finova_omnibus'
    AND (p_include_closed OR wr.status = 'awaiting_partner')
    AND (p_include_closed IS FALSE OR wr.status IN ('awaiting_partner','paying_out','completed'))
  ORDER BY (wr.status = 'awaiting_partner') DESC, wr.requested_at;
$$;
REVOKE ALL ON FUNCTION public.partner_list_withdrawals(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_list_withdrawals(boolean) TO authenticated;

DROP FUNCTION IF EXISTS public.partner_list_audit_log(integer);
CREATE FUNCTION public.partner_list_audit_log(p_limit integer DEFAULT 100)
RETURNS TABLE(created_at timestamptz, actor_email text, action text, entity_type text,
              entity_id text, customer_id bigint, detail jsonb, ip_address text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pal.created_at, pu.email, pal.action, pal.entity_type, pal.entity_id,
         pal.customer_id, pal.detail, pal.ip_address
  FROM public.partner_action_log pal
  LEFT JOIN public.partner_users pu ON pu.user_id = pal.partner_user_id
  WHERE public.partner_session_ok()
    AND pal.partner_code = public.current_partner_code()
  ORDER BY pal.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$$;
REVOKE ALL ON FUNCTION public.partner_list_audit_log(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_list_audit_log(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.partner_confirm_bank_relink(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_code text := public.current_partner_code();
  r      public.subaccount_requests%ROWTYPE;
BEGIN
  IF NOT public.partner_session_ok() THEN
    RAISE EXCEPTION 'A two-factor authenticated partner session is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.subaccount_requests WHERE request_id = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.partner_code IS DISTINCT FROM v_code THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF r.request_type <> 'bank_relink' THEN
    RAISE EXCEPTION 'This is not a bank re-link request';
  END IF;
  IF r.status NOT IN ('pending', 'submitted') THEN
    RAISE EXCEPTION 'This request is already %', r.status;
  END IF;

  UPDATE public.subaccount_requests
     SET status = 'verified', bank_link_confirmed = true, verification_error = NULL,
         submitted_at = now(), submitted_by = auth.uid(), verified_at = now(), updated_at = now()
   WHERE request_id = p_request_id;

  UPDATE public.exchange_accounts ea
     SET bank_linked_at = now(), bank_link_method = 'partner_manual', updated_at = now()
    FROM public.customer_strategies cs
   WHERE cs.customer_id = r.customer_id
     AND ea.exchange_account_id = cs.exchange_account_id;

  INSERT INTO public.partner_action_log (partner_user_id, partner_code, action, entity_type,
                                         entity_id, customer_id, detail, ip_address, user_agent)
  VALUES (auth.uid(), v_code, 'confirm_bank_relink', 'subaccount_request', p_request_id::text,
          r.customer_id, '{}'::jsonb, public.partner_request_ip(), public.partner_request_user_agent());

  RETURN jsonb_build_object('success', true, 'customer_id', r.customer_id);
END;
$$;
REVOKE ALL ON FUNCTION public.partner_confirm_bank_relink(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_confirm_bank_relink(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.partner_list_invoices()
RETURNS TABLE(invoice_id uuid, invoice_number text, period_start date, period_end date,
              lines jsonb, totals jsonb, held_line_count int, status text,
              sent_at timestamptz, fees_confirmed_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pi.invoice_id, pi.invoice_number, pi.period_start, pi.period_end, pi.lines, pi.totals,
         pi.held_line_count, pi.status, pi.sent_at, pi.fees_confirmed_at
  FROM public.partner_invoices pi
  WHERE public.partner_session_ok()
    AND pi.partner_code = public.current_partner_code()
  ORDER BY pi.period_start DESC;
$$;
REVOKE ALL ON FUNCTION public.partner_list_invoices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_list_invoices() TO authenticated;

CREATE OR REPLACE FUNCTION public.partner_confirm_invoice_fees(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'lth_pvr'
AS $$
DECLARE
  v_code  text := public.current_partner_code();
  v_inv   public.partner_invoices%ROWTYPE;
  v_moved int;
BEGIN
  IF NOT public.partner_session_ok() THEN
    RAISE EXCEPTION 'A two-factor authenticated partner session is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM public.partner_invoices WHERE invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_inv.partner_code IS DISTINCT FROM v_code THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF v_inv.status = 'fees_confirmed' THEN
    RAISE EXCEPTION 'Fees on this invoice have already been confirmed';
  END IF;

  UPDATE lth_pvr.valr_transfer_log
     SET status = 'completed', completed_at = now(), collected_at = now()
   WHERE partner_invoice_id = p_invoice_id
     AND status = 'deferred';
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  UPDATE public.partner_invoices
     SET status = 'fees_confirmed', fees_confirmed_at = now(), fees_confirmed_by = auth.uid()
   WHERE invoice_id = p_invoice_id;

  INSERT INTO public.partner_action_log (partner_user_id, partner_code, action, entity_type,
                                         entity_id, customer_id, detail, ip_address, user_agent)
  VALUES (auth.uid(), v_code, 'confirm_invoice_fees', 'partner_invoice', p_invoice_id::text, NULL,
          jsonb_build_object('invoice_number', v_inv.invoice_number, 'held_fees_confirmed', v_moved),
          public.partner_request_ip(), public.partner_request_user_agent());

  RETURN jsonb_build_object('success', true, 'held_fees_confirmed', v_moved);
END;
$$;
REVOKE ALL ON FUNCTION public.partner_confirm_invoice_fees(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_confirm_invoice_fees(uuid) TO authenticated;

-- ── 6. Admin RPCs ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_partners()
RETURNS SETOF public.partners
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT * FROM public.partners WHERE public.is_any_org_admin() ORDER BY partner_code;
$$;
REVOKE ALL ON FUNCTION public.admin_get_partners() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_partners() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_partner(
  p_partner_code text,
  p_notify_email text,
  p_cc_email text,
  p_sla_provision int,
  p_sla_withdrawal int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_any_org_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_notify_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'A valid notification email is required';
  END IF;
  IF NULLIF(p_cc_email, '') IS NOT NULL AND p_cc_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'CC email is not valid';
  END IF;

  UPDATE public.partners
     SET notify_email = lower(trim(p_notify_email)),
         cc_email = NULLIF(lower(trim(p_cc_email)), ''),
         sla_provision_business_days = COALESCE(p_sla_provision, sla_provision_business_days),
         sla_withdrawal_business_days = COALESCE(p_sla_withdrawal, sla_withdrawal_business_days),
         updated_at = now()
   WHERE partner_code = p_partner_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner % not found', p_partner_code;
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_partner(text, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_partner(text, text, text, int, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_raise_bank_relink(p_customer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_model text;
  v_id    uuid;
BEGIN
  IF NOT public.is_any_org_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  SELECT account_model INTO v_model FROM public.customer_details WHERE customer_id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id;
  END IF;
  IF v_model IS DISTINCT FROM 'finova_omnibus' THEN
    RAISE EXCEPTION 'Customer % is not held in the Finova omnibus account', p_customer_id;
  END IF;

  v_id := public.raise_subaccount_request(p_customer_id, 'bank_relink');
  IF v_id IS NULL THEN
    SELECT request_id INTO v_id FROM public.subaccount_requests
     WHERE customer_id = p_customer_id AND request_type = 'bank_relink'
       AND status IN ('pending', 'submitted');
    RETURN jsonb_build_object('success', true, 'request_id', v_id, 'already_open', true);
  END IF;
  RETURN jsonb_build_object('success', true, 'request_id', v_id, 'already_open', false);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_raise_bank_relink(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_raise_bank_relink(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_partner_invoices()
RETURNS TABLE(invoice_id uuid, invoice_number text, partner_code text, period_start date,
              period_end date, lines jsonb, totals jsonb, held_line_count int, status text,
              sent_to text, sent_at timestamptz, email_error text, fees_confirmed_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pi.invoice_id, pi.invoice_number, pi.partner_code, pi.period_start, pi.period_end,
         pi.lines, pi.totals, pi.held_line_count, pi.status, pi.sent_to, pi.sent_at,
         pi.email_error, pi.fees_confirmed_at
  FROM public.partner_invoices pi
  WHERE public.is_any_org_admin()
  ORDER BY pi.period_start DESC, pi.partner_code;
$$;
REVOKE ALL ON FUNCTION public.admin_list_partner_invoices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_partner_invoices() TO authenticated;

REVOKE ALL ON FUNCTION public.partner_request_ip() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_request_user_agent() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_request_ip() TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_request_user_agent() TO authenticated;

-- ── 7. Schedules ────────────────────────────────────────────────────────────
-- Uses the vault service_jwt (lth_pvr.call_edge sends the anon key, which the
-- admin-guarded partner functions reject).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('partner_notifications', 'partner_fee_invoice_monthly');

SELECT cron.schedule('partner_notifications', '*/10 * * * *', $cmd$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_partner_notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_jwt')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$cmd$);

SELECT cron.schedule('partner_fee_invoice_monthly', '30 6 1 * *', $cmd$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_partner_fee_invoice',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_jwt')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$cmd$);
