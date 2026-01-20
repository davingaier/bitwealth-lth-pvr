# Task 5: Real Customer Fees - Test Cases

**Feature:** Real Customer Fees with High Water Mark (HWM) Logic  
**Version:** v0.6.23  
**Test Plan Created:** 2026-01-20  
**Testing Start:** After Phase 0 (Table Consolidation) complete  
**Testing End:** Before production deployment (est. 2026-02-10)

---

## Test Strategy

### 4-Layer Testing Approach

**Layer 1: Development Subaccount (Real VALR Integration)**
- **Environment:** Live VALR development subaccount with $50-100 real funds
- **Purpose:** Validate actual VALR API integration (transfers, conversions, fees)
- **Coverage:** Platform fees, BTC deposits, VALR transfers, BTC→USDT conversion
- **Risk:** Uses real money (small amounts), real API calls

**Layer 2: Back-Tester Validation**
- **Environment:** Production back-tester (lth_pvr_bt schema)
- **Purpose:** Compare live trading fee calculations vs back-tester results
- **Coverage:** Performance fee HWM logic, month-boundary updates, NET vs GROSS platform fee
- **Risk:** Low (read-only queries, no real money)

**Layer 3: Manual SQL Testing**
- **Environment:** Development database (direct SQL queries)
- **Purpose:** Test edge cases, formula validation, data integrity
- **Coverage:** HWM formulas, snapshot reversion, invoice generation, withdrawal scenarios
- **Risk:** Low (test database only)

**Layer 4: Unit Tests (TypeScript with Deno)**
- **Environment:** Deno test runner (isolated functions)
- **Purpose:** Test individual functions with mocked dependencies
- **Coverage:** Edge cases, error handling, VALR API mocking
- **Risk:** None (no database or API calls)

---

## LAYER 1: Development Subaccount Tests (Real VALR Integration)

### Prerequisites

**Development Subaccount Setup:**
1. Create test customer in production (Customer ID: 999, Name: "Test Fee Integration")
2. Create VALR development subaccount via Admin UI
3. Fund with $100 USDT + 0.01 BTC
4. Enable LTH_PVR strategy with:
   - `performance_fee_rate` = 0.10 (10%)
   - `platform_fee_rate` = 0.0075 (0.75%)
   - `live_enabled` = TRUE

**Initial State:**
```sql
INSERT INTO public.customer_strategies (
  org_id, customer_id, strategy_code, strategy_version_id,
  exchange_account_id, status, live_enabled,
  performance_fee_rate, platform_fee_rate,
  label
) VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b',
  999,
  'LTH_PVR',
  'c27eac6c-be09-49b5-937e-0389626ca97c',
  '<dev_exchange_account_id>',
  'active',
  TRUE,
  0.10,
  0.0075,
  'Test Fee Integration - LTH PVR BTC DCA'
);

-- Initialize HWM state
INSERT INTO lth_pvr.customer_state_daily (
  org_id, customer_id, trade_date,
  high_water_mark_usd, hwm_contrib_net_cum, last_perf_fee_month
) VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b',
  999,
  CURRENT_DATE,
  100.00,  -- Initial NAV = $100
  0.00,    -- No contributions yet
  NULL     -- No performance fee charged yet
);
```

---

### TC1.1: ZAR Deposit → Platform Fee on NET USDT ✅

**Objective:** Verify platform fee charged on NET USDT (after VALR 0.18% conversion fee)

**Test Steps:**
1. Simulate ZAR deposit: R1,000 at exchange rate 18.50 = $54.05 USDT (before VALR fee)
2. VALR charges 0.18% conversion fee: $54.05 × 0.0018 = $0.097 USDT
3. NET USDT after VALR fee: $54.05 - $0.097 = $53.95 USDT
4. Platform fee (0.75% on NET): $53.95 × 0.0075 = $0.405 USDT
5. Customer receives: $53.95 - $0.405 = $53.55 USDT

**SQL Simulation:**
```sql
-- Manually insert ledger entry (simulate ef_post_ledger_and_balances)
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, trade_date, kind,
  amount_zar, exchange_rate,
  amount_usdt, fee_usdt,  -- VALR conversion fee
  platform_fee_usdt,       -- BitWealth platform fee
  note
) VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b',
  999,
  CURRENT_DATE,
  'deposit',
  1000.00,     -- ZAR amount
  18.50,       -- ZAR/USDT rate
  53.95,       -- NET USDT (after VALR fee)
  0.097,       -- VALR 0.18% fee
  0.405,       -- Platform 0.75% fee on NET
  'ZAR deposit R1,000 → $53.95 USDT (VALR fee $0.097, platform fee $0.405)'
);
```

**Expected Results:**
- ✅ Ledger entry created with correct fees breakdown
- ✅ `amount_usdt` = $53.95 (NET after VALR fee, before platform fee)
- ✅ `platform_fee_usdt` = $0.405 (0.75% of $53.95)
- ✅ Customer receives $53.55 USDT (credited to VALR subaccount)
- ✅ Platform fee $0.405 transferred to BitWealth main account (VALR API call logged)

**Validation Queries:**
```sql
-- Check ledger entry
SELECT 
  trade_date,
  kind,
  amount_zar,
  exchange_rate,
  amount_usdt,           -- Should be $53.95
  fee_usdt,              -- Should be $0.097 (VALR fee)
  platform_fee_usdt,     -- Should be $0.405 (BitWealth fee)
  amount_usdt - platform_fee_usdt AS customer_receives  -- Should be $53.55
FROM lth_pvr.ledger_lines
WHERE customer_id = 999 AND kind = 'deposit' AND trade_date = CURRENT_DATE;

-- Check VALR transfer log (future enhancement - new table)
SELECT * FROM lth_pvr.valr_transfer_log 
WHERE customer_id = 999 AND transfer_type = 'platform_fee';
```

**Status:** ⏳ PENDING (awaiting Phase 2 implementation)

---

### TC1.2: BTC Deposit → 0.75% Fee Deducted, Auto-Converted to USDT ✅

