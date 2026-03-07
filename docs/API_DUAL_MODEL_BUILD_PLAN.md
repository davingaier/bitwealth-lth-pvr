# API Discretionary Model — Dual-Model Build Plan

**Document Version:** 1.0  
**Prepared:** 2026-03-07  
**Status:** Ready for implementation

## Overview

This document is the authoritative step-by-step build plan for adding the **API Discretionary Model** to the existing BitWealth system alongside the existing **Subaccount Model**. From the KYC verification step onward, an admin selects which model a customer is placed on. The two models then diverge on account setup and order execution credentials, while sharing the same LTH PVR strategy decision logic, ledger, and balances pipeline.

---

## Key Research Findings

| Question | Answer |
|---|---|
| VALR API key expiry | **No built-in expiry.** Keys remain valid until manually deleted. Implement policy-based `api_key_expires_at` (default 365 days) stored in `exchange_accounts`. |
| Supabase Vault status | **Already enabled.** `supabase_vault` v0.3.1, `vault.secrets` and `vault.decrypted_secrets` are live. No setup needed. |
| BitWealth BTC wallet (fee collection) | `38ppcqBCz58KENxP9Hi79oCrVFuPTHSdTP` |
| BitWealth USDT wallet (fee collection) | `TSivCwsgBRXBT2A4nF6zRJcMMSX2FeNrfP` (TRON network) |
| VALR fee withdrawal mechanism | Customer API key with **Withdraw** permission. Customer whitelists BitWealth's wallet addresses when creating their VALR API key. `ef_post_ledger_and_balances` calls `POST /v1/wallet/crypto/{currency}/withdraw` using the customer's vault-stored key. |
| ZAR withdrawal fees | 30 free normal withdrawals/month, R8.50 thereafter. Fast withdrawal to Standard Bank: free; RTC/other banks: R30. |
| VALR ZAR→USDT conversion pair | `USDTZAR` (fiat pair). Side: BUY to bring USDT in, SELL to get ZAR out. |
| VALR permissions required for API model | **View, Trade, Withdraw, Link Bank Account** — all four. |

---

## Existing Objects to Reuse (Do NOT Recreate)

| Object | Location | Enhancement Needed |
|---|---|---|
| `lth_pvr.pending_zar_conversions` | DB table | Add `status`, `order_id`, `order_side`, `pair` columns |
| `lth_pvr.v_pending_zar_conversions` | DB view | Rebuild after table enhancement |
| "Pending ZAR Conversions" card | Admin UI | Add "Convert ZAR → USDT" button |
| `public.withdrawal_requests` | DB table | Add `amount_zar`, `estimated_usdt`, `valr_conversion_fee_usdt`, `valr_withdrawal_fee_zar`, `conversion_order_id`, `conversion_status`, `zar_withdrawal_ref`, `is_first_free_withdrawal` columns |
| `lth_pvr.withdrawal_fee_snapshots` | DB table | No change |
| "Withdrawal Request Notification" email | DB | No change |
| "Withdrawal Approved" email | DB | No change |
| "Withdrawal Completed" email | DB | No change |
| Customer portal Withdrawals + Settings nav | `website/customer-portal.html` | Build content sections |
| `supabase_vault` extension | Supabase project | No action needed |

---

## New Objects to Create

| Object | Type | Purpose |
|---|---|---|
| `public.wallet_config` | New DB table | BitWealth's static fee-collection wallet addresses |
| `public.customer_details.account_model` | New column | Track model per customer |
| API key columns on `lth_pvr.exchange_accounts` | New columns | Vault IDs + key metadata |
| Bank account columns on `lth_pvr.exchange_accounts` | New columns | Bank details for linking |
| `_shared/valrCredentials.ts` | New shared module | Centralised credential resolver |
| `ef_store_customer_api_keys` | New edge function | Securely store + validate customer VALR API keys |
| `ef_convert_zar_to_usdt` | New edge function | Admin-triggered ZAR→USDT limit/market order |
| `ef_request_withdrawal` | New edge function | Customer-initiated withdrawal request |
| `ef_convert_usdt_to_zar` | New edge function | Admin-triggered USDT→ZAR conversion + fiat withdrawal |
| `ef_convert_btc_to_zar` | New edge function | Admin-triggered BTC→ZAR conversion + fiat withdrawal (fallback when USDT insufficient) |
| `ef_rotate_api_key_notifications` | New edge function | Daily cron to warn on expiring API keys |
| `ef_link_bank_account` | New edge function | Programmatic VALR bank account linking |
| "ZAR Deposit Detected - Conversion Required" | New email template | Admin alert for API/subaccount ZAR deposit needing manual conversion |
| "API Key Expiry Warning" | New email template | Customer warning 30/10-day before expiry |
| "API Key Expiry Critical" | New email template | Customer alert on key expiry + trading suspended |

---

## Phase 0: Database Migrations

Apply in this order. Each is a separate named migration.

---

### Migration 1: `20260307_add_account_model`

```sql
-- Add account_model to customer_details
-- All existing customers default to 'subaccount' — no data migration needed
ALTER TABLE public.customer_details
  ADD COLUMN account_model TEXT NOT NULL DEFAULT 'subaccount'
  CHECK (account_model IN ('subaccount', 'api'));

COMMENT ON COLUMN public.customer_details.account_model IS
  'subaccount = BitWealth holds BTC in VALR subaccount under master account; api = customer owns their VALR account, BitWealth trades via customer-provided API keys';
```

---

### Migration 2: `20260307_add_api_key_fields_to_exchange_accounts`

```sql
-- API key vault storage + metadata for API model customers
ALTER TABLE lth_pvr.exchange_accounts
  ADD COLUMN api_key_vault_id     UUID        NULL,
  ADD COLUMN api_secret_vault_id  UUID        NULL,
  ADD COLUMN api_key_label        TEXT        NULL,
  ADD COLUMN api_key_created_at   TIMESTAMPTZ NULL,
  ADD COLUMN api_key_expires_at   TIMESTAMPTZ NULL,
  ADD COLUMN api_key_verified_at  TIMESTAMPTZ NULL,
  ADD COLUMN api_key_has_withdraw BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN api_key_has_view     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN api_key_has_trade    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN api_key_has_link_bank BOOLEAN    NOT NULL DEFAULT false;

COMMENT ON COLUMN lth_pvr.exchange_accounts.api_key_vault_id IS
  'Reference to vault.secrets UUID containing the customer VALR API key (API model customers only)';
COMMENT ON COLUMN lth_pvr.exchange_accounts.api_secret_vault_id IS
  'Reference to vault.secrets UUID containing the customer VALR API secret (API model customers only)';
COMMENT ON COLUMN lth_pvr.exchange_accounts.api_key_expires_at IS
  'Policy-based expiry date set by admin. VALR keys do not expire natively. Default: 365 days from creation.';
```

---

### Migration 3: `20260307_add_bank_account_to_exchange_accounts`

