-- Partner portal pre-test hardening + trade notifications (2026-11-14), found while re-reviewing
-- the Finova test cases after the November security incidents.
--
-- 1. admin_revoke_user_sessions(uuid): service-only RPC used by ef_admin_partner_users when a
--    partner login is disabled or its 2FA is reset. auth.admin.signOut() needs the user's own JWT
--    (which we never hold), so the old code never actually dropped sessions. Deleting the
--    auth.sessions rows cascades to refresh tokens, so the user cannot refresh; the RPC/EF layer
--    already rejects the (≤1 h) access token via partner_users.is_active.
-- 2. partner_list_withdrawals__core: scoped by account_model only. Add the same partner_code
--    scoping every other partner RPC has (a customer belongs to the partner that holds an
--    open/closed subaccount_requests row for them).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Session revocation for partner logins
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Only partner logins may be revoked this way; org members / customers are out of scope.
  IF NOT EXISTS (SELECT 1 FROM public.partner_users pu WHERE pu.user_id = p_user_id) THEN
    RAISE EXCEPTION 'Not a partner user' USING ERRCODE = '42501';
  END IF;

  DELETE FROM auth.sessions s WHERE s.user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Belt and braces: refresh tokens cascade from sessions, but revoke any orphans too.
  UPDATE auth.refresh_tokens rt
     SET revoked = true, updated_at = now()
   WHERE rt.user_id = p_user_id::text
     AND NOT rt.revoked;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_user_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_sessions(uuid) TO service_role;

COMMENT ON FUNCTION public.admin_revoke_user_sessions(uuid) IS
  'Service-only. Drops every auth session (and refresh token) of a partner_users login. Called by ef_admin_partner_users on disable / reset_mfa.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. partner_list_withdrawals__core: add partner_code scoping
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_list_withdrawals__core(p_include_closed boolean DEFAULT false)
RETURNS TABLE(request_id uuid, customer_id bigint, client_name text, subaccount_name text, amount_zar numeric,
              status text, requested_at timestamptz, ready_at timestamptz, partner_reference text,
              reconciliation_status text, completed_at timestamptz, relink_pending boolean)
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
    -- The client must belong to the calling partner, not merely be "some" omnibus client.
    AND EXISTS (SELECT 1 FROM public.subaccount_requests sr
                 WHERE sr.customer_id = wr.customer_id
                   AND sr.partner_code = public.current_partner_code())
    AND (p_include_closed OR wr.status = 'awaiting_partner')
    AND (p_include_closed IS FALSE OR wr.status IN ('awaiting_partner','paying_out','completed'))
  ORDER BY (wr.status = 'awaiting_partner') DESC, wr.requested_at;
$$;

REVOKE EXECUTE ON FUNCTION public.partner_list_withdrawals__core(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_list_withdrawals__core(boolean) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trade notifications to the partner
-- Finova asked to be told every time a trade executes in one of their omnibus subaccounts.
-- ef_partner_notifications (cron */10) batches all un-notified fills of finova_omnibus
-- customers into ONE email and stamps them here only after a successful send.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE lth_pvr.order_fills
  ADD COLUMN IF NOT EXISTS partner_notified_at timestamptz;

COMMENT ON COLUMN lth_pvr.order_fills.partner_notified_at IS
  'When this fill was included in a partner (Finova) trade-notification email. NULL = not yet sent. Only populated for finova_omnibus customers.';

CREATE INDEX IF NOT EXISTS order_fills_partner_unnotified_idx
  ON lth_pvr.order_fills (created_at)
  WHERE partner_notified_at IS NULL;

-- Historical fills predate the feature; never email a backlog.
UPDATE lth_pvr.order_fills SET partner_notified_at = now() WHERE partner_notified_at IS NULL;
