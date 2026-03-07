# API Discretionary Model — Complete Test Case Document
**Project:** BitWealth LTH PVR — Dual-Model Build  
**Version:** 1.0  
**Date:** 2026-03-07  
**Covers:** Phases 0–9 (Migrations, Edge Functions, Admin UI, Customer Portal, Email Templates, Cron Jobs)

---

## Test Case Format

| Field | Description |
|---|---|
| **ID** | Unique test identifier (Phase-Sequence) |
| **Description** | What is being tested |
| **Preconditions** | Required state before the test |
| **Steps** | How to execute the test |
| **Expected Result** | What success looks like |
| **Actual Result** | To be filled in during testing |
| **Status** | PASS / FAIL / SKIP / BLOCKED |
| **Notes** | Observations or workarounds |

---

## Phase 0 — Database Migrations (Migrations 1–8)

### TC-0-01: Migration 1 — account_model Column

| | |
|---|---|
| **ID** | TC-0-01 |
| **Description** | Verify `account_model` column exists on `public.customer_details` |
| **Steps** | Run: `SELECT account_model FROM public.customer_details LIMIT 1;` |
| **Expected Result** | Query succeeds; column exists with values `'subaccount'` or `null` |
| **Actual Result** | |
| **Status** | |

---

### TC-0-02: Migration 2 — API Key Vault Columns

| | |
|---|---|
| **ID** | TC-0-02 |
| **Description** | Verify vault and API key columns exist on `public.exchange_accounts` |
| **Steps** | Run: `SELECT api_key_vault_id, api_secret_vault_id, api_key_label, api_key_expires_at, api_key_verified_at, api_key_has_trade, api_key_has_withdraw FROM public.exchange_accounts LIMIT 1;` |
| **Expected Result** | Query succeeds; all columns exist |
| **Actual Result** | |
| **Status** | |

---

### TC-0-03: Migration 3 — Bank Account Columns

| | |
|---|---|
| **ID** | TC-0-03 |
| **Description** | Verify bank account columns exist on `public.exchange_accounts` |
| **Steps** | Run: `SELECT bank_name, bank_account_number, bank_branch_code, bank_account_type, bank_holder_name, bank_valr_id, bank_verified_at FROM public.exchange_accounts LIMIT 1;` |
| **Expected Result** | Query succeeds; all columns exist |
| **Actual Result** | |
| **Status** | |

---

### TC-0-04: Migration 4 — VALR Transfer Log Table

| | |
|---|---|
| **ID** | TC-0-04 |
| **Description** | Verify `lth_pvr.valr_transfer_log` table exists |
| **Steps** | Run: `SELECT COUNT(*) FROM lth_pvr.valr_transfer_log;` |
| **Expected Result** | Query returns 0 (or a number); table exists |
| **Actual Result** | |
| **Status** | |

---

### TC-0-05: Migration 5 — Pending ZAR Conversions Table

| | |
|---|---|
| **ID** | TC-0-05 |
| **Description** | Verify `lth_pvr.pending_zar_conversions` table exists |
| **Steps** | Run: `SELECT * FROM lth_pvr.pending_zar_conversions LIMIT 1;` |
| **Expected Result** | Query succeeds; table exists with required columns |
| **Actual Result** | |
| **Status** | |

---

### TC-0-06: Migration 6 — Withdrawal Requests Table (lth_pvr)

| | |
|---|---|
| **ID** | TC-0-06 |
| **Description** | Verify `lth_pvr.withdrawal_requests` table exists with all required columns |
| **Steps** | Run: `SELECT withdrawal_id, customer_id, currency, gross_amount, net_amount, interim_fee_usdt, status, requested_at, completed_at, error_message, valr_response, withdrawal_address FROM lth_pvr.withdrawal_requests LIMIT 1;` |
| **Expected Result** | Query succeeds; all columns exist |
| **Actual Result** | |
| **Status** | |

---

### TC-0-07: Migration 7 — withdrawal_requests Moved to lth_pvr

| | |
|---|---|
| **ID** | TC-0-07 |
| **Description** | Confirm `public.withdrawal_requests` no longer exists |
| **Steps** | Run: `SELECT COUNT(*) FROM public.withdrawal_requests;` |
| **Expected Result** | Error: relation `public.withdrawal_requests` does not exist |
| **Actual Result** | |
| **Status** | |

---

### TC-0-08: Migration 8 — API Key Warning Tracking Columns

| | |
|---|---|
| **ID** | TC-0-08 |
| **Description** | Verify warning tracking columns exist on `public.exchange_accounts` |
| **Steps** | Run: `SELECT api_key_last_warning_sent_at, api_key_warning_days_sent FROM public.exchange_accounts LIMIT 1;` |
| **Expected Result** | Query succeeds; `api_key_warning_days_sent` defaults to `'{}'` |
| **Actual Result** | |
| **Status** | |

---

### TC-0-09: get_customer_valr_credentials RPC

| | |
|---|---|
| **ID** | TC-0-09 |
| **Description** | Verify SECURITY DEFINER function exists for vault key retrieval |
| **Steps** | Run: `SELECT lth_pvr.get_customer_valr_credentials(1);` (use a valid customer_id with API keys) |
| **Expected Result** | Returns decrypted api_key and api_secret for that customer |
| **Actual Result** | |
| **Status** | |

---

## Phase 1 — Shared Modules (S1–S3)

### TC-1-01: valrCredentials.ts — Subaccount Mode

| | |
|---|---|
| **ID** | TC-1-01 |
| **Description** | resolveCustomerCredentials returns master key + subaccount_id for subaccount model customer |
| **Preconditions** | A customer exists with `account_model = 'subaccount'` and a valid subaccount_id |
| **Steps** | Deploy any edge function that calls `resolveCustomerCredentials()`, invoke it, check logs |
| **Expected Result** | Returns `{ apiKey: MASTER_KEY, apiSecret: MASTER_SECRET, subaccountId: '...', accountModel: 'subaccount' }` |
| **Actual Result** | |
| **Status** | |

