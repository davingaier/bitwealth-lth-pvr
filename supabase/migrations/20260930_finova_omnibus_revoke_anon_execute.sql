-- Supabase's default privileges grant EXECUTE on new public functions DIRECTLY to anon
-- (not only via PUBLIC), so "REVOKE ... FROM PUBLIC" left every partner/admin RPC callable
-- with the public website key. Bodies were guarded, but two helpers were not:
-- suggested_subaccount_name() leaked any client's name by id, and
-- raise_subaccount_request() let anyone queue partner tasks.

-- Internal helpers: only ever invoked from triggers / SECURITY DEFINER code / service role.
REVOKE ALL ON FUNCTION public.suggested_subaccount_name(bigint)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raise_subaccount_request(bigint, text)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_details_raise_subaccount_request() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_request_ip()                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_request_user_agent()             FROM PUBLIC, anon, authenticated;

-- User-facing RPCs: logged-in users only (each body enforces partner/admin itself).
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_get_partners','admin_list_partner_invoices','admin_list_partner_users',
        'admin_list_partner_withdrawals','admin_list_subaccount_requests','admin_raise_bank_relink',
        'admin_set_partner_user_state','admin_update_partner',
        'partner_confirm_bank_relink','partner_confirm_invoice_fees','partner_list_audit_log',
        'partner_list_invoices','partner_list_requests','partner_list_withdrawals',
        'partner_session_ok','partner_whoami','current_partner_code','is_partner_user',
        'list_customers','list_customers_for_admin_picker','list_finova_kyc')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