**Objective:** Verify BTC deposit platform fee (0.75% of BTC) is deducted and auto-converted to USDT

**Test Steps:**
1. Customer sends 0.1 BTC to development subaccount deposit address
2. `ef_deposit_scan` detects deposit (runs every 5 minutes)
3. Platform fee calculated: 0.1 BTC × 0.0075 = 0.00075 BTC
4. Customer receives: 0.1 BTC - 0.00075 BTC = 0.09925 BTC
5. Platform fee 0.00075 BTC transferred to BitWealth main account (VALR API)
6. Auto-convert 0.00075 BTC → USDT via MARKET order
7. BTC price at conversion = $50,000 → 0.00075 BTC = $37.50 USDT (approx)

**Expected Results:**
- ✅ Ledger entry: `kind` = 'deposit', `amount_btc` = 0.09925, `platform_fee_btc` = 0.00075
- ✅ VALR transfer successful: 0.00075 BTC from subaccount to main account
- ✅ VALR MARKET order placed: SELL 0.00075 BTC → USDT
- ✅ Second ledger entry: `kind` = 'platform_fee_conversion', `amount_btc` = -0.00075, `amount_usdt` = +37.50
- ✅ Alert logged if conversion fails (VALR API error)

**Validation Queries:**
```sql
-- Check BTC deposit ledger entry
SELECT 
  trade_date,
  kind,
  amount_btc,            -- Should be 0.09925
  platform_fee_btc,      -- Should be 0.00075
  note
FROM lth_pvr.ledger_lines
WHERE customer_id = 999 AND kind = 'deposit' AND amount_btc > 0
ORDER BY created_at DESC LIMIT 1;

-- Check auto-conversion ledger entry
SELECT 
  trade_date,
  kind,
  amount_btc,            -- Should be -0.00075 (sold)
  amount_usdt,           -- Should be ~$37.50 (price-dependent)
  note
FROM lth_pvr.ledger_lines
WHERE customer_id = 999 AND kind = 'platform_fee_conversion'
ORDER BY created_at DESC LIMIT 1;
```

**Status:** ⏳ PENDING (awaiting Phase 2 implementation)

---

### TC1.3: Month-End HWM Profit → 10% Performance Fee Charged ✅

**Objective:** Verify performance fee charged only when NAV exceeds HWM + net contributions

**Setup:**
- Starting HWM: $100 (from TC1.1)
- Net contributions since HWM: $53.55 (from TC1.1 deposit)
- Current NAV: $200 (assume profitable trading month)
- Expected HWM threshold: $100 + $53.55 = $153.55
- Profit above HWM: $200 - $153.55 = $46.45
- Performance fee (10%): $46.45 × 0.10 = $4.65

**Test Steps:**
1. Manually set NAV to $200 in `lth_pvr.balances_daily`
2. Run `ef_calculate_performance_fees` on 1st of next month (00:05 UTC)
3. Verify performance fee $4.65 deducted from USDT balance
4. Verify HWM updated to $195.35 (NAV $200 - net contributions $53.55)
5. Verify invoice generated in `lth_pvr.fee_invoices`

**SQL Simulation:**
```sql
-- Simulate month-end balances
INSERT INTO lth_pvr.balances_daily (
  org_id, customer_id, date,
  btc_balance, usdt_balance, nav_usd
) VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b',
  999,
  '2026-01-31',
  0.00200000,  -- 0.002 BTC @ $50,000 = $100
  100.00,      -- $100 USDT
  200.00       -- Total NAV
);

-- Call performance fee function
SELECT lth_pvr.calculate_performance_fees(999, '2026-01-31');
```

**Expected Results:**
- ✅ Performance fee calculated: $4.65
- ✅ Ledger entry: `kind` = 'performance_fee', `amount_usdt` = -4.65
- ✅ HWM updated: $195.35 (NAV $200 - $4.65 fee = $195.35 NAV after fee, minus $53.55 net contributions = $141.80 new HWM)
  - **CORRECTION:** HWM = NAV after fee - net contributions = $195.35 - $53.55 = $141.80? 
  - **OR:** HWM = NAV before fee - net contributions = $200 - $53.55 = $146.45?
  - **CLARIFICATION NEEDED:** Does HWM update BEFORE or AFTER fee deduction?
- ✅ `last_perf_fee_month` = 2026-01
- ✅ Invoice created: `platform_fees_due` = $0.405, `performance_fees_due` = $4.65

**Validation Queries:**
```sql
-- Check performance fee ledger entry
SELECT * FROM lth_pvr.ledger_lines
WHERE customer_id = 999 AND kind = 'performance_fee' AND trade_date = '2026-02-01';

-- Check HWM state update
SELECT 
  high_water_mark_usd,     -- Should be $141.80 or $146.45 (needs clarification)
  hwm_contrib_net_cum,     -- Should be $53.55 (unchanged)
  last_perf_fee_month      -- Should be '2026-01'
FROM lth_pvr.customer_state_daily
WHERE customer_id = 999 AND trade_date = '2026-02-01';

-- Check invoice
SELECT * FROM lth_pvr.fee_invoices
WHERE customer_id = 999 AND invoice_month = '2026-01-01';
```

**Status:** ⏳ PENDING (awaiting Phase 3 implementation)  
**BLOCKER:** Need clarification on HWM update timing (before or after fee deduction)

---

### TC1.4: Month-End HWM Loss → No Performance Fee, HWM Unchanged ✅

**Objective:** Verify no performance fee charged when NAV ≤ HWM + net contributions

**Setup:**
- Starting HWM: $141.80 (from TC1.3)
- Net contributions since HWM: $0 (no new deposits)
- Current NAV: $130 (loss month)
- Expected HWM threshold: $141.80 + $0 = $141.80
- Profit above HWM: $130 - $141.80 = -$11.80 (LOSS)
- Performance fee: $0 (no fee on losses)