---

### TC-1-02: valrCredentials.ts — API Model Mode

| | |
|---|---|
| **ID** | TC-1-02 |
| **Description** | resolveCustomerCredentials returns customer vault keys for API model customer |
| **Preconditions** | A customer exists with `account_model = 'api'` and vault keys stored |
| **Steps** | Call edge function that invokes `resolveCustomerCredentials()` for the API model customer |
| **Expected Result** | Returns `{ apiKey: CUSTOMER_KEY, apiSecret: CUSTOMER_SECRET, subaccountId: null, accountModel: 'api' }` |
| **Actual Result** | |
| **Status** | |

---

### TC-1-03: valrCredentials.ts — Missing Vault Keys

| | |
|---|---|
| **ID** | TC-1-03 |
| **Description** | resolveCustomerCredentials throws for API model customer with no vault keys |
| **Preconditions** | A customer with `account_model = 'api'` but no `api_key_vault_id` |
| **Steps** | Call an edge function for that customer |
| **Expected Result** | Error logged and alert logged: "No API keys configured for this customer" |
| **Actual Result** | |
| **Status** | |

---

### TC-1-04: valrClient.ts — HMAC Signing with Customer Key

| | |
|---|---|
| **ID** | TC-1-04 |
| **Description** | VALR API call uses customer key (no subaccount header) for API model |
| **Preconditions** | API model customer with valid VALR API key stored in vault |
| **Steps** | Trigger an edge function that calls VALR (e.g., balance check) for the API model customer; inspect VALR audit logs or compare balance responses |
| **Expected Result** | Request is signed with customer vault key; no `X-VALR-SUB-ACCOUNT-ID` header sent |
| **Actual Result** | |
| **Status** | |

---

### TC-1-05: valrTransfer.ts — withdrawFeeFromCustomerAccount

| | |
|---|---|
| **ID** | TC-1-05 |
| **Description** | Fee withdrawal calls VALR crypto withdrawal endpoint using customer key |
| **Preconditions** | API model customer with USDT balance ≥ fee amount; vault keys configured |
| **Steps** | Set a small fee amount and call `withdrawFeeFromCustomerAccount()` |
| **Expected Result** | VALR withdrawal is initiated to BitWealth's USDT wallet; `valr_transfer_log` record created |
| **Actual Result** | |
| **Status** | |

---

## Phase 2 — Edge Function Updates (EF1–EF6)

### TC-2-01: ef_execute_orders — API Model Customer

| | |
|---|---|
| **ID** | TC-2-01 (T6) |
| **Description** | Order placed using customer vault key for API model customer in active status |
| **Preconditions** | API model customer is active with USDT balance, trade decision exists for today |
| **Steps** | Trigger `ef_execute_orders` (or wait for 03:15 UTC pipeline); monitor VALR account for the order |
| **Expected Result** | LIMIT order placed in VALR using customer API key; `lth_pvr.exchange_orders` record created; no `X-VALR-SUB-ACCOUNT-ID` header |
| **Actual Result** | |
| **Status** | |

---

### TC-2-02: ef_execute_orders — No Regression (Subaccount)

| | |
|---|---|
| **ID** | TC-2-02 (T13) |
| **Description** | Subaccount model customer still uses master key + subaccount routing |
| **Preconditions** | Subaccount model customer is active |
| **Steps** | Trigger `ef_execute_orders`; verify VALR subaccount receives the order |
| **Expected Result** | Order placed using master key with `X-VALR-SUB-ACCOUNT-ID` header; same behavior as before Phase 2 changes |
| **Actual Result** | |
| **Status** | |

---

### TC-2-03: ef_deposit_scan — API Model ZAR Detection (T4)

| | |
|---|---|
| **ID** | TC-2-03 |
| **Description** | ZAR balance detected for API model customer creates pending_zar_conversions record and sends admin email |
| **Preconditions** | API model customer in `deposit` status has ZAR balance > 0 on VALR |
| **Steps** | Trigger `ef_deposit_scan`; check `lth_pvr.pending_zar_conversions`; check admin email inbox |
| **Expected Result** | Record created in `pending_zar_conversions`; admin email `getZarDepositDetectedAdminEmail` sent |
| **Actual Result** | |
| **Status** | |

---

### TC-2-04: ef_sync_valr_transactions — API Model (T14)

| | |
|---|---|
| **ID** | TC-2-04 |
| **Description** | Transaction history synced using customer vault key (not master key + subaccount) |
| **Preconditions** | API model customer with transaction history on VALR |
| **Steps** | Trigger `ef_sync_valr_transactions`; check `lth_pvr.exchange_funding_events` table |
| **Expected Result** | Transactions fetched using customer key; new funding events created where applicable |
| **Actual Result** | |
| **Status** | |

---

### TC-2-05: ef_post_ledger_and_balances — API Model Fee Withdrawal (T7)

| | |
|---|---|
| **ID** | TC-2-05 |
| **Description** | Performance fee withdrawn from customer VALR account to BitWealth wallet |
| **Preconditions** | API model customer has performance fee owing; vault keys configured |
| **Steps** | Trigger `ef_post_ledger_and_balances`; monitor VALR for withdrawal; check `valr_transfer_log` |
| **Expected Result** | Fee withdrawn using customer's vault key; transfer logged in `lth_pvr.valr_transfer_log`; ledger_lines updated |
| **Actual Result** | |
| **Status** | |

---

### TC-2-06: ef_auto_convert_btc_to_usdt — API Model

