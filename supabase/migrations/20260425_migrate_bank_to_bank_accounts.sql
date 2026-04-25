-- Migration: 20260425_migrate_bank_to_bank_accounts
-- Purpose: Move bank details from public.exchange_accounts → public.bank_accounts
--          and make bank_accounts the single source of truth for customer banking.
-- Per SDD v0.6.94.
--
-- Steps:
--   1. Add exchange_accounts.bank_account_id FK → bank_accounts(bank_account_id).
--   2. Backfill bank_accounts from every exchange_accounts row that has any bank info
--      (rows with bank_valr_id are linked; rows without are still migrated to prevent
--       data loss when the legacy bank_* columns are dropped).
--   3. Update get_customer_exchange_account RPC to LEFT JOIN bank_accounts.
--   4. Drop bank_name, bank_account_number, bank_branch_code, bank_account_type,
--      bank_account_holder columns from exchange_accounts.
--      (Retain bank_valr_id, bank_linked_at, bank_link_method on exchange_accounts —
--       these are VALR-side identifiers, not customer banking data.)

BEGIN;

-- =====================================================================
-- 1. ADD FK COLUMN
-- =====================================================================
ALTER TABLE public.exchange_accounts
  ADD COLUMN IF NOT EXISTS bank_account_id uuid
  REFERENCES public.bank_accounts(bank_account_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_exchange_accounts_bank_account_id
  ON public.exchange_accounts(bank_account_id);

-- =====================================================================
-- 2. BACKFILL bank_accounts FROM exchange_accounts
-- =====================================================================
-- Insert one bank_accounts row per exchange_account that has any bank info,
-- linking via the most-recent (highest effective_from) customer_strategies row.
WITH src AS (
  SELECT DISTINCT ON (ea.exchange_account_id)
    ea.exchange_account_id,
    ea.org_id,
    cs.customer_id,
    ea.bank_name,
    ea.bank_account_holder,
    ea.bank_account_number,
    ea.bank_branch_code,
    ea.bank_account_type,
    ea.bank_linked_at
  FROM public.exchange_accounts ea
  JOIN public.customer_strategies cs ON cs.exchange_account_id = ea.exchange_account_id
  WHERE ea.bank_name IS NOT NULL
     OR ea.bank_account_number IS NOT NULL
     OR ea.bank_account_holder IS NOT NULL
  ORDER BY ea.exchange_account_id, cs.created_at DESC
),
inserted AS (
  INSERT INTO public.bank_accounts (
    customer_id, org_id, bank_name, bank_account_holder,
    bank_account_number, bank_branch_code, bank_account_type,
    is_primary, status, created_at, updated_at
  )
  SELECT
    src.customer_id,
    src.org_id,
    COALESCE(src.bank_name, 'Unknown'),
    COALESCE(src.bank_account_holder, 'Unknown'),
    COALESCE(src.bank_account_number, 'Unknown'),
    COALESCE(src.bank_branch_code, 'Unknown'),
    COALESCE(src.bank_account_type, 'Unknown'),
    true,
    'active',
    COALESCE(src.bank_linked_at, now()),
    now()
  FROM src
  -- Skip customers who already have a bank_accounts row (idempotent).
  WHERE NOT EXISTS (
    SELECT 1 FROM public.bank_accounts ba WHERE ba.customer_id = src.customer_id
  )
  RETURNING bank_account_id, customer_id
)
UPDATE public.exchange_accounts ea
SET bank_account_id = ins.bank_account_id
FROM inserted ins
JOIN public.customer_strategies cs ON cs.customer_id = ins.customer_id
WHERE ea.exchange_account_id = cs.exchange_account_id
  AND ea.bank_account_id IS NULL;

-- Also link exchange_accounts rows whose customer already had a bank_accounts row
-- (e.g. customer used the new self-service portal before this migration ran).
UPDATE public.exchange_accounts ea
SET bank_account_id = ba.bank_account_id
FROM public.customer_strategies cs
JOIN public.bank_accounts ba ON ba.customer_id = cs.customer_id AND ba.is_primary = true
WHERE ea.exchange_account_id = cs.exchange_account_id
  AND ea.bank_account_id IS NULL
  AND (ea.bank_name IS NOT NULL OR ea.bank_account_number IS NOT NULL);

-- =====================================================================
-- 3. UPDATE get_customer_exchange_account RPC
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_customer_exchange_account(p_customer_id bigint)
RETURNS TABLE(
  exchange_account_id uuid,
  bank_name text,
  bank_account_number text,
  bank_account_holder text,
  bank_branch_code text,
  bank_account_type text,
  bank_account_id uuid,
  bank_valr_id text,
  bank_linked_at timestamptz,
  bank_link_method text,
  api_key_label text,
  api_key_verified_at timestamptz,
  api_key_expires_at timestamptz,
  api_key_has_trade boolean,
  api_key_has_withdraw boolean,
  api_key_has_view boolean,
  api_key_has_link_bank boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    ea.exchange_account_id,
    ba.bank_name,
    ba.bank_account_number,
    ba.bank_account_holder,
    ba.bank_branch_code,
    ba.bank_account_type,
    ba.bank_account_id,
    ea.bank_valr_id,
    ea.bank_linked_at,
    ea.bank_link_method,
    ea.api_key_label,
    ea.api_key_verified_at,
    ea.api_key_expires_at,
    ea.api_key_has_trade,
    ea.api_key_has_withdraw,
    ea.api_key_has_view,
    ea.api_key_has_link_bank
  FROM public.exchange_accounts ea
  JOIN public.customer_strategies cs ON cs.exchange_account_id = ea.exchange_account_id
  LEFT JOIN public.bank_accounts ba
    ON ba.bank_account_id = ea.bank_account_id
   AND ba.status = 'active'
  WHERE cs.customer_id = p_customer_id
    AND cs.status NOT IN ('closed', 'terminated')
  ORDER BY cs.created_at DESC
  LIMIT 1;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_customer_exchange_account(bigint) TO anon, authenticated, service_role;

-- =====================================================================
-- 4. DROP LEGACY BANK COLUMNS FROM exchange_accounts
-- =====================================================================
ALTER TABLE public.exchange_accounts DROP COLUMN IF EXISTS bank_name;
ALTER TABLE public.exchange_accounts DROP COLUMN IF EXISTS bank_account_number;
ALTER TABLE public.exchange_accounts DROP COLUMN IF EXISTS bank_account_holder;
ALTER TABLE public.exchange_accounts DROP COLUMN IF EXISTS bank_branch_code;
ALTER TABLE public.exchange_accounts DROP COLUMN IF EXISTS bank_account_type;

COMMIT;
