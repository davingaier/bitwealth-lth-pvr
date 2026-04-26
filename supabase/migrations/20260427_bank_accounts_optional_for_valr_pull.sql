-- =====================================================================
-- 20260427_bank_accounts_optional_for_valr_pull
-- =====================================================================
-- Phase 1 of removing customer-side bank-data capture.
--
-- Background
-- ----------
-- Customer banking details are no longer captured by the customer or admin;
-- they are pulled from VALR via `ef_link_bank_account` (GET /v1/fiat/ZAR/banks
-- → match by accountNumber). The customer must link their bank on the VALR
-- portal first; we then sync.
--
-- Therefore the only fields we are guaranteed to populate are those VALR
-- returns (bank_name, bank_account_holder, bank_account_number) — and even
-- those may be absent until the customer links the bank on VALR. Branch code
-- and account type are NOT returned by VALR's bank list and become admin-
-- supplied metadata.
--
-- This migration drops the NOT NULL constraints so that a `bank_accounts` row
-- can exist with only the bank confirmation letter URL (the one piece the
-- customer still uploads) and be progressively filled as VALR sync succeeds
-- and an admin classifies the account type.
-- =====================================================================

BEGIN;

ALTER TABLE public.bank_accounts
  ALTER COLUMN bank_name           DROP NOT NULL,
  ALTER COLUMN bank_account_holder DROP NOT NULL,
  ALTER COLUMN bank_account_number DROP NOT NULL,
  ALTER COLUMN bank_branch_code    DROP NOT NULL,
  ALTER COLUMN bank_account_type   DROP NOT NULL;

COMMENT ON COLUMN public.bank_accounts.bank_name IS
  'Populated by VALR sync via ef_link_bank_account. Nullable: customer must link bank on VALR portal first.';
COMMENT ON COLUMN public.bank_accounts.bank_account_holder IS
  'Populated by VALR sync. Nullable until first successful sync.';
COMMENT ON COLUMN public.bank_accounts.bank_account_number IS
  'Populated by VALR sync. Nullable until first successful sync.';
COMMENT ON COLUMN public.bank_accounts.bank_branch_code IS
  'Not returned by VALR. Admin-supplied metadata. Nullable.';
COMMENT ON COLUMN public.bank_accounts.bank_account_type IS
  'Not returned by VALR. Admin- or customer-supplied (cheque|savings|transmission|business). Nullable.';

COMMIT;