| | |
|---|---|
| **ID** | TC-2-06 |
| **Description** | BTC conversion uses customer key for API model customers |
| **Steps** | Trigger `ef_auto_convert_btc_to_usdt`; check VALR BTC sell order for API model customer |
| **Expected Result** | Sell order placed using customer vault key |
| **Actual Result** | |
| **Status** | |

---

## Phase 3 — New Edge Functions (EF7–EF8)

### TC-3-01: ef_store_customer_api_keys — Valid Key (T2)

| | |
|---|---|
| **ID** | TC-3-01 |
| **Description** | Valid VALR API key is stored in vault and verified |
| **Preconditions** | Customer exists with `account_model = 'api'`; valid VALR API key available |
| **Steps** | Call `ef_store_customer_api_keys` with valid key/secret |
| **Expected Result** | Keys stored in `vault.secrets`; vault IDs written to `exchange_accounts`; `api_key_verified_at` set; `api_key_has_trade = true` |
| **Actual Result** | |
| **Status** | |

---

### TC-3-02: ef_store_customer_api_keys — Invalid Key (T3)

| | |
|---|---|
| **ID** | TC-3-02 |
| **Description** | Invalid VALR API key returns error and does not persist |
| **Steps** | Call `ef_store_customer_api_keys` with an incorrect key/secret |
| **Expected Result** | Response: `{ error: "API key/secret is invalid" }`; no vault entry created |
| **Actual Result** | |
| **Status** | |

---

### TC-3-03: ef_store_customer_api_keys — Overwrite Existing (T12)

| | |
|---|---|
| **ID** | TC-3-03 |
| **Description** | Saving a new key removes old vault secrets and stores new ones |
| **Preconditions** | Customer already has vault IDs on `exchange_accounts` |
| **Steps** | Call `ef_store_customer_api_keys` with new valid key |
| **Expected Result** | Old vault secrets deleted; new secrets inserted; `api_key_vault_id` and `api_secret_vault_id` updated; `api_key_warning_days_sent` reset to `{}` |
| **Actual Result** | |
| **Status** | |

---

### TC-3-04: ef_link_bank_account — Subaccount Model

| | |
|---|---|
| **ID** | TC-3-04 |
| **Description** | Bank account linked to VALR subaccount using master key + subaccount header |
| **Steps** | Submit bank details via Admin UI for a subaccount model customer |
| **Expected Result** | VALR bank link API called with `X-VALR-SUB-ACCOUNT-ID`; bank details stored in `exchange_accounts`; success (or graceful failure with manual alert) |
| **Actual Result** | |
| **Status** | |

---

### TC-3-05: ef_link_bank_account — API Model

| | |
|---|---|
| **ID** | TC-3-05 |
| **Description** | Bank account linked using customer's own API key |
| **Steps** | Submit bank details for API model customer |
| **Expected Result** | VALR bank link API called using customer vault key; bank details stored |
| **Actual Result** | |
| **Status** | |

---

## Phase 4 — Withdrawal Edge Functions (EF9–EF13)

### TC-4-01: ef_convert_zar_to_usdt — Success (T5)

| | |
|---|---|
| **ID** | TC-4-01 |
| **Description** | ZAR→USDT limit order placed; pending conversion record updated |
| **Preconditions** | Record exists in `lth_pvr.pending_zar_conversions` with status `pending` |
| **Steps** | Click "⚡ Convert ZAR→USDT" button in Admin UI → Pending ZAR Conversions panel |
| **Expected Result** | LIMIT buy order for USDTZAR placed on VALR; `pending_zar_conversions.status` updated to `processing`; order ID recorded |
| **Actual Result** | |
| **Status** | |

---

### TC-4-02: ef_request_withdrawal — ZAR Path (T8-ZAR)

| | |
|---|---|
| **ID** | TC-4-02 |
| **Description** | ZAR withdrawal: interim fee deducted, USDT→ZAR conversion initiated, bank withdrawal triggered |
| **Preconditions** | Customer has USDT balance; bank account linked; withdrawal amount ≤ withdrawable balance |
| **Steps** | Submit ZAR withdrawal in Customer Portal; monitor VALR and email inbox |
| **Expected Result** | `withdrawal_requests` record created (`processing`); interim fee ledger line written; VALR withdrawal submitted; `getWithdrawalSubmittedEmail` sent to customer |
| **Actual Result** | |
| **Status** | |

---

### TC-4-03: ef_request_withdrawal — BTC Path (T8-BTC)

| | |
|---|---|
| **ID** | TC-4-03 |
| **Description** | BTC withdrawal to external address |
| **Preconditions** | Customer has BTC balance; valid BTC address (for API model: whitelisted on VALR key) |
| **Steps** | Submit BTC withdrawal in portal |
| **Expected Result** | VALR crypto withdrawal submitted for BTC amount; confirmation email sent |
| **Actual Result** | |
| **Status** | |

---

### TC-4-04: ef_request_withdrawal — USDT Path (T8-USDT)

| | |
|---|---|
| **ID** | TC-4-04 |
| **Description** | USDT withdrawal to TRC-20 address |
| **Preconditions** | Customer has USDT balance; valid TRC-20 address |
| **Steps** | Submit USDT withdrawal in portal |
| **Expected Result** | VALR USDT TRC-20 withdrawal submitted; confirmation email sent |
| **Actual Result** | |
| **Status** | |

---

### TC-4-05: ef_request_withdrawal — Interim Performance Fee (T8-FEE)

| | |
|---|---|
| **ID** | TC-4-05 |
| **Description** | Mid-month withdrawal deducts accrued performance fee and updates HWM atomically |
| **Preconditions** | Customer has unrealised profit > previous HWM |
| **Steps** | Submit any withdrawal type |
| **Expected Result** | Interim fee calculated; deducted from net amount; HWM updated in same transaction; `withdrawal_fee_snapshots` record created; net amount reflects fee deduction |
| **Actual Result** | |
| **Status** | |

---