**Expected Results:**
- ✅ Performance fee calculated: $0
- ✅ No ledger entry created (no fee to record)
- ✅ HWM unchanged: $141.80
- ✅ `last_perf_fee_month` = 2026-02 (month processed, but no fee)
- ✅ Invoice created: `platform_fees_due` = $0, `performance_fees_due` = $0, `status` = 'paid' (no fees due)

**Status:** ⏳ PENDING

---

### TC1.5: Withdrawal Request → Interim Performance Fee Calculated ✅

**Objective:** Verify interim performance fee calculated mid-month for withdrawal requests

**Setup:**
- Current date: 2026-02-15 (mid-month)
- Last performance fee: 2026-02-01 (from TC1.4)
- HWM: $141.80
- Net contributions since last fee: $0
- Current NAV: $180 (profitable since last check)
- Withdrawal request: $100 USDT
- Profit above HWM: $180 - $141.80 = $38.20
- Performance fee (10%): $38.20 × 0.10 = $3.82

**Test Steps:**
1. Customer submits withdrawal request for $100 USDT
2. `ef_calculate_interim_performance_fee` triggered
3. Performance fee $3.82 calculated
4. Snapshot created in `lth_pvr.withdrawal_fee_snapshots` (pre-withdrawal HWM = $141.80)
5. HWM updated to $176.18 (NAV $180 - fee $3.82 = $176.18)
6. Withdrawal approved: $100 USDT sent to customer
7. Final NAV: $76.18 ($180 - $3.82 fee - $100 withdrawal)

**Expected Results:**
- ✅ Ledger entry: `kind` = 'performance_fee_interim', `amount_usdt` = -3.82
- ✅ Snapshot created with `pre_withdrawal_hwm` = $141.80
- ✅ HWM updated immediately: $176.18
- ✅ Withdrawal processed: $100 USDT sent
- ✅ Final balances correct: NAV = $76.18

**Validation Queries:**
```sql
-- Check interim performance fee
SELECT * FROM lth_pvr.ledger_lines
WHERE customer_id = 999 AND kind = 'performance_fee_interim' AND trade_date = '2026-02-15';

-- Check withdrawal snapshot
SELECT 
  pre_withdrawal_hwm,             -- Should be $141.80
  pre_withdrawal_contrib_net_cum, -- Should be $0
  calculated_performance_fee,     -- Should be $3.82
  new_hwm                         -- Should be $176.18
FROM lth_pvr.withdrawal_fee_snapshots
WHERE customer_id = 999 AND snapshot_date = '2026-02-15';

-- Check HWM state
SELECT high_water_mark_usd FROM lth_pvr.customer_state_daily
WHERE customer_id = 999 AND trade_date = '2026-02-15';
-- Should be $176.18
```

**Status:** ⏳ PENDING (awaiting Phase 3 implementation)

---

### TC1.6: Withdrawal Declined → HWM Reverted to Pre-Withdrawal State ✅

**Objective:** Verify HWM reverts to pre-withdrawal value if withdrawal request is declined

**Setup:**
- Withdrawal request from TC1.5 still pending
- HWM currently: $176.18 (updated after interim fee)
- Admin declines withdrawal (reason: "Insufficient documentation")

**Test Steps:**
1. Admin clicks "Decline" on withdrawal request in Admin UI
2. `ef_revert_withdrawal_fees` triggered
3. HWM reverted to pre-withdrawal value: $141.80 (from snapshot)
4. Performance fee $3.82 refunded (ledger entry reversed)
5. Snapshot deleted (no longer needed)

**Expected Results:**
- ✅ HWM reverted: $141.80 (back to pre-withdrawal state)
- ✅ Ledger entry: `kind` = 'performance_fee_reversal', `amount_usdt` = +3.82
- ✅ Snapshot deleted from `withdrawal_fee_snapshots`
- ✅ Withdrawal request status = 'declined'
- ✅ Email sent to customer: "Withdrawal declined, performance fee refunded"

**Validation Queries:**
```sql
-- Check HWM reverted
SELECT high_water_mark_usd FROM lth_pvr.customer_state_daily
WHERE customer_id = 999 AND trade_date = '2026-02-15';
-- Should be $141.80 (reverted)

-- Check fee reversal ledger entry
SELECT * FROM lth_pvr.ledger_lines
WHERE customer_id = 999 AND kind = 'performance_fee_reversal' AND trade_date = '2026-02-15';

-- Check snapshot deleted
SELECT COUNT(*) FROM lth_pvr.withdrawal_fee_snapshots
WHERE customer_id = 999 AND snapshot_date = '2026-02-15';
-- Should be 0 (deleted)
```

**Status:** ⏳ PENDING (awaiting Phase 3 implementation)

---

### TC1.7: Insufficient USDT → BTC Conversion Approval Workflow ✅

**Objective:** Verify BTC→USDT conversion approval workflow when insufficient USDT for fees

**Setup:**
- Current balances: 0.002 BTC, $5 USDT (insufficient for $10 fee)
- Fee due: $10 performance fee
- BTC price: $50,000
- BTC needed: $10 / $50,000 = 0.0002 BTC
- BTC with 2% buffer: 0.0002 × 1.02 = 0.000204 BTC
- USDT target after conversion: ~$10.20

**Test Steps:**
1. `ef_calculate_performance_fees` detects insufficient USDT ($5 < $10)
2. `ef_auto_convert_btc_to_usdt` triggered
3. Approval request created in `lth_pvr.fee_conversion_approvals`
4. Email sent to customer: "Approve sale of 0.000204 BTC to cover $10 fee?"
5. Customer clicks approval link
6. LIMIT order placed: SELL 0.000204 BTC at $49,500 (1% below market)
7. LIMIT order not filled after 5 minutes
8. LIMIT order cancelled, MARKET order placed: SELL 0.000204 BTC
9. MARKET order fills at $49,800 → 0.000204 BTC = $10.16 USDT
10. Performance fee $10 deducted from $10.16 USDT
11. Excess $0.16 USDT returned to customer

