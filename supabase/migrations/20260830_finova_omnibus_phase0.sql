-- 20260830_finova_omnibus_phase0.sql
-- Phase 0 of the Finova omnibus custody build: data model only.
--
-- Adds a third custody model ('finova_omnibus') where client assets sit in a
-- subaccount of Finova's VALR omnibus account. Finova creates each subaccount
-- manually and supplies a subaccount-scoped API key (View + Trade + Transfer,
-- never Withdraw) through the partner portal.
--
-- Finova users are deliberately NOT added to public.org_members: every org-scoped
-- RLS policy uses `org_id in (select id from public.my_orgs())`, so membership
-- would expose all customers including BitWealth-custody ones. They live in
-- public.partner_users instead and only ever reach data via SECURITY DEFINER RPCs
-- that hard-filter on account_model = 'finova_omnibus'.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Third custody model
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.customer_details
  DROP CONSTRAINT IF EXISTS customer_details_account_model_check;

ALTER TABLE public.customer_details
  ADD CONSTRAINT customer_details_account_model_check
  CHECK (account_model = ANY (ARRAY['subaccount'::text, 'api'::text, 'finova_omnibus'::text]));

COMMENT ON COLUMN public.customer_details.account_model IS
  'subaccount = BitWealth master VALR account + X-VALR-SUB-ACCOUNT-ID header; '
  'api = customer owns their VALR account, keys in vault; '
  'finova_omnibus = subaccount of Finova''s VALR omnibus account, subaccount-scoped key in vault (no header).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Subaccount naming
-- VALR permits only [A-Za-z0-9 ] in subaccount names — verified 2026-08-30 by
-- direct test (underscores and commas rejected) and previously via the API,
-- where a hyphenated surname was rejected. Company suffixes like "(Pty) Ltd"
-- must therefore be stripped, so the name is always machine-generated and the
-- partner portal shows Finova the exact string to copy.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.suggested_subaccount_name(p_customer_id bigint)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             'BW ' || CASE
                        WHEN cd.client_type = 'entity' THEN COALESCE(cd.entity_name, '')
                        ELSE COALESCE(cd.last_name, '') || ' ' || COALESCE(cd.first_names, '')
                      END,
             '[^A-Za-z0-9 ]+', ' ', 'g'),
           '\s+', ' ', 'g'))
  FROM public.customer_details cd
  WHERE cd.customer_id = p_customer_id;
$$;

COMMENT ON FUNCTION public.suggested_subaccount_name(bigint) IS
  'Finova omnibus subaccount name: "BW {last} {first}" for individuals, "BW {entity_name}" for entities, sanitised to VALR''s [A-Za-z0-9 ] charset.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Partner users (Finova logins)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_users (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_code text        NOT NULL DEFAULT 'finova',
  full_name    text,
  email        text        NOT NULL,
  -- Maker-checker support: present so four-eyes can be switched on later without
  -- a migration. Not enforced anywhere yet — everyone defaults to 'both'.
  role         text        NOT NULL DEFAULT 'both'
                           CHECK (role IN ('submitter', 'authoriser', 'both')),
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  disabled_at  timestamptz,
  disabled_by  uuid
);

CREATE INDEX IF NOT EXISTS partner_users_partner_code_idx
  ON public.partner_users (partner_code) WHERE is_active;

COMMENT ON TABLE public.partner_users IS
  'Third-party partner (Finova) portal logins. Deliberately separate from org_members so partners never inherit org-scoped RLS access to all customers.';

ALTER TABLE public.partner_users ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Partner identity helpers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_partner_user()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_users pu
    WHERE pu.user_id = auth.uid() AND pu.is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.current_partner_code()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT pu.partner_code FROM public.partner_users pu
  WHERE pu.user_id = auth.uid() AND pu.is_active;
$$;