### TC-4-06: ef_request_withdrawal — Zero Fee Case (T9)

| | |
|---|---|
| **ID** | TC-4-06 |
| **Description** | Customer with no accrued performance fee pays no interim fee |
| **Preconditions** | Customer's current NAV ≤ HWM (no profit above watermark) |
| **Steps** | Submit any withdrawal |
| **Expected Result** | `interim_fee_usdt = 0`; full net amount processed with no fee deduction |
| **Actual Result** | |
| **Status** | |

---

### TC-4-07: ef_request_withdrawal — No Bank Account (T9-NOBANK)

| | |
|---|---|
| **ID** | TC-4-07 |
| **Description** | ZAR withdrawal rejected when no bank account is linked |
| **Preconditions** | Customer has no `bank_name` in `exchange_accounts` |
| **Steps** | Attempt ZAR withdrawal in portal |
| **Expected Result** | Error: "No linked bank account — please contact support"; no `withdrawal_requests` record created |
| **Actual Result** | |
| **Status** | |

---

### TC-4-08: ef_revert_withdrawal — Cancel Before Processing (T8-CANCEL)

| | |
|---|---|
| **ID** | TC-4-08 |
| **Description** | Pending withdrawal cancelled; HWM reverted; no VALR call made |
| **Preconditions** | `withdrawal_requests` record with `status = 'pending'` |
| **Steps** | Click "Cancel" button in Withdrawal History or call `ef_revert_withdrawal` |
| **Expected Result** | Status → `cancelled`; HWM restored; interim fee ledger line reversed; `getWithdrawalCancelledEmail` sent |
| **Actual Result** | |
| **Status** | |

---

### TC-4-09: ef_request_withdrawal — VALR Error → Failed Status

| | |
|---|---|
| **ID** | TC-4-09 |
| **Description** | VALR API error marks withdrawal as failed and notifies admin |
| **Preconditions** | Force a VALR error (e.g., insufficient balance, invalid address) |
| **Steps** | Submit a withdrawal that will fail on VALR |
| **Expected Result** | `withdrawal_requests.status = 'failed'`; `error_message` populated; `getWithdrawalFailedAdminEmail` sent to admin; `getWithdrawalOutcomeEmail` (failed variant) sent to customer |
| **Actual Result** | |
| **Status** | |

---

### TC-4-10: ef_convert_usdt_to_zar — Internal Conversion

| | |
|---|---|
| **ID** | TC-4-10 |
| **Description** | USDT→ZAR conversion places limit sell order on VALR (called by ef_request_withdrawal ZAR path) |
| **Steps** | Trigger ZAR withdrawal (TC-4-02) and trace the internal call to `ef_convert_usdt_to_zar` |
| **Expected Result** | USDTZAR limit sell order placed; conversion tracked |
| **Actual Result** | |
| **Status** | |

---

### TC-4-11: ef_convert_btc_to_zar — Internal Conversion

| | |
|---|---|
| **ID** | TC-4-11 |
| **Description** | BTC→ZAR path converts BTC first before fiat withdrawal (if applicable) |
| **Steps** | Trigger a withdrawal that requires BTC→ZAR conversion |
| **Expected Result** | BTC limit sell order placed before fiat withdrawal submitted |
| **Actual Result** | |
| **Status** | |

---

## Phase 5 — API Key Notifications (EF14)

### TC-5-01: ef_rotate_api_key_notifications — 30-Day Warning (T10)

| | |
|---|---|
| **ID** | TC-5-01 |
| **Description** | Warning email sent 30 days before expiry |
| **Preconditions** | Set `api_key_expires_at = NOW() + INTERVAL '30 days'` for an API model customer; clear `api_key_warning_days_sent` |
| **Steps** | Call `POST /functions/v1/ef_rotate_api_key_notifications` |
| **Expected Result** | `getApiKeyExpiryWarningEmail` sent to customer; `api_key_warning_days_sent` = `{30}`; `live_enabled` NOT changed |
| **Actual Result** | |
| **Status** | |

---

### TC-5-02: ef_rotate_api_key_notifications — No Duplicate Emails

| | |
|---|---|
| **ID** | TC-5-02 |
| **Description** | Warning email not sent again for same threshold day |
| **Preconditions** | `api_key_warning_days_sent` already contains `{30}` |
| **Steps** | Call edge function again with same `api_key_expires_at` |
| **Expected Result** | No email sent; `api_key_warning_days_sent` unchanged |
| **Actual Result** | |
| **Status** | |

---

### TC-5-03: ef_rotate_api_key_notifications — Key Expired (T11)

| | |
|---|---|
| **ID** | TC-5-03 |
| **Description** | Expired key pauses trading and sends critical email |
| **Preconditions** | Set `api_key_expires_at = NOW() - INTERVAL '1 day'` |
| **Steps** | Call edge function |
| **Expected Result** | `customer_strategies.live_enabled = false`; `getApiKeyExpiryCriticalEmail` sent; alert logged in `lth_pvr.alert_events` |
| **Actual Result** | |
| **Status** | |

---

### TC-5-04: ef_rotate_api_key_notifications — 10-Day Urgent Warning

| | |
|---|---|
| **ID** | TC-5-04 |
| **Description** | 10-day warning email uses red/urgent styling |
| **Preconditions** | Set `api_key_expires_at = NOW() + INTERVAL '10 days'`; clear `api_key_warning_days_sent` |
| **Steps** | Call edge function |
| **Expected Result** | Warning email sent with red colour theme (`urgencyColor = '#dc3545'`); `api_key_warning_days_sent = {10}` |
| **Actual Result** | |
| **Status** | |

---

### TC-5-05: ef_rotate_api_key_notifications — Subaccount Customers Skipped