**Expected Results:**
- ✅ Approval request created, email sent
- ✅ LIMIT order placed at 1% below market
- ✅ LIMIT order cancelled after 5-minute timeout
- ✅ MARKET order placed and filled
- ✅ Ledger entries:
  - `kind` = 'btc_conversion', `amount_btc` = -0.000204, `amount_usdt` = +10.16
  - `kind` = 'performance_fee', `amount_usdt` = -10.00
- ✅ Customer balance: $5.16 USDT, 0.001796 BTC

**Validation Queries:**
```sql
-- Check approval request
SELECT * FROM lth_pvr.fee_conversion_approvals
WHERE customer_id = 999 AND status = 'approved';

-- Check conversion ledger entry
SELECT * FROM lth_pvr.ledger_lines
WHERE customer_id = 999 AND kind = 'btc_conversion' AND trade_date = CURRENT_DATE;

-- Check VALR order history (LIMIT then MARKET)
SELECT * FROM lth_pvr.exchange_orders
WHERE customer_id = 999 AND pair = 'BTCUSDT' AND side = 'SELL'
ORDER BY created_at DESC LIMIT 2;
```

**Status:** ⏳ PENDING (awaiting Phase 4 implementation)

---

### TC1.8: Invoice Generation → Correct Breakdown (Platform vs Performance) ✅

**Objective:** Verify monthly invoice shows correct fee breakdown and payment status

**Setup:**
- Month: January 2026
- Platform fees: $0.405 (from TC1.1 deposit)
- Performance fees: $4.65 (from TC1.3 month-end)
- Exchange fees: $0.097 (from TC1.1 deposit, info only)
- Total fees due: $5.055 ($0.405 + $4.65)

**Test Steps:**
1. `ef_fee_monthly_close` runs on 2026-02-01 at 00:05 UTC
2. Invoice created in `lth_pvr.fee_invoices` for month 2026-01
3. Email sent to customer with invoice PDF attachment
4. Customer pays via bank transfer (manual admin recording)
5. Admin marks invoice as 'paid' in Admin UI
6. `ef_record_fee_payment` updates invoice

**Expected Results:**
- ✅ Invoice created with correct breakdown:
  - `platform_fees_due` = $0.405
  - `performance_fees_due` = $4.65
  - `exchange_fees_paid` = $0.097 (info only)
  - `total_fees_due` = $5.055
  - `total_fees_paid` = $0
  - `balance_outstanding` = $5.055
  - `status` = 'pending'
  - `due_date` = 2026-02-15 (15th of next month)
- ✅ Email sent with PDF attachment
- ✅ After payment recorded:
  - `total_fees_paid` = $5.055
  - `balance_outstanding` = $0
  - `status` = 'paid'
  - `paid_date` = 2026-02-10

**Validation Queries:**
```sql
-- Check invoice
SELECT 
  invoice_month,
  platform_fees_due,
  performance_fees_due,
  exchange_fees_paid,
  total_fees_due,
  total_fees_paid,
  balance_outstanding,
  status,
  due_date,
  paid_date
FROM lth_pvr.fee_invoices
WHERE customer_id = 999 AND invoice_month = '2026-01-01';
```

**Status:** ⏳ PENDING (awaiting Phase 4 implementation)

---

## LAYER 2: Back-Tester Validation Tests

### TC2.1: Run Back-Test with Fees Enabled → Compare Live Trading Result ✅

**Objective:** Verify live trading fee calculations match back-tester results

**Test Setup:**
- Back-test parameters:
  - Date range: 2025-01-01 to 2025-12-31
  - Upfront contribution: $1,000
  - Monthly contribution: $500
  - Performance fee: 10%
  - Platform fee: 0.75%
  - VALR conversion fee: 0.18%
  - VALR trade fee: 8 bps (0.08%)

**Test Steps:**
1. Run back-test via public website back-test tool
2. Save results: Final NAV, total fees paid, ROI, CAGR
3. Replicate same scenario in live trading with test customer:
   - Initial deposit: $1,000 on 2025-01-01
   - Monthly deposits: $500 on 1st of each month
   - Let strategy trade for 12 months
4. Compare live trading results to back-test results

**Expected Results:**
- ✅ Final NAV matches within $50 (accounts for execution timing differences)
- ✅ Total platform fees match within $5
- ✅ Total performance fees match within 10%
- ✅ ROI matches within 2 percentage points
- ✅ CAGR matches within 1 percentage point

**Validation Queries:**
```sql
-- Back-test results
SELECT 
  nav_usd,
  contrib_net_usdt_cum,
  fees_cum_usdt,
  total_roi_percent,
  cagr_percent
FROM lth_pvr_bt.bt_results_daily
WHERE bt_run_id = '<back_test_run_id>' AND result_date = '2025-12-31';

-- Live trading results
SELECT 
  nav_usd,
  contrib_net_usdt_cum,
  platform_fees_paid_cum + performance_fees_paid_cum AS total_fees,
  ((nav_usd - contrib_net_usdt_cum) / contrib_net_usdt_cum) * 100 AS roi_percent
FROM lth_pvr.balances_daily
WHERE customer_id = 999 AND date = '2025-12-31';

-- Calculate CAGR manually (live trading doesn't store CAGR)
SELECT 
  POWER((nav_usd / contrib_net_usdt_cum), (365.0 / DATE_PART('day', '2025-12-31'::date - '2025-01-01'::date))) - 1.0 AS cagr
FROM lth_pvr.balances_daily
WHERE customer_id = 999 AND date = '2025-12-31';
```

**Status:** ⏳ PENDING (requires 12 months of live trading data)  
**Alternative:** Use historical data from Customer 31 (if fees added retroactively)

---

### TC2.2: Platform Fee NET vs GROSS → Verify Bug Fix ✅

**Objective:** Verify platform fee bug fix (NET vs GROSS calculation)

**Test Steps:**
1. Run back-test BEFORE bug fix:
   - $1,000 ZAR deposit at rate 18.50 = $54.05 GROSS USDT
   - OLD CODE: Platform fee = $54.05 × 0.0075 = $0.405 (charged on GROSS)
   - VALR fee = $54.05 × 0.0018 = $0.097
   - Customer receives = $54.05 - $0.405 - $0.097 = $53.55 USDT