```sql
-- Bank account details for both models (used for VALR bank-link API and ZAR fiat withdrawals)
ALTER TABLE lth_pvr.exchange_accounts
  ADD COLUMN bank_account_number  TEXT        NULL,
  ADD COLUMN bank_account_holder  TEXT        NULL,
  ADD COLUMN bank_name            TEXT        NULL,
  ADD COLUMN bank_branch_code     TEXT        NULL,
  ADD COLUMN bank_account_type    TEXT        NULL CHECK (bank_account_type IN ('current','savings','transmission') OR bank_account_type IS NULL),
  ADD COLUMN bank_linked_at       TIMESTAMPTZ NULL,
  ADD COLUMN bank_link_method     TEXT        NULL CHECK (bank_link_method IN ('manual','api') OR bank_link_method IS NULL),
  ADD COLUMN bank_valr_id         TEXT        NULL;  -- VALR's internal bank account ID after linking

COMMENT ON COLUMN lth_pvr.exchange_accounts.bank_valr_id IS
  'VALR-assigned ID returned after bank account is linked via API. Required for fiat withdrawals.';
```

---

### Migration 4: `20260307_create_wallet_config`

```sql
-- BitWealth's static wallet addresses for fee collection
-- These must never change once customers have whitelisted them
CREATE TABLE public.wallet_config (
  wallet_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL REFERENCES public.organizations(id),
  asset         TEXT        NOT NULL CHECK (asset IN ('BTC', 'USDT', 'ZAR')),
  network       TEXT        NOT NULL DEFAULT 'native',  -- 'native', 'TRON', 'ERC20' etc.
  address       TEXT        NOT NULL,
  label         TEXT        NULL,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NULL,
  UNIQUE (org_id, asset, network)
);

COMMENT ON TABLE public.wallet_config IS
  'BitWealth static wallet addresses for fee collection. Customers whitelist these when creating their VALR API keys. Must not change.';

-- Insert BitWealth's existing fee-collection wallets
-- Replace org_id with the correct UUID before running
INSERT INTO public.wallet_config (org_id, asset, network, address, label) VALUES
  ('b0a77009-03b9-44a1-ae1d-34f157d44a8b', 'BTC',  'native', '38ppcqBCz58KENxP9Hi79oCrVFuPTHSdTP', 'BitWealth BTC Fee Wallet'),
  ('b0a77009-03b9-44a1-ae1d-34f157d44a8b', 'USDT', 'TRON',   'TSivCwsgBRXBT2A4nF6zRJcMMSX2FeNrfP', 'BitWealth USDT Fee Wallet (TRC-20)');
```

---

### Migration 5: `20260307_enhance_pending_zar_conversions`

```sql
-- Enhance existing pending_zar_conversions table with order tracking fields
-- (needed so ef_convert_zar_to_usdt can track limit/market order lifecycle)
ALTER TABLE lth_pvr.pending_zar_conversions
  ADD COLUMN status        TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','limit_placed','market_placed','filled','cancelled','failed')),
  ADD COLUMN order_id      TEXT        NULL,  -- VALR order ID while limit order is live
  ADD COLUMN pair          TEXT        NULL DEFAULT 'USDTZAR',
  ADD COLUMN order_side    TEXT        NULL DEFAULT 'BUY',
  ADD COLUMN limit_price   NUMERIC     NULL,
  ADD COLUMN order_type    TEXT        NULL CHECK (order_type IN ('limit','market') OR order_type IS NULL),
  ADD COLUMN error_message TEXT        NULL;

-- Set status on existing rows (all are either completed or pending)
UPDATE lth_pvr.pending_zar_conversions
SET status = CASE
  WHEN converted_at IS NOT NULL OR COALESCE(remaining_amount, zar_amount) <= 0.01 THEN 'filled'
  ELSE 'pending'
END;

-- Rebuild the view to include the new status column and model info
CREATE OR REPLACE VIEW lth_pvr.v_pending_zar_conversions AS
SELECT
  pzc.id,
  pzc.org_id,
  pzc.customer_id,
  cd.first_names,
  cd.last_name,
  cd.email,
  cd.account_model,
  pzc.zar_amount                                           AS original_zar_amount,
  COALESCE(pzc.converted_amount, 0)                        AS converted_amount,
  COALESCE(pzc.remaining_amount, pzc.zar_amount)           AS remaining_amount,
  pzc.status,
  pzc.order_id,
  pzc.occurred_at,
  EXTRACT(epoch FROM (CURRENT_TIMESTAMP - pzc.occurred_at)) / 3600 AS hours_pending,
  bd.balance                                               AS current_usdt_balance,
  pzc.funding_id,
  pzc.converted_at,
  pzc.conversion_funding_id,
  pzc.notes,
  pzc.error_message,
  CASE
    WHEN pzc.status = 'filled' OR pzc.converted_at IS NOT NULL THEN 'completed'
    WHEN COALESCE(pzc.remaining_amount, pzc.zar_amount) <= 0.01 THEN 'completed'
    WHEN pzc.converted_amount > 0 THEN 'partial'
    WHEN pzc.status = 'limit_placed'  THEN 'limit_placed'
    WHEN pzc.status = 'market_placed' THEN 'market_placed'
    WHEN pzc.status = 'failed'        THEN 'failed'
    ELSE 'pending'
  END AS conversion_status
FROM lth_pvr.pending_zar_conversions pzc
JOIN public.customer_details cd USING (customer_id)
LEFT JOIN LATERAL (
  SELECT usdt_balance AS balance
  FROM lth_pvr.balances_daily
  WHERE customer_id = pzc.customer_id
  ORDER BY date DESC LIMIT 1
) bd ON true
WHERE pzc.status NOT IN ('filled','cancelled')
  AND (pzc.converted_at IS NULL OR COALESCE(pzc.remaining_amount, pzc.zar_amount) > 0.01)
ORDER BY pzc.occurred_at;
```

---

### Migration 6: `20260307_enhance_withdrawal_requests`

```sql
-- Enhance existing public.withdrawal_requests with ZAR, conversion, and bank details
ALTER TABLE public.withdrawal_requests
  ADD COLUMN amount_zar               NUMERIC     NULL,   -- amount customer wants to receive in ZAR
  ADD COLUMN estimated_usdt           NUMERIC     NULL,   -- USDT required to cover amount_zar at time of request
  ADD COLUMN valr_conversion_fee_usdt NUMERIC     NULL,   -- VALR 0.18% conversion fee estimate
  ADD COLUMN valr_withdrawal_fee_zar  NUMERIC     NULL,   -- R8.50 or R0 (first free) or R30 (fast)
  ADD COLUMN is_first_free_withdrawal BOOLEAN     NULL,   -- whether this is within the 30 free/month
  ADD COLUMN conversion_order_id      TEXT        NULL,   -- VALR order ID for USDT→ZAR conversion step
  ADD COLUMN conversion_status        TEXT        NULL
                                      CHECK (conversion_status IN ('pending','limit_placed','market_placed','filled','failed') OR conversion_status IS NULL),
  ADD COLUMN zar_withdrawal_ref       TEXT        NULL,   -- VALR withdrawal reference
  ADD COLUMN source_asset             TEXT        NULL    -- 'USDT' or 'BTC' (which was converted to ZAR)
                                      CHECK (source_asset IN ('USDT','BTC') OR source_asset IS NULL);

COMMENT ON COLUMN public.withdrawal_requests.amount_zar IS
  'ZAR amount customer wants to receive (not USDT). amount_usdt is derived from this via live USDTZAR rate.';
COMMENT ON COLUMN public.withdrawal_requests.is_first_free_withdrawal IS
  'True if this is within the 30 free normal ZAR withdrawals for the calendar month.';
```

---

## Phase 1: Shared Infrastructure

### S1 — New: `supabase/functions/_shared/valrCredentials.ts`

This module is the centralised credential resolver. Every edge function that touches VALR on behalf of a customer calls this instead of reading env vars directly.