| | |
|---|---|
| **ID** | TC-5-05 |
| **Description** | Function does nothing for subaccount model customers |
| **Preconditions** | Subaccount customer exists |
| **Steps** | Call edge function; verify no emails sent to subaccount customers |
| **Expected Result** | Function only processes `account_model = 'api'` customers |
| **Actual Result** | |
| **Status** | |

---

### TC-5-06: Cron Job Registered

| | |
|---|---|
| **ID** | TC-5-06 |
| **Description** | Cron job `ef_rotate_api_key_notifications_daily` is registered at 08:00 UTC |
| **Steps** | Run: `SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'ef_rotate_api_key_notifications_daily';` |
| **Expected Result** | Row returned with `schedule = '0 8 * * *'` |
| **Actual Result** | |
| **Status** | |

---

## Phase 6 — Admin UI Changes (AU1–AU4)

### TC-6-01: AU1 — KYC Verify Creates API Model Customer (T1)

| | |
|---|---|
| **ID** | TC-6-01 |
| **Description** | KYC verify with API model selected: no subaccount created, status → setup |
| **Preconditions** | Prospect exists with status `kyc_submitted` |
| **Steps** | In Admin UI → KYC Verification, select "🔑 API Model" from dropdown, click Verify |
| **Expected Result** | `customer_details.account_model = 'api'`; status → `setup`; `ef_valr_create_subaccount` NOT called; toast: "API key required — see VALR Setup below" |
| **Actual Result** | |
| **Status** | |

---

### TC-6-02: AU1 — KYC Verify Creates Subaccount Model Customer

| | |
|---|---|
| **ID** | TC-6-02 |
| **Description** | KYC verify with Subaccount model selected creates VALR subaccount |
| **Steps** | Select "🏦 Subaccount" from dropdown, click Verify |
| **Expected Result** | `account_model = 'subaccount'`; `ef_valr_create_subaccount` called; subaccount_id populated |
| **Actual Result** | |
| **Status** | |

---

### TC-6-03: AU2 — VALR Setup Shows Model Badges

| | |
|---|---|
| **ID** | TC-6-03 |
| **Description** | Setup panel displays 🏦/🔑 per customer row |
| **Steps** | Refresh Admin UI → VALR Setup section |
| **Expected Result** | Each customer row shows model badge; API model shows API key status (⚠️ Not configured or ✓ Label + days remaining) |
| **Actual Result** | |
| **Status** | |

---

### TC-6-04: AU2 — Create API Keys via Modal

| | |
|---|---|
| **ID** | TC-6-04 |
| **Description** | Admin can enter and save VALR API keys for API model customer |
| **Steps** | Click "🔑 Manage API Keys" for an API model customer; fill in key/secret/expiry; click Save |
| **Expected Result** | `ef_store_customer_api_keys` called; success message shown; row updated to show ✓ verified |
| **Actual Result** | |
| **Status** | |

---

### TC-6-05: AU3 — Convert ZAR→USDT Button

| | |
|---|---|
| **ID** | TC-6-05 |
| **Description** | Convert button triggers ef_convert_zar_to_usdt and updates status |
| **Preconditions** | Pending conversion record exists |
| **Steps** | Click "⚡ Convert ZAR→USDT" in Pending ZAR Conversions card |
| **Expected Result** | Button shows loading state; VALR order placed; record status → `processing`; table refreshes |
| **Actual Result** | |
| **Status** | |

---

### TC-6-06: AU4 — Withdrawal History Loads Without Error

| | |
|---|---|
| **ID** | TC-6-06 |
| **Description** | Admin Withdrawal History panel renders without PGRST200 schema error |
| **Steps** | Open Admin UI → Administration module; observe Withdrawal History panel |
| **Expected Result** | Table renders; no browser console 400/500 errors; cross-schema join handled via two-step JS fetch |
| **Actual Result** | |
| **Status** | |

---

### TC-6-07: AU4 — View Details Modal

| | |
|---|---|
| **ID** | TC-6-07 |
| **Description** | View Details shows full withdrawal record including VALR response JSON |
| **Preconditions** | At least one withdrawal record exists |
| **Steps** | Click "View" button on any row |
| **Expected Result** | Modal shows all fields; `valr_response` JSON displayed correctly |
| **Actual Result** | |
| **Status** | |

---

### TC-6-08: AU4 — SLA Amber Highlight

| | |
|---|---|
| **ID** | TC-6-08 |
| **Description** | Processing rows > 30 minutes old are highlighted amber |
| **Preconditions** | Create a withdrawal with `status = 'processing'` and `requested_at` > 30 min ago |
| **Steps** | Open Admin UI Withdrawal History |
| **Expected Result** | That row has amber background (`rgba(245,158,11,0.1)`) |
| **Actual Result** | |
| **Status** | |

---

## Phase 7 — Customer Portal (CP1–CP3)

### TC-7-01: CP3 — Onboarding Milestone Labels for API Model

| | |
|---|---|
| **ID** | TC-7-01 |
| **Description** | Milestones 4 and 5 display "API Key Setup" / "Initial Deposit" for API model customers |
| **Preconditions** | Customer has `account_model = 'api'` |
| **Steps** | Log in to Customer Portal as API model customer; navigate to Onboarding section |
| **Expected Result** | Milestone 4 label = "API Key Setup"; Milestone 5 label = "Initial Deposit" |
| **Actual Result** | |
| **Status** | |

---

### TC-7-02: CP3 — Onboarding Labels for Subaccount Model

| | |
|---|---|
| **ID** | TC-7-02 |
| **Description** | Milestones display "VALR Setup" / "Deposit" for subaccount model (no change) |
| **Preconditions** | Customer has `account_model = 'subaccount'` |
| **Steps** | Log in as subaccount model customer; check Onboarding section |
| **Expected Result** | Milestone 4 label = "VALR Setup"; Milestone 5 label = "Deposit" |
| **Actual Result** | |
| **Status** | |