2. Run back-test AFTER bug fix:
   - $1,000 ZAR deposit at rate 18.50 = $54.05 GROSS USDT
   - VALR fee = $54.05 × 0.0018 = $0.097
   - NET USDT = $54.05 - $0.097 = $53.95
   - NEW CODE: Platform fee = $53.95 × 0.0075 = $0.405 (charged on NET)
   - Customer receives = $53.95 - $0.405 = $53.55 USDT
3. Compare results

**Expected Results:**
- ✅ OLD CODE (bug): Platform fee $0.405 on GROSS $54.05
- ✅ NEW CODE (fix): Platform fee $0.405 on NET $53.95
- ✅ **Wait, both give same result?** Let me recalculate...
  - OLD: Fee = $54.05 × 0.0075 = $0.405, Customer = $54.05 - $0.405 - $0.097 = $53.55 ✅
  - NEW: Fee = $53.95 × 0.0075 = $0.405, Customer = $53.95 - $0.405 = $53.55 ✅
  - **SAME RESULT!** Bug fix doesn't change outcome in this example.
- ✅ **Real difference:** If VALR fee is 1% instead of 0.18%:
  - GROSS = $54.05, VALR fee = $0.54, NET = $53.51
  - OLD: Platform fee = $54.05 × 0.0075 = $0.405, Customer = $54.05 - $0.405 - $0.54 = $53.11 ❌
  - NEW: Platform fee = $53.51 × 0.0075 = $0.401, Customer = $53.51 - $0.401 = $53.11 ✅
  - **Platform fee is $0.004 higher in OLD code** (charges on GROSS before VALR fee)

**Validation:**
- ✅ Bug fix reduces platform fee by (VALR fee × platform fee rate)
- ✅ For 0.18% VALR fee and 0.75% platform fee: Difference = $54.05 × 0.0018 × 0.0075 = $0.0007 (negligible)
- ✅ For 1% VALR fee: Difference = $54.05 × 0.01 × 0.0075 = $0.004 (small but measurable)

**Status:** ⏳ PENDING (awaiting Phase 2 implementation)

---

### TC2.3: Performance Fee HWM Logic → Month-Boundary-Only Updates ✅

**Objective:** Verify performance fees only calculated on month boundaries (not daily)

**Test Steps:**
1. Run back-test with daily NAV tracking
2. Verify performance fee ledger entries only appear on 1st of month
3. Verify HWM only updates on 1st of month
4. Verify no mid-month performance fees (except interim fees for withdrawals)

**Expected Results:**
- ✅ Performance fee ledger entries: 12 entries (one per month) for 1-year back-test
- ✅ All performance fee dates: 1st of month
- ✅ HWM updates: Only on 1st of month (visible in bt_results_daily.high_water_mark_usd column)

**Validation Queries:**
```sql
-- Check performance fee timing
SELECT 
  result_date,
  COUNT(*) AS fee_count
FROM lth_pvr_bt.bt_ledger
WHERE bt_run_id = '<back_test_run_id>' AND kind = 'performance_fee'
GROUP BY result_date
ORDER BY result_date;
-- Expected: 12 rows, all on 1st of month

-- Check HWM updates (should only change on 1st of month)
SELECT 
  result_date,
  high_water_mark_usd,
  LAG(high_water_mark_usd) OVER (ORDER BY result_date) AS prev_hwm,
  high_water_mark_usd - LAG(high_water_mark_usd) OVER (ORDER BY result_date) AS hwm_change
FROM lth_pvr_bt.bt_results_daily
WHERE bt_run_id = '<back_test_run_id>' AND high_water_mark_usd IS NOT NULL
ORDER BY result_date;
-- Expected: HWM changes only on 1st of month (or NULL if no change)
```

**Status:** ⏳ PENDING

---

### TC2.4: Net Contributions Tracking → Excludes Performance Fees ✅

**Objective:** Verify net contributions calculation excludes performance fees (but includes platform fees)

**Formula:** `net_contributions = SUM(deposits) - SUM(withdrawals) - SUM(platform_fees)`

**Test Steps:**
1. Run back-test with:
   - Initial deposit: $1,000 (Day 1)
   - Monthly deposit: $500 (1st of each month)
   - Platform fees: $0.75 per deposit (0.75% of NET)
   - Performance fees: Variable (10% of profit)
2. Calculate expected net contributions:
   - Total deposits: $1,000 + ($500 × 12) = $7,000
   - Total platform fees: $7.50 + ($3.75 × 12) = $52.50
   - Net contributions (excluding performance fees): $7,000 - $52.50 = $6,947.50
3. Compare to back-tester result

**Expected Results:**
- ✅ `contrib_net_usdt_cum` = $6,947.50 (excludes performance fees, includes platform fees)
- ✅ `contrib_gross_usdt_cum` = $7,000 (total deposits before any fees)
- ✅ Performance fees NOT subtracted from net contributions

**Validation Queries:**
```sql
-- Back-test result
SELECT 
  contrib_gross_usdt_cum,   -- Should be $7,000
  contrib_net_usdt_cum,     -- Should be $6,947.50
  platform_fees_cum,        -- Should be $52.50
  performance_fees_cum      -- Should be > 0 (but not subtracted from net contrib)
FROM lth_pvr_bt.bt_results_daily
WHERE bt_run_id = '<back_test_run_id>' AND result_date = '2025-12-31';

-- Manual calculation
SELECT 
  SUM(CASE WHEN kind IN ('deposit', 'topup') THEN amount_usdt ELSE 0 END) AS total_deposits,
  SUM(CASE WHEN kind = 'platform_fee' THEN amount_usdt ELSE 0 END) AS total_platform_fees,
  SUM(CASE WHEN kind IN ('deposit', 'topup') THEN amount_usdt ELSE 0 END) +
  SUM(CASE WHEN kind = 'platform_fee' THEN amount_usdt ELSE 0 END) AS net_contributions
FROM lth_pvr_bt.bt_ledger
WHERE bt_run_id = '<back_test_run_id>';
-- Expected: net_contributions = $6,947.50
```