**Interface:**
```typescript
export interface ValrCredentials {
  apiKey: string;
  apiSecret: string;
  subaccountId: string | null;  // null for API model (no subaccount header)
  accountModel: 'subaccount' | 'api';
}

export async function resolveCustomerCredentials(
  sb: SupabaseClient,
  customerId: number
): Promise<ValrCredentials>
```

**Logic:**
1. Query `customer_details.account_model` for the customer
2. Query `customer_strategies` → `exchange_accounts` for their `exchange_account_id`
3. If `account_model = 'subaccount'`:
   - Return `{ apiKey: env.VALR_API_KEY, apiSecret: env.VALR_API_SECRET, subaccountId: exchange_accounts.subaccount_id, accountModel: 'subaccount' }`
4. If `account_model = 'api'`:
   - Query `exchange_accounts.api_key_vault_id` and `api_secret_vault_id`
   - Execute: `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $vault_id` (via service role)
   - Return `{ apiKey: decryptedKey, apiSecret: decryptedSecret, subaccountId: null, accountModel: 'api' }`

**Security notes:**
- This function is only importable by service-role edge functions (no JWT exposure)
- Vault secret retrieval uses `pgmq.execute_sql` pattern or `supabase.rpc` with a SECURITY DEFINER wrapper
- Consider: create `lth_pvr.get_customer_valr_credentials(p_customer_id BIGINT)` as a SECURITY DEFINER SQL function so the vault query is inside a privileged function rather than inline SQL

**SQL helper function to create (migration or manually):**
```sql
CREATE OR REPLACE FUNCTION lth_pvr.get_customer_valr_credentials(p_customer_id BIGINT)
RETURNS TABLE (
  api_key         TEXT,
  api_secret      TEXT,
  subaccount_id   TEXT,
  account_model   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = lth_pvr, public, vault
AS $$
DECLARE
  v_model        TEXT;
  v_sub_id       TEXT;
  v_key_vault_id UUID;
  v_sec_vault_id UUID;
  v_api_key      TEXT;
  v_api_secret   TEXT;
BEGIN
  SELECT cd.account_model, ea.subaccount_id, ea.api_key_vault_id, ea.api_secret_vault_id
  INTO v_model, v_sub_id, v_key_vault_id, v_sec_vault_id
  FROM public.customer_details cd
  JOIN public.customer_strategies cs ON cs.customer_id = cd.customer_id
  JOIN lth_pvr.exchange_accounts ea  ON ea.exchange_account_id = cs.exchange_account_id
  WHERE cd.customer_id = p_customer_id
  ORDER BY cs.effective_from DESC
  LIMIT 1;

  IF v_model = 'api' THEN
    SELECT decrypted_secret INTO v_api_key    FROM vault.decrypted_secrets WHERE id = v_key_vault_id;
    SELECT decrypted_secret INTO v_api_secret FROM vault.decrypted_secrets WHERE id = v_sec_vault_id;
    RETURN QUERY SELECT v_api_key, v_api_secret, NULL::TEXT, 'api'::TEXT;
  ELSE
    -- subaccount model: caller reads env vars; return just the subaccount_id
    RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, v_sub_id, 'subaccount'::TEXT;
  END IF;
END;
$$;
```

---

### S2 — Update: `supabase/functions/ef_execute_orders/valrClient.ts`

Refactor `valrPrivateRequest()` to accept optional credential parameters:

```typescript
// Before (reads from env):
async function valrPrivateRequest(method, path, body, subaccountId?)

// After (accepts credentials or falls back to env):
async function valrPrivateRequest(
  method: string,
  path: string,
  body: unknown,
  subaccountId?: string | null,
  credentials?: { apiKey: string; apiSecret: string } | null
)
```

- If `credentials` is provided: use `credentials.apiKey` and `credentials.apiSecret`
- If `credentials` is null/undefined: use `Deno.env.get("VALR_API_KEY")` / `Deno.env.get("VALR_API_SECRET")` (existing subaccount path, no breaking change)
- All exported functions (`placeLimitOrder`, `placeMarketOrder`, `getOrderSummaryByCustomerOrderId`, `cancelOrderById`, `getMarketPrice`) get an optional `credentials?` parameter passed through

This is the only centralised change to `valrClient.ts`. All callers that pass `null` / omit credentials continue to work unchanged.

---

### S3 — Update: `supabase/functions/_shared/valrTransfer.ts`

Add new function alongside existing `transferToMainAccount()`:

```typescript
/**
 * For API model: withdraw fee from customer's own VALR account to BitWealth's static wallet.
 * Uses customer's Withdraw-scoped API key. Reads BitWealth wallet address from wallet_config.
 * Called by ef_post_ledger_and_balances after performance/platform fee is calculated.
 */
export async function withdrawFeeFromCustomerAccount(
  sb: SupabaseClient,
  customerId: number,
  currency: 'USDT' | 'BTC',
  amount: number,
  ledgerId?: string
): Promise<TransferResult>
```

**Logic:**
1. Fetch BitWealth's wallet address from `public.wallet_config` for the given `currency` (use service role)
2. Resolve customer credentials via `resolveCustomerCredentials()`
3. Call VALR `POST /v1/wallet/crypto/{currency}/withdraw` using customer's key
4. Log to `lth_pvr.valr_transfer_log` with `transfer_type = 'platform_fee'` or `'performance_fee'`

**Important:** The withdrawal will only succeed if the customer previously whitelisted BitWealth's wallet address in VALR. The edge function should handle the "address not whitelisted" error gracefully — log a critical alert and do NOT retry automatically (requires customer action).

---

## Phase 2: Core Pipeline Edge Functions

These functions need model-aware credential resolution. The logic change is identical in each: call `resolveCustomerCredentials()` after looking up the customer, then pass credentials to `valrClient` functions.

---

### EF1 — Update: `ef_execute_orders/index.ts`

After finding `exchange_account_id`:
```typescript
// Resolve credentials for this customer
const creds = await resolveCustomerCredentials(sb, i.customer_id);
const subaccountId   = creds.accountModel === 'subaccount' ? creds.subaccountId : null;
const valrCredentials = creds.accountModel === 'api'
  ? { apiKey: creds.apiKey, apiSecret: creds.apiSecret }
  : null; // uses env vars

// Pass to all valrClient calls:
await placeLimitOrder(payload, subaccountId, valrCredentials);
await placeMarketOrder(pair, side, qty, customerOrderId, subaccountId, valrCredentials);
```

No other logic changes.

---

### EF2 — Update: `ef_poll_orders/index.ts` and `lth_market_fallback_*`

Same pattern as EF1: resolve credentials per customer_id, pass through to `valrClient` calls. The market fallback functions currently read `subaccount_id` directly from `exchange_accounts`; replace that with `resolveCustomerCredentials()`.

---

### EF3 — Update: `ef_deposit_scan/index.ts`

Split the balance-check loop into two groups:

**Group A — Subaccount model (existing logic, unchanged path):**
- Query: customers with `registration_status='deposit'` AND `account_model='subaccount'`
- Use master API key + `X-VALR-SUB-ACCOUNT-ID` header (current code)
- If USDT or BTC balance > 0: activate customer → send existing activation email

**Group B — API model (new path):**
- Query: customers with `registration_status='deposit'` AND `account_model='api'`
- Use vault-decrypted customer API key (no subaccount header)
- Call same `GET /v1/account/balances` endpoint
- If **ZAR balance > 0**: write to `lth_pvr.pending_zar_conversions` (if not already there), send "ZAR Deposit Detected - Conversion Required" email to admin
- If **USDT or BTC balance > 0**: activate customer (same activation logic as subaccount model) — but do NOT use the "Funds Deposited - Admin Notification" template naively; check if it applies or send a generic activation email