---

### TC-7-03: CP1 — Withdrawable Balance Displays

| | |
|---|---|
| **ID** | TC-7-03 |
| **Description** | Withdrawals section shows accurate BTC, USDT, and ZAR equivalent balances |
| **Steps** | Log in as active customer; navigate to Withdrawals |
| **Expected Result** | `wdBtcBalance` and `wdUsdtBalance` match `lth_pvr.get_withdrawable_balance()` output; ZAR equiv uses live USDTZAR rate |
| **Actual Result** | |
| **Status** | |

---

### TC-7-04: CP1 — Form Toggle by Withdrawal Type

| | |
|---|---|
| **ID** | TC-7-04 |
| **Description** | Selecting ZAR / BTC / USDT radio shows the correct input form |
| **Steps** | Click each radio button in succession |
| **Expected Result** | Only the selected form (`wdFormZar`, `wdFormBtc`, or `wdFormUsdt`) is visible; others hidden |
| **Actual Result** | |
| **Status** | |

---

### TC-7-05: CP1 — ZAR Estimate Calculation

| | |
|---|---|
| **ID** | TC-7-05 |
| **Description** | Entering ZAR amount shows estimated breakdown using live USDTZAR rate |
| **Steps** | Enter "1000" in ZAR amount field; click Recalculate |
| **Expected Result** | USDT needed, conversion fee, and net amount shown correctly based on live rate |
| **Actual Result** | |
| **Status** | |

---

### TC-7-06: CP1 — BTC Address Validation (T9-ADDR)

| | |
|---|---|
| **ID** | TC-7-06 |
| **Description** | Invalid BTC address shows validation error; valid address passes |
| **Steps** | Enter "invalid_btc_addr" in BTC address field; attempt submit. Then enter a valid P2PKH address. |
| **Expected Result** | Invalid: error message shown, no API call made. Valid: error hidden. |
| **Actual Result** | |
| **Status** | |

---

### TC-7-07: CP1 — USDT TRC-20 Address Validation (T9-ADDR)

| | |
|---|---|
| **ID** | TC-7-07 |
| **Description** | Invalid TRC-20 address rejected client-side |
| **Steps** | Enter "0xInvalidEthAddr" in USDT address field |
| **Expected Result** | Error: "Invalid TRC-20 address (must start with T, 34 characters total)" |
| **Actual Result** | |
| **Status** | |

---

### TC-7-08: CP1 — Confirmation Checkbox Required

| | |
|---|---|
| **ID** | TC-7-08 |
| **Description** | Submitting without ticking confirmation checkbox shows error |
| **Steps** | Fill in ZAR amount; leave checkbox unticked; click Submit |
| **Expected Result** | Error: "Please tick the confirmation checkbox." No API call made |
| **Actual Result** | |
| **Status** | |

---

### TC-7-09: CP1 — ZAR Withdrawal Submission (T8-ZAR)

| | |
|---|---|
| **ID** | TC-7-09 |
| **Description** | Customer submits ZAR withdrawal via portal |
| **Preconditions** | Customer has sufficient USDT balance; bank account linked |
| **Steps** | Enter ZAR amount, tick checkbox, submit |
| **Expected Result** | Success message; `withdrawal_requests` record created; table refreshes; email sent |
| **Actual Result** | |
| **Status** | |

---

### TC-7-10: CP1 — Insufficient Balance Rejection

| | |
|---|---|
| **ID** | TC-7-10 |
| **Description** | Withdrawal amount exceeding withdrawable balance shows error |
| **Steps** | Enter BTC amount 999 BTC (far exceeding balance); attempt submit |
| **Expected Result** | Error: "Amount exceeds withdrawable BTC balance (X.XXXXXXXX BTC)" |
| **Actual Result** | |
| **Status** | |

---

### TC-7-11: CP1 — Cancel Pending Withdrawal (T8-CANCEL via portal)

| | |
|---|---|
| **ID** | TC-7-11 |
| **Description** | Customer cancels pending withdrawal via Cancel button in history |
| **Preconditions** | A `pending` withdrawal exists |
| **Steps** | Click Cancel button; confirm dialog |
| **Expected Result** | Status → `cancelled`; `ef_revert_withdrawal` called; table refreshes; email sent |
| **Actual Result** | |
| **Status** | |

---

### TC-7-12: CP1 — Withdrawal History Renders

| | |
|---|---|
| **ID** | TC-7-12 |
| **Description** | Customer sees own withdrawal history with correct status badges |
| **Steps** | Navigate to Withdrawals section |
| **Expected Result** | Table populated with correct Date, Currency, Amount, Net Amount, Status badge per row |
| **Actual Result** | |
| **Status** | |

---

### TC-7-13: CP1 — API Model BTC Note Display

| | |
|---|---|
| **ID** | TC-7-13 |
| **Description** | BTC withdrawal form shows whitelist note for API model customers |
| **Preconditions** | Customer has `account_model = 'api'` |
| **Steps** | Select BTC withdrawal type in portal |
| **Expected Result** | amber note visible: "Your VALR API key's Withdraw whitelist must include this address" |
| **Actual Result** | |
| **Status** | |

---

### TC-7-14: CP2 — API Key Card Hidden for Subaccount Model

| | |
|---|---|
| **ID** | TC-7-14 |
| **Description** | Settings section hides VALR API Key card for subaccount model customers |
| **Steps** | Log in as subaccount customer; navigate to Settings |
| **Expected Result** | "🔑 VALR API Key" card is not visible (`display: none`) |
| **Actual Result** | |
| **Status** | |

---

### TC-7-15: CP2 — API Key Info Displays for API Model (T2 portal path)

