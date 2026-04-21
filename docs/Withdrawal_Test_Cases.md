# Withdrawal Process — Test Cases

**Version:** 1.0  
**Date:** 2026-02-15  
**Scope:** Full end-to-end coverage of the new asynchronous withdrawal state machine introduced in build `withdrawal_state_machine_v2`.

---

## Architecture Recap

State machine:

```
pending  →  converting  →  paying_out  →  completed
   │             │              │
   └──────┬──────┘              └──→  failed
          ↓
      cancelled
```

| Edge function | Trigger | Purpose |
| --- | --- | --- |
| `ef_request_withdrawal` | Customer portal | Pure intake — validates, snapshots HWM, inserts row with `status='pending'`. Returns immediately. |
| `ef_process_withdrawal_queue` | `pg_cron` `*/5 * * * *` | State-machine driver. Picks up `pending` and `converting` rows; advances them. |
| `ef_revert_withdrawal` | Customer portal Cancel button **or** Admin UI | Cancels `pending` always; cancels `converting` only if zero VALR fills (and cancels live VALR orders). |
| `ef_sync_valr_transactions` | `pg_cron` (existing) | Detects `BLOCKCHAIN_SEND` / `FIAT_WITHDRAWAL` on VALR side and flips matching `paying_out` rows to `completed`. |