**ZAR detection note:** For API model customers, `ef_deposit_scan` calls VALR balances endpoint once per customer. This is a read-only call that is well within rate limits. ZAR is returned as a separate currency in the balances array.

---

### EF4 — Update: `ef_sync_valr_transactions/index.ts`

Current code:
1. Fetches all active customers
2. Queries their `subaccount_id` from `exchange_accounts`
3. Calls `getTransactionHistory(subaccountId)` with master API key

Required change:
1. For each customer, call `resolveCustomerCredentials()` to get credentials + subaccountId
2. For subaccount model: existing `getTransactionHistory(subaccountId)` call with master key
3. For API model: new `getTransactionHistoryWithCredentials(credentials)` call — same endpoint (`/v1/account/transactionhistory`) but using customer key, no subaccount header
4. Core transaction processing loop is **identical** regardless of model — no changes needed inside it

**API model — undetected withdrawal handling:**
In the transaction sync, if a BLOCKCHAIN_SEND or FIAT_WITHDRAWAL type is detected for an API model customer that does not correspond to a `withdrawal_requests` record: log a `warn` alert and send the admin an email (use the existing "Withdrawal Request Notification" template with a note: "This withdrawal was made directly on VALR, not via the portal").

---

### EF5 — Update: `ef_post_ledger_and_balances/index.ts`

The fee transfer section currently calls `transferToMainAccount()` for all customers. Change to:

```typescript
if (creds.accountModel === 'subaccount') {
  await transferToMainAccount(sb, request, customerId, ledgerId);
} else {
  // API model: push fee from customer's account to BitWealth's static wallet
  await withdrawFeeFromCustomerAccount(sb, customerId, currency, amount, ledgerId);
}
```

Credential resolution: call `resolveCustomerCredentials()` once per customer at the start of the customer loop.

**No other changes** to the ledger/fill processing logic, which is model-agnostic.

---

### EF6 — Update: `ef_auto_convert_btc_to_usdt/index.ts`

Add credential resolution. For API model customers, use vault key. For subaccount, use env vars + subaccount header. Core BTC→USDT conversion logic unchanged.

---

## Phase 3: New Onboarding Edge Functions

---

### EF7 — New: `ef_store_customer_api_keys`

**Auth:** JWT-enabled (both admin session and customer session accepted)  
**Method:** POST  
**Path:** `/functions/v1/ef_store_customer_api_keys`

**Request body:**
```json
{
  "customer_id": 42,
  "api_key": "b9fb68df...",
  "api_secret": "4961b74e...",
  "api_key_label": "BitWealth Trade",
  "expires_at": "2027-03-07"
}
```

**Process:**
1. Validate the caller is either an admin (service role or admin email) or the customer themselves (match auth email to `customer_details.email`)
2. Validate `customer_details.account_model = 'api'` — reject if subaccount model
3. **Validate the key works:** Call `GET /v1/account/balances` with the provided credentials. If it fails: return error "API key/secret is invalid or has been revoked".
4. **Check permissions (best-effort):** Call `GET /v1/account/api-keys` to retrieve the key's permission flags. Warn if View, Trade, Withdraw, or Link Bank Account are missing.
5. **Store in Vault:**
   - `INSERT INTO vault.secrets (secret, name) VALUES ($api_key, 'customer_{id}_valr_api_key') RETURNING id` → `key_vault_id`
   - `INSERT INTO vault.secrets (secret, name) VALUES ($api_secret, 'customer_{id}_valr_api_secret') RETURNING id` → `secret_vault_id`
   - If secrets already exist (re-key scenario): update the existing vault records. Revoke old vault IDs from `exchange_accounts` first, then insert new ones.
6. **Update `exchange_accounts`:**
   ```sql
   UPDATE lth_pvr.exchange_accounts SET
     api_key_vault_id    = $key_vault_id,
     api_secret_vault_id = $secret_vault_id,
     api_key_label       = $label,
     api_key_created_at  = now(),
     api_key_expires_at  = $expires_at,  -- defaults to now() + 365 days if not provided
     api_key_verified_at = now(),
     api_key_has_withdraw = (permissions includes Withdraw),
     api_key_has_view     = (permissions includes View),
     api_key_has_trade    = (permissions includes Trade),
     api_key_has_link_bank = (permissions includes Link Bank Account)
   WHERE exchange_account_id = $customer_exchange_account_id;
   ```
7. If customer's `registration_status = 'setup'`: update to `'deposit'`
8. Return balance confirmation: `{ success: true, usdt_balance: 1234.56, btc_balance: 0.01234, verified_at: "..." }`

**Re-key scenario (customer updating API key before expiry):**
- Call this same endpoint with new credentials
- Old vault secrets are deleted after new ones are confirmed valid
- The customer remains `'active'` — no status regression

---

### EF8 — New: `ef_link_bank_account`

**Auth:** JWT-enabled (admin only — admin session required)  
**Method:** POST

**Request body:**
```json
{
  "customer_id": 42,
  "bank_account_number": "12345678",
  "bank_account_holder": "John Smith",
  "bank_name": "FNB",
  "bank_branch_code": "250655",
  "bank_account_type": "current"
}
```

**Process — API model:**
1. Resolve customer credentials from vault
2. Call VALR `POST /v1/bankaccounts/ZAR` with the customer's own API key (requires Link Bank Account permission)
3. Store the VALR-returned bank account ID in `exchange_accounts.bank_valr_id`
4. Store bank details in `exchange_accounts` bank columns

**Process — Subaccount model:**
1. Use master API key + `X-VALR-SUB-ACCOUNT-ID` header
2. Call same `POST /v1/bankaccounts/ZAR` endpoint impersonating the subaccount
3. Note: VALR may not support bank account linking for subaccounts this way. If it fails with a 4xx: log a `warn` and instruct admin to link bank account manually in VALR portal. Store bank details in exchange_accounts for record-keeping regardless.

**Future bank account change (from customer portal Settings):**
- Customer uploads new bank confirmation letter via portal
- Pending admin review; admin clicks "Link Bank Account" in Admin UI
- Calls this same edge function with updated bank details

---

## Phase 4: ZAR Conversion & Withdrawal Edge Functions

All conversion functions use the **same limit→5-minutes→0.25% price move→market fallback pattern** as `ef_execute_orders`.

---

### EF9 — New: `ef_convert_zar_to_usdt`

**Auth:** `--no-verify-jwt` (admin-triggered from UI)  
**Triggered by:** Admin clicking "Convert ZAR → USDT" button in "Pending ZAR Conversions" card  

**Request body:** `{ "conversion_id": "uuid-of-pending_zar_conversions-row" }`

**Process:**
1. Fetch the `pending_zar_conversions` record; validate `status = 'pending'`
2. Resolve customer credentials via `resolveCustomerCredentials()`
3. Get current USDTZAR ask price from VALR order book
4. Calculate limit price = best ask price (buying USDT, spending ZAR)
5. Calculate quantity in USDT = `remaining_amount / best_ask_price`
6. Place **LIMIT** USDTZAR BUY order using customer credentials
7. Update `pending_zar_conversions.status = 'limit_placed'`, store `order_id` and `limit_price`
8. Poll every 30 seconds for 5 minutes (or 0.25% price move away from limit):
   - On fill: update `status = 'filled'`, set `converted_at`, `converted_amount`, `remaining_amount = 0`
   - On timeout or price move: cancel limit, place MARKET USDTZAR BUY order, update `status = 'market_placed'`