**Status:** ⏳ PENDING

---

## LAYER 3: Manual SQL Testing

### TC3.1: Performance Fee Formula Validation ✅

**Objective:** Verify HWM performance fee formula is correct

**Formula:**
```
IF (NAV > HWM + net_contributions_since_HWM) THEN
  performance_fee = (NAV - HWM - net_contributions_since_HWM) × performance_fee_rate
  new_HWM = NAV - net_contributions_since_HWM
ELSE
  performance_fee = 0
  HWM unchanged
END IF
```

**Test Cases:**

| Test | NAV | HWM | Net Contrib | Profit | Fee (10%) | New HWM | Pass/Fail |
|------|-----|-----|-------------|--------|-----------|---------|-----------|
| 3.1.1 | $200 | $150 | $30 | $20 | $2.00 | $170 | ⏳ |
| 3.1.2 | $180 | $150 | $30 | $0 | $0 | $150 | ⏳ |
| 3.1.3 | $100 | $150 | -$20 (withdrawal) | $0 | $0 | $150 | ⏳ |
| 3.1.4 | $500 | $150 | $200 | $150 | $15.00 | $300 | ⏳ |
| 3.1.5 | $150 | $150 | $0 | $0 | $0 | $150 | ⏳ |

**SQL Test Function:**
```sql
CREATE OR REPLACE FUNCTION test_performance_fee_formula(
  p_nav NUMERIC,
  p_hwm NUMERIC,
  p_net_contrib NUMERIC,
  p_fee_rate NUMERIC DEFAULT 0.10
)
RETURNS TABLE (
  profit NUMERIC,
  fee NUMERIC,
  new_hwm NUMERIC
) AS $$
BEGIN
  IF p_nav > p_hwm + p_net_contrib THEN
    RETURN QUERY SELECT 
      p_nav - p_hwm - p_net_contrib AS profit,
      (p_nav - p_hwm - p_net_contrib) * p_fee_rate AS fee,
      p_nav - p_net_contrib AS new_hwm;
  ELSE
    RETURN QUERY SELECT 
      0::NUMERIC AS profit,
      0::NUMERIC AS fee,
      p_hwm AS new_hwm;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Run test cases
SELECT '3.1.1' AS test, * FROM test_performance_fee_formula(200, 150, 30);
-- Expected: profit=$20, fee=$2.00, new_hwm=$170

SELECT '3.1.2' AS test, * FROM test_performance_fee_formula(180, 150, 30);
-- Expected: profit=$0, fee=$0, new_hwm=$150

SELECT '3.1.3' AS test, * FROM test_performance_fee_formula(100, 150, -20);
-- Expected: profit=$0, fee=$0, new_hwm=$150

SELECT '3.1.4' AS test, * FROM test_performance_fee_formula(500, 150, 200);
-- Expected: profit=$150, fee=$15.00, new_hwm=$300

SELECT '3.1.5' AS test, * FROM test_performance_fee_formula(150, 150, 0);
-- Expected: profit=$0, fee=$0, new_hwm=$150
```

**Status:** ⏳ PENDING

---

### TC3.2: Withdrawal Snapshot Insertion ✅

**Objective:** Verify withdrawal snapshot stores pre-withdrawal HWM state correctly

**Test Steps:**
1. Set initial HWM state: $150, net contrib $30
2. Trigger withdrawal request (simulates `ef_calculate_interim_performance_fee`)
3. Verify snapshot created with correct values
4. Verify HWM updated after snapshot

**SQL Test:**
```sql
-- Setup initial state
INSERT INTO lth_pvr.customer_state_daily (org_id, customer_id, trade_date, high_water_mark_usd, hwm_contrib_net_cum)
VALUES ('test-org', 999, '2026-02-15', 150.00, 30.00);

-- Simulate withdrawal fee calculation
DO $$
DECLARE
  v_withdrawal_request_id UUID := gen_random_uuid();
  v_current_nav NUMERIC := 200.00;
  v_hwm NUMERIC;
  v_contrib NUMERIC;
  v_profit NUMERIC;
  v_fee NUMERIC;
  v_new_hwm NUMERIC;
BEGIN
  -- Get current HWM state
  SELECT high_water_mark_usd, hwm_contrib_net_cum
  INTO v_hwm, v_contrib
  FROM lth_pvr.customer_state_daily
  WHERE customer_id = 999 AND trade_date = '2026-02-15';
  
  -- Calculate performance fee
  v_profit := v_current_nav - v_hwm - v_contrib;  -- $200 - $150 - $30 = $20
  v_fee := v_profit * 0.10;  -- $2.00
  v_new_hwm := v_current_nav - v_contrib;  -- $200 - $30 = $170
  
  -- Insert snapshot BEFORE updating HWM
  INSERT INTO lth_pvr.withdrawal_fee_snapshots (
    withdrawal_request_id, customer_id, snapshot_date,
    pre_withdrawal_hwm, pre_withdrawal_contrib_net_cum,
    calculated_performance_fee, new_hwm
  ) VALUES (
    v_withdrawal_request_id, 999, '2026-02-15',
    v_hwm, v_contrib, v_fee, v_new_hwm
  );
  
  -- Update HWM
  UPDATE lth_pvr.customer_state_daily
  SET high_water_mark_usd = v_new_hwm
  WHERE customer_id = 999 AND trade_date = '2026-02-15';
  
  RAISE NOTICE 'Snapshot created with HWM=%, fee=%, new_HWM=%', v_hwm, v_fee, v_new_hwm;
END $$;

-- Verify snapshot
SELECT * FROM lth_pvr.withdrawal_fee_snapshots WHERE customer_id = 999;
-- Expected: pre_withdrawal_hwm=$150, calculated_performance_fee=$2.00, new_hwm=$170

-- Verify HWM updated
SELECT high_water_mark_usd FROM lth_pvr.customer_state_daily WHERE customer_id = 999 AND trade_date = '2026-02-15';
-- Expected: $170
```