GRANT EXECUTE ON FUNCTION public.is_partner_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_partner_code() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Subaccount provisioning / bank re-link requests
-- Never stores the API key or secret — those go straight to Supabase Vault.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subaccount_requests (
  request_id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid        NOT NULL,
  customer_id              bigint      NOT NULL REFERENCES public.customer_details(customer_id) ON DELETE CASCADE,
  partner_code             text        NOT NULL DEFAULT 'finova',
  request_type             text        NOT NULL DEFAULT 'provision'
                                       CHECK (request_type IN ('provision', 'bank_relink')),
  status                   text        NOT NULL DEFAULT 'pending'
                                       CHECK (status IN ('pending', 'submitted', 'verified', 'rejected', 'cancelled')),

  -- What we tell Finova to create
  suggested_subaccount_name text,

  -- What Finova reports back
  submitted_subaccount_name text,
  subaccount_id             text,
  -- Lives only inside Finova's VALR account; BitWealth cannot read it, so Finova
  -- must supply it or the client has no way to deposit ZAR.
  zar_deposit_reference     text,
  api_key_name              text,
  bank_link_confirmed       boolean     NOT NULL DEFAULT false,
  bank_valr_id              text,

  exchange_account_id       uuid REFERENCES public.exchange_accounts(exchange_account_id),
  verification_error        text,
  notes                     text,

  requested_at             timestamptz NOT NULL DEFAULT now(),
  submitted_at             timestamptz,
  submitted_by             uuid REFERENCES auth.users(id),
  verified_at              timestamptz,
  rejected_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- One open request per customer per type; verified/rejected/cancelled rows are history.
CREATE UNIQUE INDEX IF NOT EXISTS subaccount_requests_one_open_idx
  ON public.subaccount_requests (customer_id, request_type)
  WHERE status IN ('pending', 'submitted');

CREATE INDEX IF NOT EXISTS subaccount_requests_queue_idx
  ON public.subaccount_requests (partner_code, status, requested_at);

COMMENT ON TABLE public.subaccount_requests IS
  'Queue of VALR subaccount provisioning / bank re-link tasks for a partner (Finova). Never holds API credentials — those go to Vault.';

ALTER TABLE public.subaccount_requests ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Partner audit log
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_action_log (
  log_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  partner_user_id uuid REFERENCES auth.users(id),
  partner_code    text        NOT NULL DEFAULT 'finova',
  action          text        NOT NULL,
  entity_type     text,
  entity_id       text,
  customer_id     bigint,
  detail          jsonb,
  ip_address      text,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_action_log_partner_idx
  ON public.partner_action_log (partner_code, created_at DESC);

COMMENT ON TABLE public.partner_action_log IS
  'Immutable audit trail of every partner-portal action. Visible to the partner for their own actions.';

ALTER TABLE public.partner_action_log ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Withdrawal state machine: awaiting_partner
-- Finova-custody keys have no Withdraw permission, so after we convert to ZAR
-- the payout stops here until Finova performs it manually.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE lth_pvr.withdrawal_requests
  DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check;
ALTER TABLE lth_pvr.withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_status_check
  CHECK (status = ANY (ARRAY['pending','converting','awaiting_partner','paying_out','completed','failed','cancelled']));

ALTER TABLE lth_pvr.withdrawal_requests
  DROP CONSTRAINT IF EXISTS wr_status_check;
ALTER TABLE lth_pvr.withdrawal_requests
  ADD CONSTRAINT wr_status_check
  CHECK (status = ANY (ARRAY['pending','approved','rejected','converting','awaiting_partner','paying_out','completed','failed','cancelled']));

ALTER TABLE lth_pvr.withdrawal_requests
  ADD COLUMN IF NOT EXISTS partner_notified_at         timestamptz,
  ADD COLUMN IF NOT EXISTS partner_marked_complete_at  timestamptz,
  ADD COLUMN IF NOT EXISTS partner_marked_complete_by  uuid,
  ADD COLUMN IF NOT EXISTS partner_reference           text,
  ADD COLUMN IF NOT EXISTS reconciliation_status       text
    CHECK (reconciliation_status IS NULL OR reconciliation_status IN ('pending','matched','unmatched'));

COMMENT ON COLUMN lth_pvr.withdrawal_requests.partner_reference IS
  'Partner-supplied payment reference captured when Finova marks the payout complete.';
COMMENT ON COLUMN lth_pvr.withdrawal_requests.reconciliation_status IS
  'Result of matching the partner-declared payout against VALR transaction history. Never closed on the partner''s word alone.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Provenance on the exchange account
-- deposit_ref / bank_linked_at / bank_link_method / bank_valr_id / subaccount_id
-- already exist and are reused for the Finova-supplied values.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.exchange_accounts
  ADD COLUMN IF NOT EXISTS provisioned_by text
    CHECK (provisioned_by IS NULL OR provisioned_by IN ('bitwealth', 'finova'));

COMMENT ON COLUMN public.exchange_accounts.provisioned_by IS
  'Who created the VALR subaccount: bitwealth (via ef_valr_create_subaccount) or finova (manually, via the partner portal).';
COMMENT ON COLUMN public.exchange_accounts.deposit_ref IS
  'ZAR deposit reference the client must quote. For Finova-custody clients this is supplied by Finova — BitWealth cannot read it from VALR.';