9. On market fill: update `status = 'filled'`
10. Log exchange order to `lth_pvr.exchange_orders` and fill to `lth_pvr.order_fills`

**Note:** The pair `USDTZAR` buy means: spending ZAR, receiving USDT. For subaccount model customers: master key + subaccount header. For API model customers: customer vault key, no header.

---

### EF10 — New: `ef_request_withdrawal`

**Auth:** JWT-enabled (customer session)  
**Triggered by:** Customer submitting the Withdrawals form in customer portal  

**Request body:**
```json
{
  "amount_zar": 5000,
  "withdrawal_type": "normal"  // "normal" or "fast"
}
```

**Process:**
1. Validate the customer's identity via JWT
2. Fetch customer `nav_usd` and withdrawable balance from `lth_pvr.get_withdrawable_balance()`
3. Convert withdrawable to ZAR using live USDTZAR rate from VALR
4. Validate `amount_zar <= withdrawable_zar` — reject if insufficient
5. Calculate fees:
   - Conversion fee: `amount_usdt * 0.0018` (0.18% of USDT being converted)
   - Check withdrawal count this calendar month from `lth_pvr.valr_transfer_log` or `public.withdrawal_requests`; if < 30 free withdrawals used: `withdrawal_fee = R0`, else `R8.50` (normal) or `R30` (fast, non-Standard Bank)
6. Create `public.withdrawal_requests` record with `status = 'pending'`, all fee estimates, `amount_zar`, `estimated_usdt`
7. Send "Withdrawal Request Notification" email to admin (existing template)
8. Return estimated breakdown to customer UI

---

### EF11 — New: `ef_execute_withdrawal`

**Auth:** `--no-verify-jwt` (admin-triggered from Admin UI)  
**Triggered by:** Admin clicking "Execute Withdrawal" in withdrawal management panel

**Request body:** `{ "request_id": "uuid" }`

**Process:**
1. Fetch `withdrawal_requests` record, validate `status = 'pending'`
2. Mark `status = 'processing'`
3. Resolve customer credentials
4. Check customer's USDT balance:
   - If USDT sufficient: call `ef_convert_usdt_to_zar` logic (convert USDT → ZAR)
   - If USDT insufficient: call `ef_convert_btc_to_zar` logic (convert BTC → ZAR first)
5. On conversion complete: execute VALR fiat withdrawal `POST /v1/wallet/fiat/ZAR/withdraw` to customer's linked bank (`exchange_accounts.bank_valr_id`)
6. Update `withdrawal_requests.status = 'completed'`, `completed_at = now()`, `zar_withdrawal_ref`
7. Update `lth_pvr.withdrawal_fee_snapshots` (existing table) with pre-withdrawal HWM snapshot
8. Send "Withdrawal Completed" email to customer (existing template)
9. Send admin confirmation

---

### EF12 — New: `ef_convert_usdt_to_zar`

**Auth:** `--no-verify-jwt` (called internally by `ef_execute_withdrawal`)  
**Process:** Place USDTZAR SELL order (limit → market fallback). Same pattern as `ef_convert_zar_to_usdt` but direction reversed.

---

### EF13 — New: `ef_convert_btc_to_zar`

**Auth:** `--no-verify-jwt` (called internally by `ef_execute_withdrawal` when USDT insufficient)  
**Process:** Place BTCZAR SELL order (limit → market fallback). Two steps: (1) sell BTC to get ZAR, (2) ZAR is then sent to bank via fiat withdrawal.

---

## Phase 5: API Key Monitoring

### EF14 — New: `ef_rotate_api_key_notifications`

**Auth:** `--no-verify-jwt`  
**Schedule:** Daily at 08:00 UTC via `pg_cron` (`0 8 * * *`)

**Process:**
1. Query all `account_model = 'api'` customers where `api_key_expires_at` is not null
2. For each: calculate `days_remaining = api_key_expires_at - CURRENT_DATE`
3. At **30 days**: send "API Key Expiry Warning" email to customer (`triggered_at` recorded to avoid duplicate sends — check against `alert_events` or add a column `last_expiry_warning_sent_at` to `exchange_accounts`)
4. At **10 days**: send "API Key Expiry Warning" email again (urgent variant — same template, different `days_remaining` value)
5. At **5 days**: send "API Key Expiry Warning" email again
6. At **1 day**: send "API Key Expiry Warning" email again
7. At **0 days (expired):**
   - Update `customer_strategies.live_enabled = false` for this customer
   - Log `critical` alert to `lth_pvr.alert_events`
   - Send "API Key Expiry Critical" email

**Deduplication:** Add column `api_key_last_warning_sent_at` and `api_key_warning_days_sent INT[]` to `lth_pvr.exchange_accounts` (via separate small migration or include in Migration 2). Only send if the `days_remaining` threshold has not already been sent for this key generation.

---

## Phase 6: Admin UI Changes

### AU1 — Update: KYC Verification Panel (~line 7717–7890)

**Where:** In the `loadPendingKyc()` render logic and the `verifyKycId()` function.

**Change 1 — Add model selector to KYC table:**
Each customer row gets a dropdown *next to the Verify button*:
```html
<select id="modelSelect_${customer.customer_id}">
  <option value="subaccount" selected>🏦 Subaccount Model</option>
  <option value="api">🔑 API Discretionary Model</option>
</select>
```

**Change 2 — Update `verifyKycId()` function:**
- Read the selected model from the dropdown
- Add the selected model to the confirm dialog text: `"Account model: ${model === 'api' ? 'API Discretionary' : 'Subaccount'}"`
- In the `customer_details` UPDATE: include `account_model: selectedModel`
- If `model === 'api'`: skip `ef_valr_create_subaccount` call; instead show message "API keys required — customer moved to Milestone 4 (VALR Setup)"
- If `model === 'subaccount'`: existing flow unchanged (call `ef_valr_create_subaccount`)

---

### AU2 — Update: VALR Setup Panel (~line 7924–8260)

**Where:** In the `loadSetupCustomers()` and `renderSetupCustomers()` functions, and the `showWalletAddressModal()` function.

**Change 1 — Model-aware column display:**
- Add an "Account Model" badge column: `🏦 Subaccount` or `🔑 API`
- For subaccount customers: existing subaccount ID / wallet columns unchanged
- For API model customers: replace "Subaccount ID" cell with "API Key: ✓ (verified DD-MMM-YYYY, expires DD-MMM-YYYY)" or "⚠ Not configured"

**Change 2 — Model-aware action buttons:**
- If API model + no API key stored: show **"Enter VALR API Keys"** button → calls new `showApiKeyModal()`
- If API model + API key stored but expiring ≤ 30 days: show **"Update API Keys 🔴"** button
- If API model + API key stored and valid: show **"View API Key Status"** button
- If subaccount model: existing buttons unchanged