**Status:** ⏳ PENDING

---

### TC3.3: HWM Reversion on Withdrawal Cancellation ✅

**Objective:** Verify HWM reverts to pre-withdrawal value when withdrawal is cancelled

**Test Steps:**
1. Use snapshot from TC3.2 (pre_withdrawal_hwm = $150, new_hwm = $170)
2. Simulate withdrawal cancellation
3. Verify HWM reverted to $150
4. Verify snapshot deleted

**SQL Test:**
```sql
-- Simulate withdrawal cancellation
DO $$
DECLARE
  v_withdrawal_request_id UUID;
  v_snapshot RECORD;
BEGIN
  -- Get snapshot
  SELECT * INTO v_snapshot
  FROM lth_pvr.withdrawal_fee_snapshots
  WHERE customer_id = 999
  ORDER BY snapshot_date DESC LIMIT 1;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No snapshot found for customer 999';
  END IF;
  
  -- Revert HWM to pre-withdrawal state
  UPDATE lth_pvr.customer_state_daily
  SET 
    high_water_mark_usd = v_snapshot.pre_withdrawal_hwm,
    hwm_contrib_net_cum = v_snapshot.pre_withdrawal_contrib_net_cum
  WHERE customer_id = 999 AND trade_date = v_snapshot.snapshot_date;
  
  -- Delete snapshot
  DELETE FROM lth_pvr.withdrawal_fee_snapshots
  WHERE withdrawal_request_id = v_snapshot.withdrawal_request_id;
  
  RAISE NOTICE 'HWM reverted from % to %', v_snapshot.new_hwm, v_snapshot.pre_withdrawal_hwm;
END $$;

-- Verify HWM reverted
SELECT high_water_mark_usd FROM lth_pvr.customer_state_daily WHERE customer_id = 999 AND trade_date = '2026-02-15';
-- Expected: $150 (reverted)

-- Verify snapshot deleted
SELECT COUNT(*) FROM lth_pvr.withdrawal_fee_snapshots WHERE customer_id = 999;
-- Expected: 0
```

**Status:** ⏳ PENDING

---

### TC3.4: Invoice Query - Overdue Invoices ✅

**Objective:** Verify overdue invoice query returns correct results

**Test Steps:**
1. Insert test invoices with different due dates and statuses
2. Run overdue query (due_date < CURRENT_DATE AND status != 'paid')
3. Verify only overdue unpaid invoices returned

**SQL Test:**
```sql
-- Insert test invoices
INSERT INTO lth_pvr.fee_invoices (
  org_id, customer_id, invoice_month, invoice_date,
  platform_fees_due, performance_fees_due,
  status, due_date
) VALUES
  -- Overdue, unpaid
  ('test-org', 999, '2025-12-01', '2026-01-01', 10.00, 50.00, 'pending', '2026-01-15'),
  -- Overdue, paid
  ('test-org', 999, '2026-01-01', '2026-02-01', 10.00, 50.00, 'paid', '2026-02-15'),
  -- Not yet due, unpaid
  ('test-org', 999, '2026-02-01', '2026-03-01', 10.00, 50.00, 'pending', '2026-03-15');

-- Query overdue invoices
SELECT 
  invoice_month,
  total_fees_due,
  balance_outstanding,
  status,
  due_date,
  CURRENT_DATE - due_date AS days_overdue
FROM lth_pvr.fee_invoices
WHERE due_date < CURRENT_DATE 
  AND status != 'paid'
ORDER BY due_date;

-- Expected: Only 1 row (December 2025 invoice, 5+ days overdue)
```

**Status:** ⏳ PENDING

---

## LAYER 4: Unit Tests (TypeScript with Deno)

### TC4.1: calculatePerformanceFee() - Edge Cases ✅

**Test File:** `supabase/functions/_shared/__tests__/performanceFees.test.ts`

**Test Cases:**
```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { calculatePerformanceFee } from "../performanceFees.ts";

Deno.test("Performance Fee - Profit above HWM", () => {
  const result = calculatePerformanceFee(
    200,   // current NAV
    150,   // HWM
    30,    // net contributions
    0.10   // fee rate (10%)
  );
  
  assertEquals(result.profit, 20);
  assertEquals(result.fee, 2.00);
  assertEquals(result.newHWM, 170);
});

Deno.test("Performance Fee - NAV equals HWM + contrib (no profit)", () => {
  const result = calculatePerformanceFee(180, 150, 30, 0.10);
  
  assertEquals(result.profit, 0);
  assertEquals(result.fee, 0);
  assertEquals(result.newHWM, 150);  // HWM unchanged
});

Deno.test("Performance Fee - NAV below HWM (loss)", () => {
  const result = calculatePerformanceFee(100, 150, -20, 0.10);
  
  assertEquals(result.profit, 0);
  assertEquals(result.fee, 0);
  assertEquals(result.newHWM, 150);  // HWM unchanged
});

Deno.test("Performance Fee - Zero NAV (edge case)", () => {
  const result = calculatePerformanceFee(0, 150, 0, 0.10);
  
  assertEquals(result.profit, 0);
  assertEquals(result.fee, 0);
  assertEquals(result.newHWM, 150);
});

Deno.test("Performance Fee - Negative NAV (impossible but test anyway)", () => {
  const result = calculatePerformanceFee(-50, 150, 0, 0.10);
  
  assertEquals(result.profit, 0);
  assertEquals(result.fee, 0);
  assertEquals(result.newHWM, 150);
});
```

**Status:** ⏳ PENDING (awaiting Phase 3 implementation)

---

### TC4.2: transferBetweenSubaccounts() - VALR API Mocking ✅

**Test File:** `supabase/functions/_shared/__tests__/valrTransfer.test.ts`