Both Subaccount Model (admin holds VALR API key, routes via `X-VALR-SUB-ACCOUNT-ID`) and API Model (customer's own API key with full withdrawal scope) follow the **identical** code path. Credentials are resolved per row by `resolveCustomerCredentials()`.

---

## Test Case Format

| Field | Description |
| --- | --- |
| **TC** | Test ID |
| **Setup** | Prerequisite state |
| **Action** | Trigger to perform |
| **Expected** | Asserted outcome |
| **Actual** | Filled at execution |
| **Status** | PASS / FAIL / SKIP |

---

## A. BTC Withdrawal (External Wallet)

### TC-W01 — BTC withdrawal, Subaccount Model
- **Setup:** Customer 31 (Subaccount), BTC balance ≥ requested gross + fee.
- **Action:** Submit BTC withdrawal of 0.001 BTC to whitelisted address.
- **Expected:** 
  - `withdrawal_requests` row inserted with `status='pending'`, `currency='BTC'`, `source_asset='BTC'`.
  - Submission email sent to customer.
  - Within 5 min the queue picks it up and calls `cryptoWithdraw()`.
  - Row transitions to `paying_out` with `valr_withdrawal_id` populated, `dispatched_at` set.
  - `ef_sync_valr_transactions` detects matching `BLOCKCHAIN_SEND` → flips to `completed`, sends success email.

### TC-W02 — BTC withdrawal, API Model
- **Setup:** API-Model test customer (provided manually), customer's own API key has withdrawal permission.
- **Action:** Same as TC-W01.
- **Expected:** Identical to TC-W01 — `resolveCustomerCredentials` returns customer key, no `X-VALR-SUB-ACCOUNT-ID` header sent.

### TC-W03 — BTC withdrawal, insufficient BTC balance
- **Setup:** Customer 31 BTC balance < gross.
- **Action:** Submit BTC withdrawal exceeding balance.
- **Expected:** `ef_request_withdrawal` rejects intake with HTTP 400 + descriptive error before any row is inserted.

### TC-W04 — BTC withdrawal, invalid address
- **Setup:** Customer 31 has BTC.
- **Action:** Submit BTC withdrawal to malformed address.
- **Expected:** Intake validation rejects with HTTP 400. No row inserted.

---

## B. USDT Withdrawal (External Wallet)

### TC-W05 — USDT withdrawal, Subaccount Model
- **Setup:** Customer 31 USDT ≥ requested + fee.
- **Action:** Submit USDT withdrawal of 100 USDT (TRC20).
- **Expected:** Same flow as TC-W01 but `currency='USDT'`, `source_asset='USDT'`.

### TC-W06 — USDT withdrawal, API Model
- **Setup:** API-Model customer.
- **Action:** Same as TC-W05.
- **Expected:** Identical happy path.

### TC-W07 — USDT withdrawal exceeds balance
- **Action:** Request 1,000 USDT when only 50 USDT held.
- **Expected:** HTTP 400 at intake.

---

## C. ZAR Withdrawal — USDT-only path

### TC-W08 — ZAR withdrawal, USDT alone covers gross-ZAR
- **Setup:** Customer 31 holds enough USDT that USDT × USDTZAR rate ≥ gross-ZAR. Linked bank account.
- **Action:** Request R10,000 ZAR withdrawal.
- **Expected:**
  - `pending` row created with `currency='ZAR'`, `source_asset` left null.
  - Within 5 min: queue computes USDT-only split, places LIMIT SELL on USDTZAR at best bid, stamps `conversion_order_id_usdt`, sets `status='converting'`, `source_asset='USDT'`.
  - Next queue pass: order filled, queue computes payout, calls `zarWithdraw()`, sets `status='paying_out'` with `valr_withdrawal_id`.
  - `ef_sync_valr_transactions` detects `FIAT_WITHDRAWAL` → flips to `completed`.

---

## D. ZAR Withdrawal — BTC shortfall path

### TC-W09 — ZAR withdrawal, USDT covers part, rest from BTC
- **Setup:** Customer USDT balance worth R6,000; BTC balance covers the remaining R4,000+. Linked bank account.
- **Action:** Request R10,000 ZAR.
- **Expected:**
  - `pending` row created.
  - Queue computes split: USDT-first sells all available USDT; remaining ZAR shortfall is sold from BTC **direct** (BTCZAR), **not** BTC→USDT→ZAR.
  - Two LIMIT SELLs placed: USDTZAR + BTCZAR. Both `conversion_order_id_*` populated. `source_asset='BTC+USDT'`.
  - Next queue pass: when **both** legs filled, queue computes `payoutZar = min(grossZar - fees, requested netZar)`, calls `zarWithdraw`, transitions to `paying_out`.

### TC-W10 — ZAR withdrawal, BTC alone (zero USDT)
- **Setup:** Customer USDT = 0. BTC sufficient.
- **Action:** Request R5,000 ZAR.
- **Expected:** Single BTCZAR LIMIT SELL placed. `source_asset='BTC'`.

### TC-W11 — ZAR withdrawal, total balance insufficient
- **Setup:** Combined USDT + BTC value < gross-ZAR.
- **Action:** Request R100,000 ZAR.
- **Expected:** Queue's `processZarPending` detects shortfall → `markFailed` with `failure_reason='insufficient_balance'`, severity=`error` alert logged, failure email sent to customer.

---

## E. Cancellation

### TC-W12 — Cancel during `pending`
- **Setup:** Withdrawal just submitted, queue not yet run.
- **Action:** Click Cancel in customer portal.
- **Expected:** `ef_revert_withdrawal` succeeds, row → `cancelled`, HWM revert applied, cancellation email sent. Queue (when it next runs) skips because status is no longer `pending`/`converting`.

### TC-W13 — Cancel during `converting`, zero fills
- **Setup:** ZAR withdrawal is `converting`, LIMIT SELL(s) on book with no fills (e.g. limit price away from market).
- **Action:** Click Cancel.
- **Expected:** Server resolves VALR creds, fetches order summary for each leg via `customerOrderId`, sees `filledQty=0` and status open → calls `cancelOrderById` for each leg, then performs HWM revert, marks row `cancelled`.

### TC-W14 — Cancel during `converting`, partial fill
- **Setup:** One leg `Active` with `filledQty > 0`.
- **Action:** Click Cancel.
- **Expected:** `ef_revert_withdrawal` returns HTTP 409 with reason `order has been partially filled`. UI surfaces friendly message: *"This withdrawal can no longer be cancelled — the conversion order has already been (partially) filled."* Row remains `converting`. `cancellation_attempted_at` is stamped (audit trail).

### TC-W15 — Cancel during `converting`, fully filled
- **Setup:** Both conversion orders `Filled`.
- **Action:** Click Cancel.
- **Expected:** Same 409 with reason `order has already filled`. Row continues to `paying_out` on next queue pass.

### TC-W16 — Cancel during `paying_out`
- **Setup:** Row already `paying_out` (VALR withdrawal in flight).
- **Action:** Cancel button is hidden in UI; if user calls endpoint directly → server returns 409 (status guard).
- **Expected:** No state change.

### TC-W17 — Cancel during `completed` / `failed` / `cancelled`
- **Action:** Cancel endpoint called for terminal status.
- **Expected:** HTTP 409 — terminal states cannot be reverted.

---

## F. Failure Scenarios

### TC-W18 — VALR API error during crypto withdrawal
- **Setup:** Force VALR rejection (e.g., temporarily unwhitelisted address, or revoke API key scope mid-flight).
- **Action:** Queue runs, calls `cryptoWithdraw`, which throws.
- **Expected:** `markFailed('valr_error: ...')` invoked → `status='failed'`, `failure_reason` populated, severity=`error` alert via `logAlert`, failure email sent. Row visible in admin UI with yellow highlight (failed).

### TC-W19 — VALR API error during ZAR conversion order placement
- **Setup:** Force LIMIT SELL placement to fail (e.g., insufficient permission on subaccount).
- **Action:** Queue runs `processZarPending`.
- **Expected:** `markFailed('place_order_failed: ...')` invoked. Same alerting + email behavior.

### TC-W20 — VALR API error during `zarWithdraw`
- **Setup:** ZAR conversion completed, but bank withdrawal call fails (e.g., rate-limited).
- **Action:** Queue runs `processZarConverting` after fills.
- **Expected:** Conversion proceeds (cannot rollback already-sold USDT/BTC); `markFailed('zar_withdraw_failed: ...')`. Admin must manually pay out from VALR ZAR balance — failure_reason and details captured.

### TC-W21 — Admin retry of failed row
- **Setup:** Row in `status='failed'` (any cause).
- **Action:** Admin clicks **↺ Retry** in Admin UI.
- **Expected:** Direct DB update sets `status='pending'`, `failure_reason=NULL`, `queue_attempts=0`. Next queue pass picks it up and re-runs the appropriate path.

---

## G. Market Fallback

### TC-W22 — Stale LIMITs replaced by MARKET
- **Setup:** ZAR withdrawal in `converting` with LIMIT(s) at non-marketable price; `queue_attempts >= 3` (≈15 min on the 5-min cron).
- **Action:** Wait for the 4th queue pass on this row.
- **Expected:** Queue cancels the stale LIMITs via `cancelOrderById`, places MARKET orders with `customerOrderId` re-prefixed `wd-usdt-mkt-…` / `wd-btc-mkt-…`, updates `conversion_order_id_*` columns. Subsequent queue pass detects MARKET fills and proceeds to `zarWithdraw`.

---

## H. Settlement Detection (`ef_sync_valr_transactions`)

### TC-W23 — BTC settlement match by `valr_withdrawal_id`
- **Setup:** Row in `paying_out`, `valr_withdrawal_id` known.
- **Action:** Sync function runs, sees `BLOCKCHAIN_SEND` whose `additionalInfo.withdrawalId` equals stored id.
- **Expected:** Row → `completed`, `completed_at` set from `eventAt`, info-level alert logged.

### TC-W24 — ZAR settlement match by amount within tolerance
- **Setup:** Row in `paying_out`, `valr_withdrawal_id` null (rare). Customer's `amount_zar` = R10,000.
- **Action:** Sync sees `FIAT_WITHDRAWAL` of R10,000.00.
- **Expected:** Row → `completed` (matched by currency + amount within R0.50 + occurred-at ≥ dispatched_at).

### TC-W25 — Sync ignores withdrawals not in `paying_out`
- **Setup:** Old `completed` row exists.
- **Action:** Sync runs, sees historical `BLOCKCHAIN_SEND` for it.
- **Expected:** No state change (filter `status='paying_out'`).

---

## I. UI Behaviour

### TC-W26 — Cancel button visibility (customer portal)
- **Expected:** Cancel button shown only when `status IN ('pending','converting')`. Hidden for `paying_out`, `completed`, `failed`, `cancelled`.

### TC-W27 — Cancel 409 surfaces friendly error
- **Action:** Trigger TC-W14 from portal.
- **Expected:** Alert dialog: *"This withdrawal can no longer be cancelled — the conversion order has already been (partially) filled."*

### TC-W28 — Admin UI status filter offers new statuses
- **Expected:** Filter dropdown lists: All, Pending, Converting, Paying Out, Completed, Failed, Cancelled.

### TC-W29 — Admin UI failed highlight is plain
- **Expected:** Only rows with `status='failed'` get the yellow row background. The old `processing > 30 min` rule is removed.

### TC-W30 — Admin Details modal shows new fields
- **Expected:** Modal lists: Source Asset, Failure Reason, Dispatched at, Conversion Order IDs (USDT/BTC), Queue Attempts.

---

## J. Concurrency & Idempotency

### TC-W31 — Two queue invocations in parallel
- **Setup:** Long-running queue pass overlaps with cron's next 5-min invocation.
- **Expected:** No duplicate VALR orders. Queue uses unique `customerOrderId` (`wd-usdt-{request_id}`) so VALR rejects duplicates. Status update transitions guard against re-processing.

### TC-W32 — Sync re-runs on already-completed row
- **Action:** `ef_sync_valr_transactions` runs twice in a row.
- **Expected:** Second run sees no rows in `paying_out` for that customer → no updates.