**Change 3 — New `showApiKeyModal()` function:**
```
Modal content:
─────────────────────────────────────────────────
🔑 Enter VALR API Keys — {First Name} {Last Name}

Step-by-step instructions:
1. Log in to VALR at valr.com
2. Go to Account → API Keys → Create New API Key
3. Enter Key Name: "BitWealth Trade"
4. Select permissions: ☑ View  ☑ Trade  ☑ Withdraw  ☑ Link Bank Account
5. In the Withdraw section, whitelist:
   • BTC: 38ppcqBCz58KENxP9Hi79oCrVFuPTHSdTP
   • USDT (TRON): TSivCwsgBRXBT2A4nF6zRJcMMSX2FeNrfP
6. Set Whitelist IP (optional but recommended): [show BitWealth's Supabase edge function IPs]
7. Save your API Key and Secret (secret shown only once)

─ Fields ─
API Key Name:   [text field]
API Key:        [password field — never shown again after entry]
API Secret:     [password field — never shown again after entry]
Key Expiry:     [date picker — default 365 days from today]

─ Confirmation checkboxes ─
☐ I confirm Trade permission is enabled
☐ I confirm Withdraw permission is enabled  
☐ I confirm View permission is enabled
☐ I confirm BitWealth BTC wallet is whitelisted
☐ I confirm BitWealth USDT (TRON) wallet is whitelisted

[Cancel]  [💾 Save & Validate]
─────────────────────────────────────────────────
```

On "Save & Validate": calls `ef_store_customer_api_keys`. Shows returned balance confirmation in modal. On success: closes modal, refreshes table, shows "✓ API Keys stored and validated."

**Change 4 — Withdrawal and deposit status for API model customers:**
The "Deposit Ref / Wallets" column for API model customers should say: "Customer manages their own VALR account. No deposit reference needed." — this differentiates from the wallet address entry flow.

---

### AU3 — Enhance: Pending ZAR Conversions Card (Administration module)

**Where:** The existing `loadPendingZarConversions()` section and its render loop (~line 9109).

**Change 1 — Add "Convert ZAR → USDT" button per row:**
Visible only when `conversion_status = 'pending'`:
```javascript
<button onclick="window.executeZarConversion('${conv.id}', '${conv.first_names}', '${conv.last_name}')">
  ⚡ Convert ZAR → USDT
</button>
```

**Change 2 — `executeZarConversion()` function:**
- Calls `ef_convert_zar_to_usdt` with `{ conversion_id: id }`
- Shows live status updates: "Placing limit order…" → "Limit order #XYZ live" → "Filled!" or "Timeout — placed market order"
- On completion: refresh the conversions list

**Change 3 — Add model badge to each row:**
Show `🏦` for subaccount model, `🔑` for API model in the customer info section.

**Change 4 — Add `status` indicator:**
Replace the generic "pending" display with the actual `status` field: `pending` / `limit_placed` / `market_placed` / `filled` / `failed`.

---

### AU4 — New: Withdrawal Management Panel (Administration module)

Add a new card in the Administration module: **"Customer Withdrawal Requests"**

Reads from `public.withdrawal_requests WHERE status = 'pending'` joined with `customer_details`.

Per-row display:
- Customer name | Requested ZAR | Estimated USDT | Conversion fee | Withdrawal fee | First Free? | Requested At
- Actions: **"✅ Execute"** → calls `ef_execute_withdrawal` | **"❌ Reject"** → updates status to 'rejected'

---

## Phase 7: Customer Portal Changes

### CP1 — Build: Withdrawals Section (`#withdrawals`)

Add a new `<section id="withdrawals">` block in `website/customer-portal.html` after the Statements section.

**Content:**
```
💸 Withdraw Funds
─────────────────────────────────────────────────
Withdrawable Balance: $X,XXX.XX USDT + 0.XXXXXXXX BTC
(This is your NAV minus accumulated unpaid fees)

Enter withdrawal amount in ZAR:
[Amount: R_____]                     [Recalculate]

Estimated breakdown:
  USDT to convert:           XXX.XX USDT
  VALR conversion fee (0.18%): XX.XX USDT
  VALR withdrawal fee:        R8.50 (or Free / R30 fast)
  You will receive:          ~R X,XXX.XX to your bank account

[⚠ Confirming means you accept BitWealth's withdrawal policy]
☐ I confirm withdrawal from my linked bank account: [masked account number]

[💸  Submit Withdrawal Request]
─────────────────────────────────────────────────
Pending Requests:
[Table of customer's withdrawal_requests for their customer_id]
```

**JavaScript:**
- On amount change: fetch live USDTZAR rate from VALR public endpoint and recalculate estimates
- Call `ef_request_withdrawal` on submit; show success confirmation
- After submission: reload pending requests table

**Withdrawable balance logic:** Use existing `lth_pvr.get_withdrawable_balance(p_customer_id)` RPC — already returns `withdrawable_btc` and `withdrawable_usdt`. Convert to ZAR using live rate.

**UI note:** This section is visible for ALL customers (both models). For API model customers, the "linked bank account" note should say: "Funds will be withdrawn to the bank account linked to your VALR account." For subaccount model: "Funds will be withdrawn to the bank account linked to your VALR subaccount."

---

### CP2 — Build: Settings Section (`#settings`)

Add a new `<section id="settings">` block after the Withdrawals section.

#### CP2-A: API Key Management subsection (API model customers only)

**Show/hide logic:** If `customerData.account_model !== 'api'`: hide this entire subsection.

**Content when key exists:**
```
🔑 VALR API Key

Key Name:    BitWealth Trade
Created:     2026-03-07
Expires:     2027-03-07  (364 days remaining)   ← shown in green/amber/red
Status:      ✅ Verified (last checked 2026-03-07)
Permissions: ✅ View  ✅ Trade  ✅ Withdraw  ✅ Link Bank Account

[🔄 Update API Key]
```

**Expiry warning banner (on Dashboard section):**
If `api_key_expires_at - today ≤ 10 days`: show a red banner at top of the `#dashboard` section:
```html
<div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
  <strong>⚠️ Action Required: Your VALR API key expires in X days!</strong><br>
  Please create a new VALR API key and update it in your 
  <a href="#settings">Settings</a> to avoid trading interruption.
</div>
```

**Content when updating (Update API Key button clicked):**
- Shows same step-by-step instructions as the Admin UI modal (referencing the VALR Create API Key fields from the screenshot)
- Input fields: Key Name, API Key, API Secret, Expiry Date
- "Save & Validate" calls `ef_store_customer_api_keys` with the customer's own JWT
- On success: refreshes key status display

**expiry_at display logic:**
```javascript
const daysRemaining = Math.floor((new Date(keyExpiresAt) - new Date()) / 86400000);
const color = daysRemaining <= 10 ? '#ef4444' : daysRemaining <= 30 ? '#f59e0b' : '#10b981';
```

#### CP2-B: Bank Account subsection (both models)

```
🏦 Linked Bank Account

Bank:           FNB
Account Holder: John Smith
Account Number: ****5678     (masked)
Branch Code:    250655
Account Type:   Current

[📄 Update Bank Account]
```

"Update Bank Account" opens a file upload for a new bank confirmation letter + new account details form. On submit: calls a lightweight endpoint to request the update (admin review required). Shows "⏳ Bank account update request submitted — admin will process within 1 business day."

---

### CP3 — Update: Onboarding Section (`#onboarding`)

For `account_model = 'api'`, update Milestone 4 (VALR Setup) label to **"API Key Setup"** and Milestone 5 (Deposit) label to **"Initial Deposit"**. The milestone count and progress logic remain unchanged.

---

## Phase 8: Email Templates

### New Template 1: `ZAR Deposit Detected - Conversion Required`

**Trigger:** `ef_deposit_scan` when ZAR balance > 0 for any customer (both models)  
**Recipient:** Admin  
**Subject:** `💰 ZAR Deposit Detected — {{first_name}} {{last_name}} (R{{amount}} — Action Required)`