**Test Cases:**
```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { stub } from "https://deno.land/std@0.208.0/testing/mock.ts";
import { transferBetweenSubaccounts } from "../valrTransfer.ts";

Deno.test("VALR Transfer - Successful transfer", async () => {
  // Mock fetch to return successful response
  const fetchStub = stub(globalThis, "fetch", () => 
    Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
  );
  
  try {
    const result = await transferBetweenSubaccounts(
      "subaccount-123",
      "primary",
      "USDT",
      10.50
    );
    
    assertEquals(result.success, true);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("VALR Transfer - API error (insufficient balance)", async () => {
  const fetchStub = stub(globalThis, "fetch", () => 
    Promise.resolve(new Response(JSON.stringify({ error: "Insufficient balance" }), { status: 400 }))
  );
  
  try {
    let errorThrown = false;
    try {
      await transferBetweenSubaccounts("subaccount-123", "primary", "USDT", 10000.00);
    } catch (e) {
      errorThrown = true;
      assertEquals(e.message.includes("VALR transfer failed"), true);
    }
    assertEquals(errorThrown, true);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("VALR Transfer - Network timeout", async () => {
  const fetchStub = stub(globalThis, "fetch", () => 
    Promise.reject(new Error("Network request timeout"))
  );
  
  try {
    let errorThrown = false;
    try {
      await transferBetweenSubaccounts("subaccount-123", "primary", "USDT", 10.50);
    } catch (e) {
      errorThrown = true;
    }
    assertEquals(errorThrown, true);
  } finally {
    fetchStub.restore();
  }
});
```

**Status:** ⏳ PENDING (awaiting Phase 2 implementation)

---

### TC4.3: autoConvertBTCtoUSDT() - Slippage Buffer Calculation ✅

**Test File:** `supabase/functions/_shared/__tests__/btcConversion.test.ts`

**Test Cases:**
```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { calculateBTCConversionAmount } from "../btcConversion.ts";

Deno.test("BTC Conversion - 2% slippage buffer", () => {
  const result = calculateBTCConversionAmount(
    500,      // target USDT
    50000,    // BTC price
    0.02      // 2% slippage buffer
  );
  
  // Expected: 500 / 50000 = 0.01 BTC, + 2% = 0.0102 BTC
  assertEquals(result.btcRequired, 0.01);
  assertEquals(result.btcWithBuffer, 0.0102);
  assertEquals(result.bufferBTC, 0.0002);
});

Deno.test("BTC Conversion - Zero slippage buffer", () => {
  const result = calculateBTCConversionAmount(500, 50000, 0);
  
  assertEquals(result.btcRequired, 0.01);
  assertEquals(result.btcWithBuffer, 0.01);
  assertEquals(result.bufferBTC, 0);
});

Deno.test("BTC Conversion - 5% slippage buffer (higher volatility)", () => {
  const result = calculateBTCConversionAmount(1000, 50000, 0.05);
  
  // 1000 / 50000 = 0.02 BTC, + 5% = 0.021 BTC
  assertEquals(result.btcRequired, 0.02);
  assertEquals(result.btcWithBuffer, 0.021);
  assertEquals(result.bufferBTC, 0.001);
});

Deno.test("BTC Conversion - Very small amount (rounding test)", () => {
  const result = calculateBTCConversionAmount(1, 50000, 0.02);
  
  // 1 / 50000 = 0.00002 BTC, + 2% = 0.0000204 BTC
  assertEquals(result.btcRequired, 0.00002);
  assertEquals(result.btcWithBuffer, 0.0000204);
});
```

**Status:** ⏳ PENDING (awaiting Phase 4 implementation)

---

## Test Execution Timeline

| Phase | Layer | Duration | Tests | Start Date | Completion |
|-------|-------|----------|-------|------------|------------|
| 0 | Analysis | 3 days | N/A | 2026-01-20 | 2026-01-23 ⏳ |
| 1 | Schema | 2 days | TC3.1-3.4 (SQL) | 2026-01-24 | 2026-01-26 ⏳ |
| 2 | Platform Fees | 2 days | TC1.1-1.2, TC2.2 | 2026-01-27 | 2026-01-29 ⏳ |
| 3 | Performance Fees | 3 days | TC1.3-1.6, TC2.1, TC2.3-2.4, TC4.1 | 2026-01-30 | 2026-02-02 ⏳ |
| 4 | Conversion & Invoicing | 3 days | TC1.7-1.8, TC4.2-4.3 | 2026-02-03 | 2026-02-06 ⏳ |
| 5 | Integration | 2 days | Full end-to-end | 2026-02-07 | 2026-02-09 ⏳ |

**Total Duration:** 15 days  
**Production Deployment:** 2026-02-10

---

## Test Reporting

**Status Codes:**
- ✅ **PASS** - Test passed, verified working correctly
- ❌ **FAIL** - Test failed, bug identified, fix required
- ⏳ **PENDING** - Test not yet executed (awaiting implementation)
- ⚠️ **BLOCKED** - Test blocked by dependency (needs clarification or prerequisite)
- ⏭️ **SKIP** - Test skipped (not applicable or deprecated)

**Bug Tracking:**
All test failures will be logged in `lth_pvr.alert_events` with:
- `component` = 'task_5_testing'
- `severity` = 'error'
- `message` = "Test TC{X.Y} failed: {reason}"
- `context` = JSON with test details

**Test Summary Report:**
```sql
-- Generate test summary
SELECT 
  'Layer 1' AS layer,
  COUNT(*) AS total_tests,
  SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) AS passed,
  SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
  ROUND(100.0 * SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) / COUNT(*), 1) AS pass_rate
FROM test_results WHERE layer = 'layer1'
UNION ALL
SELECT 'Layer 2', COUNT(*), 
  SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END),
  SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END),
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),
  ROUND(100.0 * SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) / COUNT(*), 1)
FROM test_results WHERE layer = 'layer2'
-- ... repeat for layers 3 and 4
```

---

**Document Status:** Complete  
**Total Test Cases:** 20 (8 Layer 1, 4 Layer 2, 4 Layer 3, 4 Layer 4)  
**Next Review:** After Phase 0 complete (2026-01-23)