| | |
|---|---|
| **ID** | TC-7-15 |
| **Description** | API model customer sees key name, expiry, and permissions in Settings |
| **Preconditions** | API model customer with configured API keys |
| **Steps** | Navigate to Settings |
| **Expected Result** | Key Name, Status (✅ Verified), Expiry date with colour-coded days remaining, Permissions badges displayed |
| **Actual Result** | |
| **Status** | |

---

### TC-7-16: CP2 — Update API Key via Portal (T12 portal path)

| | |
|---|---|
| **ID** | TC-7-16 |
| **Description** | Customer updates API key via portal Settings form |
| **Steps** | Click "🔄 Update API Key"; fill in new key details; click Save & Validate |
| **Expected Result** | `ef_store_customer_api_keys` called with customer JWT; success message; key info refreshed |
| **Actual Result** | |
| **Status** | |

---

### TC-7-17: CP2 — Bank Account Displays for Both Models

| | |
|---|---|
| **ID** | TC-7-17 |
| **Description** | Linked bank account details shown (masked account number) |
| **Preconditions** | Customer has bank account linked in exchange_accounts |
| **Steps** | Navigate to Settings |
| **Expected Result** | Bank name, masked account number (`****XXXX`), branch code, account type displayed |
| **Actual Result** | |
| **Status** | |

---

### TC-7-18: CP2 — No Bank Account Message

| | |
|---|---|
| **ID** | TC-7-18 |
| **Description** | Settings shows message when no bank account is linked |
| **Preconditions** | Customer has no bank_name in exchange_accounts |
| **Steps** | Navigate to Settings |
| **Expected Result** | Message: "No bank account linked yet. Contact support to link your bank account." |
| **Actual Result** | |
| **Status** | |

---

### TC-7-19: CP2 — API Key Expiry Banner (≤10 days)

| | |
|---|---|
| **ID** | TC-7-19 |
| **Description** | Dashboard shows red expiry banner when API key expires within 10 days |
| **Preconditions** | `api_key_expires_at = NOW() + 8 days`; customer is API model |
| **Steps** | Log in and observe Dashboard section |
| **Expected Result** | Red banner visible: "⚠️ Action Required: Your VALR API key expires in 8 days!" |
| **Actual Result** | |
| **Status** | |

---

### TC-7-20: CP2 — No Banner for Subaccount Model

| | |
|---|---|
| **ID** | TC-7-20 |
| **Description** | API key expiry banner not shown for subaccount model customers |
| **Steps** | Log in as subaccount customer with any `api_key_expires_at` value |
| **Expected Result** | Banner `apiKeyExpiryBanner` remains hidden |
| **Actual Result** | |
| **Status** | |

---

## Phase 8 — Email Templates

### TC-8-01: getZarDepositDetectedAdminEmail — Content Validation

| | |
|---|---|
| **ID** | TC-8-01 |
| **Description** | Admin ZAR deposit email renders correctly with all expected fields |
| **Steps** | Trigger `ef_deposit_scan` on a customer with ZAR balance; check admin email |
| **Expected Result** | Email received with: customer name, amount `R{zarAmount}`, date/time, account model badge, Admin UI link button |
| **Actual Result** | |
| **Status** | |

---

### TC-8-02: getWithdrawalSubmittedEmail — Customer Receive

| | |
|---|---|
| **ID** | TC-8-02 |
| **Description** | Customer receives processing confirmation email after withdrawal submitted |
| **Steps** | Submit a withdrawal; check customer inbox |
| **Expected Result** | Email with withdrawal breakdown (gross amount, interim fee, VALR fees, net amount), reference ID |
| **Actual Result** | |
| **Status** | |

---

### TC-8-03: getWithdrawalOutcomeEmail — Completed Variant

| | |
|---|---|
| **ID** | TC-8-03 |
| **Description** | Customer receives "Withdrawal Complete" email when VALR confirms |
| **Steps** | Complete a withdrawal end-to-end |
| **Expected Result** | Green "✅ Withdrawal Complete" email with amount, VALR ID, and bank / crypto arrival timeframe |
| **Actual Result** | |
| **Status** | |

---

### TC-8-04: getWithdrawalFailedAdminEmail — Admin Alert

| | |
|---|---|
| **ID** | TC-8-04 |
| **Description** | Admin receives red failure alert when withdrawal fails on VALR |
| **Steps** | Force a VALR API error (bad address); check admin inbox |
| **Expected Result** | Red email with customer details, withdrawal ID, error message, retry/revert instructions |
| **Actual Result** | |
| **Status** | |

---

### TC-8-05: getWithdrawalCancelledEmail — Customer Receive

| | |
|---|---|
| **ID** | TC-8-05 |
| **Description** | Customer receives cancellation email after cancelling pending withdrawal |
| **Steps** | Cancel a pending withdrawal |
| **Expected Result** | "🚫 Withdrawal Cancelled" email with amount and assurance that funds are safe |
| **Actual Result** | |
| **Status** | |

---

### TC-8-06: getApiKeyExpiryWarningEmail — Customer Receive (T10)

| | |
|---|---|
| **ID** | TC-8-06 |
| **Description** | Customer receives amber/red warning email before API key expiry |
| **Steps** | Run TC-5-01 (30-day warning) |
| **Expected Result** | Email with 5-step renewal instructions, portal CTA button, expiry date |
| **Actual Result** | |
| **Status** | |

---

### TC-8-07: getApiKeyExpiryCriticalEmail — Customer Receive (T11)

| | |
|---|---|
| **ID** | TC-8-07 |
| **Description** | Customer receives red "Trading Paused" email when key expires |
| **Steps** | Run TC-5-03 (expired key) |
| **Expected Result** | Red email: "🚨 Trading Paused"; same 5-step renewal instructions; portal link |
| **Actual Result** | |
| **Status** | |

---

## Phase 9 — Cron Jobs

### TC-9-01: ef_rotate_api_key_notifications_daily — Scheduling