**Body content:**
- Customer name, ID, email
- Amount: R{{amount}} ZAR
- Detected at: {{detected_at}}
- Account model: Subaccount / API
- ZAR balance in account: R{{zar_balance}}
- Current USDT balance: {{usdt_balance}}
- Action required: Log in to Admin UI → Administration → Pending ZAR Conversions → click "Convert ZAR → USDT"
- Direct deep link: `{{admin_url}}#administration` (if feasible)

---

### New Template 2: `API Key Expiry Warning`

**Trigger:** `ef_rotate_api_key_notifications` (30, 10, 5, 1 days before expiry)  
**Recipient:** Customer  
**Subject:** `⚠️ Action Required: Your VALR API Key Expires in {{days_remaining}} Days`

**Body content:**
- Greeting
- Warning: "Your VALR API key '{{api_key_label}}' for your BitWealth trading account will expire on {{expires_at}} ({{days_remaining}} days from now). When it expires, **BitWealth will not be able to execute trades on your behalf** and your automated DCA strategy will be paused."
- Step-by-step instructions with VALR screenshot references:
  1. Log in to VALR at valr.com → Account → API Keys
  2. Click "Create New API Key"
  3. Enter Key Name: "BitWealth Trade" (delete the old one after creating the new one)
  4. Select: ☑ View, ☑ Trade, ☑ Withdraw, ☑ Link Bank Account
  5. In the Withdraw section, whitelist these BitWealth wallet addresses:
     - BTC: `38ppcqBCz58KENxP9Hi79oCrVFuPTHSdTP`
     - USDT (TRON): `TSivCwsgBRXBT2A4nF6zRJcMMSX2FeNrfP`
  6. Save your API Key and Secret (the secret is shown only once — copy it immediately)
  7. Go to your BitWealth Customer Portal → Settings → Update API Key
  8. Enter your new Key Name, API Key, and API Secret → Save
- Do NOT delete your old key until the new one is saved in the portal
- Portal link: {{customer_portal_url}}

---

### New Template 3: `API Key Expiry Critical`

**Trigger:** `ef_rotate_api_key_notifications` when `days_remaining = 0`  
**Recipient:** Customer (and admin BCC)  
**Subject:** `🚨 URGENT: Your VALR API Key Has Expired — Trading Paused`

**Body content:**
- Your key has expired. Trading has been paused.
- Same instructions as Template 2 but urgent tone
- Contact support if assistance needed

---

### Existing Templates (use without modification)

| Template Name | Used for |
|---|---|
| "Withdrawal Request Notification" | Admin notified of customer withdrawal request (existing) |
| "Withdrawal Approved" | Customer notified by admin (existing) |
| "Withdrawal Completed" | Customer notified on fiat withdrawal complete (existing) |
| "Funds Deposited - Admin Notification" | Subaccount model customer activation on first deposit (existing — no change) |

---

## Phase 9: Cron Jobs

| Job Name | Schedule | Purpose |
|---|---|---|
| `ef_rotate_api_key_notifications_daily` | `0 8 * * *` (08:00 UTC) | Warn customers with expiring API keys; suspend trading at expiry |

Add via `pg_cron`:
```sql
SELECT cron.schedule(
  'ef_rotate_api_key_notifications_daily',
  '0 8 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/ef_rotate_api_key_notifications',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer ' || current_setting('app.service_role_key') || '"}'::jsonb,
    body := '{}'::jsonb
  )$$
);
```

---

## Recommended Build Sequence

Build in this order to minimise disruption and allow incremental testing. Each phase is independently deployable.

| # | Phase | Estimated Risk | Dependency |
|---|---|---|---|
| 1 | **Migrations 1–6** | Low — additive only | None |
| 2 | **S1 `_shared/valrCredentials.ts`** | Low — new file only | Migration 1–2 |
| 3 | **S2 `valrClient.ts` refactor** | Medium — core shared lib | S1 |
| 4 | **EF7 `ef_store_customer_api_keys`** | Medium — new function | S1, S2, Migration 2 |
| 5 | **AU1 KYC model selector** (Admin UI) | Low — UI only | Migration 1 |
| 6 | **AU2 VALR Setup API key modal** (Admin UI) | Low — UI only | EF7 |
| 7 | **EF3 `ef_deposit_scan`** update | Medium — existing cron | S1, Migration 1 |
| 8 | **EF4 `ef_sync_valr_transactions`** update | Medium — existing cron | S1, S2 |
| 9 | **EF1 `ef_execute_orders`** update | High — live trading | S1, S2 — test thoroughly |
| 10 | **EF2 `ef_poll_orders` + market fallbacks** | High — live trading | S1, S2 |
| 11 | **S3 `valrTransfer.ts`** + **EF5 ledger** update | High — live fee transfer | S1, Migration 4 |
| 12 | **EF9 `ef_convert_zar_to_usdt`** | Medium — new function | Migration 5, S1 |
| 13 | **AU3 Enhance Pending ZAR Conversions card** | Low — UI only | EF9 |
| 14 | **EF10 `ef_request_withdrawal`** | Medium — new function | Migration 6 |
| 15 | **EF11–13 withdrawal execution chain** | Medium — new functions | EF10 |
| 16 | **AU4 Withdrawal Management Panel** | Low — UI only | EF11 |
| 17 | **CP1 Portal Withdrawals section** | Low — UI, no live trading | EF10 |
| 18 | **CP2 Portal Settings section** | Low — UI | EF7 |
| 19 | **Email Templates 1–3** | Low | None |
| 20 | **EF14 `ef_rotate_api_key_notifications`** + cron | Low | Migration 2, Email Templates |
| 21 | **EF8 `ef_link_bank_account`** | Medium | Migration 3, S1 |
| 22 | **EF6 `ef_auto_convert_btc_to_usdt`** update | Low | S1, S2 |

---

## ef_post_ledger_and_balances & ef_sync_valr_transactions — Detailed Change Summary

*(These were called out as omissions in the initial plan — here is the full analysis.)*

### `ef_post_ledger_and_balances`

**What changes:**
1. **Credential resolution** — Add `resolveCustomerCredentials()` call at the top of the per-customer loop
2. **Fee transfer branching** — After calculating fees, branch on `accountModel`:
   - `'subaccount'`: call existing `transferToMainAccount()` — no change
   - `'api'`: call new `withdrawFeeFromCustomerAccount()` using customer's vault key
3. **Wallet address source** — `withdrawFeeFromCustomerAccount()` reads from `public.wallet_config` to know where to send funds

**What does NOT change:**
- Fill processing and ledger_lines insertion logic (lines 1–2 of the function body) — model-agnostic
- Funding events → ledger_lines processing — model-agnostic
- Balance roll-up logic — model-agnostic

### `ef_sync_valr_transactions`

**What changes:**
1. **Account query** — After fetching strategies and exchange_accounts, add `customer_details.account_model` to the join
2. **Per-account credential resolution** — For each account in the processing loop:
   - If `account_model = 'subaccount'`: call `getTransactionHistory(account.subaccount_id)` with master key (existing)
   - If `account_model = 'api'`: call `getTransactionHistory()` with vault-decrypted customer credentials + no subaccount_id
3. **Undetected withdrawal alert** — After classifying a BLOCKCHAIN_SEND or FIAT_WITHDRAWAL transaction: check if there is a corresponding `withdrawal_requests` record with `status IN ('processing','completed')`. If not found for an API model customer: log alert + notify admin via email.

**What does NOT change:**
- Transaction type classification logic — model-agnostic
- `exchange_funding_events` insertion logic — model-agnostic
- ZAR→USDT conversion detection and `pending_zar_conversions` insertion — already model-agnostic (enhanced by Migration 5)

---

## Bank Account Linking — Design Notes

### Subaccount Model

VALR allows linking a bank account to a subaccount using the **master API key** with the `X-VALR-SUB-ACCOUNT-ID` header, provided the master key has the "Link Bank Account" permission. This is the approach used for subaccount model customers.

> **Uncertainty:** VALR's official docs indicate "Link Bank Account" permission allows programmatic bank account linking. However, it is unclear whether this applies to subaccount impersonation. If the VALR API returns an error (e.g., 401 or "subaccounts cannot link bank accounts"), the fallback is: admin manually links the bank account via the VALR portal UI for the subaccount, then manually enters the bank account details into `exchange_accounts` via the Admin UI.

The `ef_link_bank_account` edge function must handle this gracefully — on failure, store the bank details anyway and log a `warn` alert instructing admin to link manually.

### API Model

For API model customers, VALR bank account linking is straightforward: the customer's own API key (with "Link Bank Account" permission) calls `POST /v1/bankaccounts/ZAR`. BitWealth stores the returned VALR bank account ID.

### Bank Account Confirmation Letter Processing

Bank details (account number, bank name, branch code) must be extracted from the uploaded bank confirmation letter PDF. This is currently a **manual process**:
1. Admin receives "KYC Documents Uploaded - Admin Notification" email
2. Admin downloads the bank confirmation letter from the KYC verification panel
3. Admin reads the account details and enters them into the "Link Bank Account" form in the Admin UI (part of AU2/AU4)
4. Admin clicks "Link Bank Account" → triggers `ef_link_bank_account`

Future enhancement: Use OCR/AI to auto-extract bank details from the PDF.

### Future Customer Bank Account Change

When a customer wants to update their bank account:
1. Customer uploads new bank confirmation letter via Settings section → `ef_upload_kyc_documents` style endpoint OR a dedicated small endpoint
2. Admin is notified by email
3. Admin reviews letter, extracts details, enters into Admin UI
4. Admin triggers `ef_link_bank_account` with new bank details
5. VALR links the new bank account (old one may need to be unlinked first — check VALR API for an unlink endpoint)

---

## Security Architecture for API Key Storage

### Vault Storage Pattern

```
Customer provides API Key + Secret
          ↓
ef_store_customer_api_keys (service role)
          ↓
INSERT INTO vault.secrets (secret = api_key, name = 'customer_42_valr_key')
INSERT INTO vault.secrets (secret = api_secret, name = 'customer_42_valr_secret')
          ↓
Store returned vault_ids in lth_pvr.exchange_accounts
(api_key_vault_id, api_secret_vault_id)
          ↓
Keys are encrypted at rest (AES-256-GCM via pgsodium)
```

### Key Retrieval Pattern (edge functions only)

```
resolveCustomerCredentials(customerId, sb)
          ↓
lth_pvr.get_customer_valr_credentials(customer_id)  [SECURITY DEFINER]
          ↓
SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = vault_id
          ↓
Returns plaintext key/secret — in memory only, never logged
          ↓
Passed to valrClient functions — used for HMAC signing, never stored back
```

### Security Controls

| Control | Implementation |
|---|---|
| Encryption at rest | `vault.secrets` (pgsodium AES-256-GCM) |
| Transport encryption | HTTPS only (Supabase enforced) |
| Key never displayed | After entry, admin/customer UI shows "✓ Key stored (name: X, verified: Y)" only |
| Access restricted | Only service-role edge functions can call `lth_pvr.get_customer_valr_credentials()` |
| Permission scope | VALR keys must be trade-only (+ Withdraw for fee collection); no keys stored for other exchanges |
| Audit trail | Every vault retrieval is through the SECURITY DEFINER function; every fee transfer logged to `valr_transfer_log` |
| Key rotation | Policy-based expiry stored in `api_key_expires_at`; `ef_rotate_api_key_notifications` enforces rotation |
| Whitelist IP (optional) | VALR allows IP whitelisting on API keys. Supabase edge function egress IPs can be found in Supabase dashboard → Settings → Infrastructure. Recommend configuring this for production. |
| Withdrawal whitelist | VALR Withdraw permission with address whitelisting: customer whitelists ONLY BitWealth's two static addresses. Even if the key is stolen, funds can only go to BitWealth's wallets. |

---

## Open Questions / Decisions Deferred

| # | Question | Decision Needed |
|---|---|---|
| OQ1 | VALR bank account linking for subaccounts — does the API support it? | Test manually; fallback is admin portal link. |
| OQ2 | Supabase edge function egress IPs for VALR key whitelisting | Check Supabase dashboard → note IPs for customer instructions |
| OQ3 | Should `ef_store_customer_api_keys` also validate permission scopes via `GET /v1/account/api-keys`? VALR may not return permission details this way. | Test the VALR endpoint; if not available, rely on customer confirmation checkboxes |
| OQ4 | ZAR fast withdrawal to Standard Bank is free; to other banks is R30. How should the portal calculate this if we don't know the customer's bank at request time? | Store `bank_name` in `exchange_accounts` (Migration 3); use it to determine fee |
| OQ5 | How should the Onboarding milestone 4 label change for API model customers in the customer portal? | Agreed: Milestone 4 = "API Key Setup", Milestone 5 = "Initial Deposit" |

---

## Testing Checklist

After building, test in this sequence:

| # | Test | Expected Result |
|---|---|---|
| T1 | Create new prospect and set `account_model = 'api'` at KYC verify | Status → setup, no subaccount created, API key modal appears in VALR Setup |
| T2 | Enter valid VALR API key in Admin UI modal | Keys stored in vault, status → deposit, balance returned |
| T3 | Enter invalid VALR API key | Error: "API key/secret is invalid" |
| T4 | Run `ef_deposit_scan` with API model customer in deposit status + ZAR balance > 0 | ZAR written to pending_zar_conversions, admin email sent |
| T5 | Click "Convert ZAR → USDT" for a pending conversion | Limit USDTZAR buy placed, status updates, eventually filled |
| T6 | Run `ef_execute_orders` with API model customer in active status | Order placed using customer vault key, no subaccount header |
| T7 | Run `ef_post_ledger_and_balances` for API model customer | Fee withdrawn using customer key to BitWealth's static wallet |
| T8 | Customer submits withdrawal request in portal | withdrawal_requests created, admin email sent, pending request shows for admin |
| T9 | Admin executes withdrawal | USDT→ZAR conversion placed, then fiat withdrawal sent to bank |
| T10 | Set `api_key_expires_at = now() + 8 days` and run `ef_rotate_api_key_notifications` | Warning email sent to customer, `live_enabled` not yet disabled |
| T11 | Set `api_key_expires_at = now() - 1 day` and run `ef_rotate_api_key_notifications` | `live_enabled = false`, critical email sent, alert logged |
| T12 | Customer updates API key in portal Settings | Old vault secrets removed, new ones stored, `api_key_expires_at` reset |
| T13 | Subaccount model customer runs through full existing flow | No regression — existing behaviour unchanged |
| T14 | Run `ef_sync_valr_transactions` for API model customer | Transaction history synced using customer vault key |