| | |
|---|---|
| **ID** | TC-9-01 |
| **Description** | Cron job scheduled at 08:00 UTC daily |
| **Steps** | Run: `SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'ef_rotate_api_key_notifications_daily';` |
| **Expected Result** | `schedule = '0 8 * * *'`, `active = TRUE` |
| **Actual Result** | |
| **Status** | |

---

### TC-9-02: ef_rotate_api_key_notifications_daily — Triggers Correctly

| | |
|---|---|
| **ID** | TC-9-02 |
| **Description** | Cron job successfully calls the edge function at scheduled time |
| **Steps** | Wait for 08:00 UTC; check `cron.job_run_details` for recent run |
| **Expected Result** | `status = 'succeeded'`; function returned 200 |
| **Actual Result** | |
| **Status** | |

---

## End-to-End Regression Tests

### TC-E2E-01: Complete API Model Customer Journey

| | |
|---|---|
| **ID** | TC-E2E-01 |
| **Description** | Full journey: prospect → KYC (API model) → API keys → ZAR deposit → conversion → active → trade → withdrawal |
| **Steps** | 1. Create prospect; 2. Submit KYC; 3. Admin verifies as API model (TC-6-01); 4. Admin enters API keys (TC-6-04); 5. Customer deposits ZAR to VALR; 6. ef_deposit_scan detects ZAR (TC-2-03); 7. Admin converts ZAR→USDT (TC-6-05); 8. Customer becomes active; 9. ef_execute_orders places trade (TC-2-01); 10. Customer withdraws USDT (TC-7-09) |
| **Expected Result** | All steps succeed; VALR uses customer keys throughout; no subaccount created |
| **Actual Result** | |
| **Status** | |

---

### TC-E2E-02: Subaccount Model — No Regression (T13)

| | |
|---|---|
| **ID** | TC-E2E-02 |
| **Description** | Existing subaccount model customer continues to trade without disruption after Phase 1-6 changes |
| **Steps** | Confirm active subaccount customer receives normal trade execution, fills, P&L updates, and fee transfers after deploying all phases |
| **Expected Result** | All existing functionality unchanged; no errors in pipeline logs |
| **Actual Result** | |
| **Status** | |

---

### TC-E2E-03: API Key Lifecycle (T10 → T11 → T12)

| | |
|---|---|
| **ID** | TC-E2E-03 |
| **Description** | API key goes from warning → expiry → renewal |
| **Steps** | 1. Set `api_key_expires_at = NOW() + 8 days` → run EF14 → warning email (TC-5-04); 2. Set `api_key_expires_at = NOW() - 1 day` → run EF14 → trading paused, critical email (TC-5-03); 3. Customer updates key via portal → trading re-enabled automatically or by admin |
| **Expected Result** | Each phase produces expected email and state change |
| **Actual Result** | |
| **Status** | |

---

## Test Execution Summary

| Phase | Total Tests | PASS | FAIL | SKIP | BLOCKED |
|---|---|---|---|---|---|
| Phase 0 — Migrations | 9 | | | | |
| Phase 1 — Shared Modules | 5 | | | | |
| Phase 2 — EF Updates | 6 | | | | |
| Phase 3 — New EFs (EF7–EF8) | 5 | | | | |
| Phase 4 — Withdrawal EFs | 11 | | | | |
| Phase 5 — EF14 Notifications | 6 | | | | |
| Phase 6 — Admin UI | 8 | | | | |
| Phase 7 — Customer Portal | 18 | | | | |
| Phase 8 — Email Templates | 7 | | | | |
| Phase 9 — Cron Jobs | 2 | | | | |
| End-to-End | 3 | | | | |
| **TOTAL** | **80** | | | | |

---

## Quick SQL Verification Queries

```sql
-- Check all migration columns are present
SELECT 
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'customer_details' AND column_name = 'account_model') AS m1_account_model,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'exchange_accounts' AND column_name = 'api_key_vault_id') AS m2_vault_id,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'exchange_accounts' AND column_name = 'bank_name') AS m3_bank_name,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'lth_pvr' AND table_name = 'valr_transfer_log') AS m4_transfer_log,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'lth_pvr' AND table_name = 'pending_zar_conversions') AS m5_pending_zar,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'lth_pvr' AND table_name = 'withdrawal_requests') AS m6_withdrawals,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'exchange_accounts' AND column_name = 'api_key_warning_days_sent') AS m8_warning_days;

-- Check cron jobs
SELECT jobname, schedule, active FROM cron.job 
WHERE jobname IN ('ef_rotate_api_key_notifications_daily', 'pipeline_resume_daily');

-- Check API model customers
SELECT customer_id, first_names, last_name, account_model 
FROM public.customer_details 
WHERE account_model = 'api';

-- Check vault keys for API model customers
SELECT cd.first_names, cd.last_name, ea.api_key_vault_id, ea.api_key_label, ea.api_key_expires_at, ea.api_key_verified_at
FROM public.customer_details cd
JOIN public.exchange_accounts ea ON ea.customer_id = cd.customer_id
WHERE cd.account_model = 'api';

-- Check withdrawal history
SELECT wr.withdrawal_id, cd.first_names, cd.last_name, wr.currency, wr.gross_amount, wr.status, wr.requested_at
FROM lth_pvr.withdrawal_requests wr
JOIN public.customer_details cd ON cd.customer_id = wr.customer_id
ORDER BY wr.requested_at DESC LIMIT 20;

-- Check pending ZAR conversions
SELECT * FROM lth_pvr.pending_zar_conversions ORDER BY detected_at DESC LIMIT 10;
```

---

*Document owner: BitWealth Engineering*  
*Last updated: 2026-03-07*  
*For implementation details, see: [docs/API_DUAL_MODEL_BUILD_PLAN.md](API_DUAL_MODEL_BUILD_PLAN.md)*
