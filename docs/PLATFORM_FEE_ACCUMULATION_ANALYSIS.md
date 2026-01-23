# Platform Fee Accumulation - System-Wide Impact Analysis

**Created:** 2026-01-23  
**Status:** 🔴 CRITICAL GAP IDENTIFIED - Requires Implementation  
**Context:** TC1.2 testing revealed failed BTC platform fee transfer (0.00000058 BTC / 5.8 satoshis) due to VALR minimum transfer threshold

---

## Executive Summary

**Current Behavior:**
- ✅ Platform fees calculated correctly (0.75% with 8-decimal precision)
- ❌ Every deposit triggers immediate transfer attempt (regardless of amount)
- ❌ Failed transfers logged but NOT accumulated
- ❌ No minimum threshold checking
- ❌ No automated retry mechanism
- ❌ Fees remain on customer subaccount indefinitely

**Business Impact:**
- 🔴 Revenue leakage: Small fees never transferred (lost)
- 🔴 Accounting mismatch: Fees recorded but not collected
- 🔴 Customer confusion: Balance includes untransferred fees
- 🔴 Withdrawal blocking: Can't distinguish between customer balance and accumulated fees
- 🔴 Balance reconciliation: Will flag perpetual discrepancies

**Required Before Production:** ✅ YES (blocking issue)

---

## Problem Analysis

### 1. VALR Minimum Transfer Thresholds (RESEARCH NEEDED)

**Current Knowledge:** ❓ UNDOCUMENTED

**Likely Minimums (based on industry standards):**
- BTC: 0.0001 BTC (10,000 satoshis) = ~$10 USD @ $100k/BTC
- USDT: $10 - $50 USD
- ZAR: R 100 - R 500

**Action Required:**
1. Check VALR API documentation: https://docs.valr.com/
2. Test manually with small transfers (0.00001 BTC, $1 USDT)
3. Document exact minimums in code comments
4. Add to configuration table: `lth_pvr.system_config`

**Test Results (from TC1.2):**
- 0.00000058 BTC (5.8 sats) = ❌ FAILED ("Invalid Request")
- 0.05732531 USDT = ✅ SUCCESS (transfer ID: 8131e539-1fbd-4846-b2a4-3890c22f49f4)

**Estimated Minimums:**
- BTC: >= 0.0001 BTC (10,000 sats)
- USDT: >= $1.00 (TC1.2 success suggests threshold is below $0.06)

---

## System-Wide Impact Analysis

### 2. Database Schema - Tracking Accumulated Fees

**Current State:**
```sql
-- lth_pvr.valr_transfer_log tracks ATTEMPTED transfers
CREATE TABLE lth_pvr.valr_transfer_log (
  transfer_id UUID PRIMARY KEY,
  customer_id BIGINT,
  currency TEXT,
  amount NUMERIC(20,8),
  status TEXT CHECK (status IN ('pending', 'completed', 'failed')),
  error_message TEXT,
  ...
);
```

**Gap:** No aggregated view of "accumulated untransferred fees per customer"

**Required:**
1. **Option A: New Table (Recommended)**
   ```sql
   CREATE TABLE lth_pvr.customer_accumulated_fees (
     customer_id BIGINT PRIMARY KEY,
     org_id UUID NOT NULL,
     btc_accumulated NUMERIC(20,8) NOT NULL DEFAULT 0,
     usdt_accumulated NUMERIC(20,8) NOT NULL DEFAULT 0,
     last_btc_transfer_attempt TIMESTAMPTZ,
     last_usdt_transfer_attempt TIMESTAMPTZ,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   ```

2. **Option B: Computed View (Simpler but slower)**
   ```sql
   CREATE VIEW lth_pvr.v_accumulated_fees AS
   SELECT 
     customer_id,
     SUM(CASE WHEN currency='BTC' AND status='failed' THEN amount ELSE 0 END) AS btc_accumulated,
     SUM(CASE WHEN currency='USDT' AND status='failed' THEN amount ELSE 0 END) AS usdt_accumulated
   FROM lth_pvr.valr_transfer_log
   WHERE transfer_type = 'platform_fee'
   GROUP BY customer_id;
   ```

**Recommendation:** **Option A** (dedicated table) for performance and clarity

---

### 3. Balance Reconciliation Impact

**Current Logic (ef_balance_reconciliation):**
```typescript
// Expected VALR balance = customer ledger balance + pending fees (not yet transferred)
const expectedVALR_BTC = recordedBTC + pendingFeeBTC;
const expectedVALR_USDT = recordedUSDT + pendingFeeUSDT;

// pendingFeeBTC = SUM of valr_transfer_log WHERE status != 'completed'
```

**Problem:**
- ✅ Correctly accounts for failed transfers in reconciliation
- ❌ BUT perpetual discrepancy if fees never transferred (accumulate forever)
- ❌ Tolerance thresholds (0.00000001 BTC, 0.01 USDT) will eventually be exceeded

**Example Scenario:**
1. Customer makes 100 small BTC deposits (0.0001 BTC each)
2. Each has 0.00000075 BTC fee (7.5 sats)
3. Total accumulated: 0.000075 BTC (75 sats) - still below minimum?
4. Reconciliation: `expectedVALR_BTC = recordedBTC + 0.000075`
5. **Forever shows discrepancy until transferred**

**Solution:**
- When accumulated fees >= minimum threshold → trigger batch transfer
- Clear `accumulated_fees` table after successful transfer
- Reconciliation then expects: `expectedVALR_BTC = recordedBTC + 0` (no pending fees)

---

### 4. Transaction History Display (Customer Portal)

**Current Implementation:**
```html
<!-- website/customer-portal.html -->
<th>Platform Fee (BTC)</th>
<th>Platform Fee (USDT)</th>
```

```javascript
// Color coding: Orange for fees > 0
const platformFeeBtcColor = parseFloat(tx.platform_fee_btc || 0) > 0 ? '#f59e0b' : '#64748b';
```

**Gap:** No indication whether fee was successfully transferred or still pending

**User Experience Problem:**
- Customer sees: "Platform Fee: 0.00000058 BTC"
- Customer thinks: "I paid this fee"
- Reality: Fee still on their subaccount (not transferred due to minimum threshold)
- Result: **Confusion and distrust**

**Proposed Enhancement:**
```html
<th>Platform Fee (BTC)</th>
<th>Status</th> <!-- NEW -->
```

```javascript
// Query joined with valr_transfer_log
const { data: transactions } = await supabase.rpc('list_customer_transactions_with_fee_status');

// Display logic
const feeStatus = tx.platform_fee_transfer_status; // 'transferred', 'pending', 'accumulated'
const statusBadge = feeStatus === 'transferred' 
  ? '<span class="badge-green">✓ Transferred</span>'
  : feeStatus === 'pending'
  ? '<span class="badge-yellow">⏳ Pending Transfer</span>'
  : '<span class="badge-blue">📦 Accumulated</span>';
```

**Customer-Friendly Explanation:**
```html
<div class="info-box">
  <h4>About Platform Fees</h4>
  <p>
    Platform fees below R 10 (or 0.0001 BTC) are accumulated on your account 
    and transferred to BitWealth when they reach the minimum transfer threshold.
  </p>
  <p>
    Current accumulated fees: 
    <strong>0.00007500 BTC</strong> (7.5% of minimum threshold)
  </p>
  <p>
    Your withdrawable balance excludes these accumulated fees.
  </p>
</div>
```

---

### 5. Monthly Invoices & Statements

**Current Invoice Schema (from Phase 1 design):**
```sql
CREATE TABLE lth_pvr.fee_invoices (
  invoice_id UUID PRIMARY KEY,
  customer_id BIGINT,
  invoice_month DATE,  -- First day of month
  platform_fees_due NUMERIC(20,8),      -- Total charged
  performance_fees_due NUMERIC(20,8),
  total_fees_due NUMERIC(20,8),
  total_fees_paid NUMERIC(20,8),        -- Total collected
  balance_outstanding NUMERIC(20,8),
  status TEXT CHECK (status IN ('pending', 'paid', 'overdue')),
  ...
);
```

**Gap:** `platform_fees_due` vs `platform_fees_collected` distinction missing

**Required Columns:**
```sql
ALTER TABLE lth_pvr.fee_invoices
  ADD COLUMN platform_fees_transferred NUMERIC(20,8) DEFAULT 0,
  ADD COLUMN platform_fees_accumulated NUMERIC(20,8) DEFAULT 0;

-- Logic:
-- platform_fees_due = Total charged in ledger
-- platform_fees_transferred = SUM(valr_transfer_log WHERE status='completed')
-- platform_fees_accumulated = platform_fees_due - platform_fees_transferred
```

**Invoice Display:**
```
╔══════════════════════════════════════════════════════════════╗
║  BitWealth Monthly Fee Invoice - January 2026               ║
╠══════════════════════════════════════════════════════════════╣
║  Platform Fees (0.75%)                                       ║
║    Charged:                          R 125.50                ║
║    Transferred to BitWealth:         R 120.00  ✓             ║
║    Accumulated (pending transfer):   R   5.50  📦            ║
║                                                               ║
║  Performance Fees (10%)                                      ║
║    Charged:                          R 450.00                ║
║    Transferred to BitWealth:         R 450.00  ✓             ║
║                                                               ║
║  Total Fees Due:                     R 575.50                ║
║  Total Fees Collected:               R 570.00                ║
║  Accumulated (will transfer):        R   5.50                ║
╚══════════════════════════════════════════════════════════════╝
```

**Accounting Impact:**
- **Accrual Basis:** Recognize revenue when charged (even if not transferred)
- **Cash Basis:** Recognize revenue when transferred (when collected)
- **BitWealth should use accrual basis** (fees charged = revenue, regardless of transfer status)
- **Accumulated fees = Accounts Receivable** (money owed but not yet collected)

---

### 6. Withdrawable Balance Calculation

**Critical Issue:** Customer balance includes accumulated fees (not theirs to withdraw)

**Current Balance Display:**
```javascript
// website/customer-portal.html
const { data: balance } = await supabase.rpc('get_customer_dashboard');

// Shows: BTC: 0.00123456, USDT: 125.50
// But includes accumulated fees!
```

**Problem Scenario:**
1. Customer has: 0.001 BTC + accumulated fees 0.00007500 BTC
2. VALR subaccount shows: 0.00107500 BTC (total)
3. Customer tries to withdraw: "All funds" → 0.00107500 BTC
4. Withdrawal includes BitWealth's accumulated fees (WRONG!)

**Required: Adjusted Balance Calculation**
```sql
CREATE OR REPLACE FUNCTION lth_pvr.get_withdrawable_balance(
  p_customer_id BIGINT
) RETURNS TABLE (
  btc_total NUMERIC,
  btc_accumulated_fees NUMERIC,
  btc_withdrawable NUMERIC,
  usdt_total NUMERIC,
  usdt_accumulated_fees NUMERIC,
  usdt_withdrawable NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.btc_balance AS btc_total,
    COALESCE(af.btc_accumulated, 0) AS btc_accumulated_fees,
    b.btc_balance - COALESCE(af.btc_accumulated, 0) AS btc_withdrawable,
    b.usdt_balance AS usdt_total,
    COALESCE(af.usdt_accumulated, 0) AS usdt_accumulated_fees,
    b.usdt_balance - COALESCE(af.usdt_accumulated, 0) AS usdt_withdrawable
  FROM lth_pvr.balances_daily b
  LEFT JOIN lth_pvr.customer_accumulated_fees af USING (customer_id)
  WHERE b.customer_id = p_customer_id
    AND b.date = CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Portal Display:**
```html
<div class="balance-card">
  <h3>BTC Balance</h3>
  <div class="balance-total">0.00107500 BTC</div>
  <div class="balance-breakdown">
    <span>Your balance: 0.00100000 BTC</span>
    <span class="text-muted">Accumulated fees: 0.00007500 BTC</span>
  </div>
  <div class="balance-withdrawable">
    <strong>Available to withdraw: 0.00100000 BTC</strong>
  </div>
</div>
```

---

### 7. Withdrawal Request Flow

**Current Flow (planned but not implemented):**
1. Customer submits withdrawal request
2. Admin approves
3. BTC sold → ZAR
4. ZAR transferred to bank

**Required Enhancement:**
```javascript
// ef_withdrawal_request_submit (NEW logic)

// 1. Get withdrawable balance (excluding accumulated fees)
const { data: balance } = await supabase.rpc('get_withdrawable_balance', {
  p_customer_id: customerId
});

// 2. Validate withdrawal amount
if (withdrawalAmount > balance.usdt_withdrawable) {
  return {
    error: 'Insufficient balance',
    details: {
      requested: withdrawalAmount,
      available: balance.usdt_withdrawable,
      accumulated_fees: balance.usdt_accumulated_fees,
      message: `You have ${balance.usdt_accumulated_fees} USDT in accumulated platform fees that will be transferred to BitWealth when they reach the minimum threshold.`
    }
  };
}

// 3. BEFORE processing withdrawal: Transfer accumulated fees if >= minimum
if (balance.btc_accumulated_fees >= MINIMUM_BTC_TRANSFER) {
  await transferToMainAccount({
    fromSubaccountId: subaccountId,
    currency: 'BTC',
    amount: balance.btc_accumulated_fees,
    transferType: 'platform_fee'
  });
  
  // Clear accumulated fees after successful transfer
  await supabase
    .from('customer_accumulated_fees')
    .update({ btc_accumulated: 0 })
    .eq('customer_id', customerId);
}

// 4. Process withdrawal (now using correct withdrawable balance)
```

**User Communication:**
```
Withdrawal Request: R 10,000

Your current balance:
  Total USDT:           125.50 USDT
  Accumulated fees:       5.50 USDT
  Available to withdraw: 120.00 USDT (~R 9,580)

Your withdrawal request of R 10,000 exceeds your available balance.
Would you like to withdraw R 9,580 instead?

Note: The 5.50 USDT in accumulated platform fees will be transferred 
to BitWealth when they reach the minimum threshold of $10 USDT.
```

---

## Implementation Plan

### Phase 1: Research & Configuration (2 days)

**1.1 Determine VALR Minimum Transfer Thresholds**
- [ ] Review VALR API docs: https://docs.valr.com/
- [ ] Test small transfers (0.00001 BTC, $1 USDT, R 10 ZAR)
- [ ] Document exact minimums in code

**1.2 Create System Configuration Table**
```sql
CREATE TABLE lth_pvr.system_config (
  config_key TEXT PRIMARY KEY,
  config_value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO lth_pvr.system_config (config_key, config_value, description) VALUES
('valr_min_transfer_btc', '"0.0001"', 'Minimum BTC transfer amount (10,000 sats)'),
('valr_min_transfer_usdt', '"10.00"', 'Minimum USDT transfer amount ($10)'),
('valr_min_transfer_zar', '"100.00"', 'Minimum ZAR transfer amount (R100)');
```

---

### Phase 2: Database Schema Changes (1 day)

**2.1 Create Accumulated Fees Table**
```sql
-- Migration: 20260124_add_customer_accumulated_fees.sql

CREATE TABLE lth_pvr.customer_accumulated_fees (
  customer_id BIGINT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.orgs(org_id),
  btc_accumulated NUMERIC(20,8) NOT NULL DEFAULT 0,
  usdt_accumulated NUMERIC(20,8) NOT NULL DEFAULT 0,
  last_btc_transfer_attempt TIMESTAMPTZ,
  last_usdt_transfer_attempt TIMESTAMPTZ,
  last_btc_transfer_success TIMESTAMPTZ,
  last_usdt_transfer_success TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (customer_id) REFERENCES public.customer_details(customer_id)
);

CREATE INDEX idx_accumulated_fees_customer ON lth_pvr.customer_accumulated_fees(customer_id);
CREATE INDEX idx_accumulated_fees_btc ON lth_pvr.customer_accumulated_fees(btc_accumulated) WHERE btc_accumulated > 0;
CREATE INDEX idx_accumulated_fees_usdt ON lth_pvr.customer_accumulated_fees(usdt_accumulated) WHERE usdt_accumulated > 0;

COMMENT ON TABLE lth_pvr.customer_accumulated_fees IS 
'Tracks platform fees below VALR minimum transfer threshold. Updated by ef_post_ledger_and_balances. Cleared when transferred.';
```

**2.2 Enhance Fee Invoices Table**
```sql
-- Migration: 20260124_enhance_fee_invoices.sql

ALTER TABLE lth_pvr.fee_invoices
  ADD COLUMN platform_fees_transferred NUMERIC(20,8) DEFAULT 0,
  ADD COLUMN platform_fees_accumulated NUMERIC(20,8) DEFAULT 0;

COMMENT ON COLUMN lth_pvr.fee_invoices.platform_fees_transferred IS 'Platform fees successfully transferred to main account';
COMMENT ON COLUMN lth_pvr.fee_invoices.platform_fees_accumulated IS 'Platform fees below minimum threshold (not yet transferred)';
```

**2.3 Create RPC Functions**
```sql
-- Function: Get withdrawable balance
CREATE OR REPLACE FUNCTION lth_pvr.get_withdrawable_balance(p_customer_id BIGINT)
RETURNS TABLE (
  btc_total NUMERIC,
  btc_accumulated_fees NUMERIC,
  btc_withdrawable NUMERIC,
  usdt_total NUMERIC,
  usdt_accumulated_fees NUMERIC,
  usdt_withdrawable NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.btc_balance AS btc_total,
    COALESCE(af.btc_accumulated, 0) AS btc_accumulated_fees,
    b.btc_balance - COALESCE(af.btc_accumulated, 0) AS btc_withdrawable,
    b.usdt_balance AS usdt_total,
    COALESCE(af.usdt_accumulated, 0) AS usdt_accumulated_fees,
    b.usdt_balance - COALESCE(af.usdt_accumulated, 0) AS usdt_withdrawable
  FROM lth_pvr.balances_daily b
  LEFT JOIN lth_pvr.customer_accumulated_fees af USING (customer_id)
  WHERE b.customer_id = p_customer_id
    AND b.date = CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION lth_pvr.get_withdrawable_balance TO authenticated, anon;
```

---

### Phase 3: Edge Function Updates (3 days)

**3.1 Update ef_post_ledger_and_balances**

Add threshold checking BEFORE transfer attempt:

```typescript
// supabase/functions/ef_post_ledger_and_balances/index.ts

// Get VALR minimum transfer thresholds from config
const { data: config } = await sb
  .from("system_config")
  .select("config_value")
  .in("config_key", ["valr_min_transfer_btc", "valr_min_transfer_usdt"]);

const minBTC = parseFloat(config.find(c => c.config_key === "valr_min_transfer_btc").config_value);
const minUSDT = parseFloat(config.find(c => c.config_key === "valr_min_transfer_usdt").config_value);

// Transfer BTC platform fee if > 0 AND >= minimum threshold
if (feeBtc > 0) {
  if (feeBtc >= minBTC) {
    // Attempt transfer
    const transferResult = await transferToMainAccount(...);
    
    if (transferResult.success) {
      // Clear accumulated fees (if any) after successful transfer
      await sb
        .from("customer_accumulated_fees")
        .update({ 
          btc_accumulated: 0,
          last_btc_transfer_success: new Date().toISOString()
        })
        .eq("customer_id", customerId);
    } else {
      // Add to accumulated fees
      await sb.rpc("accumulate_platform_fee", {
        p_customer_id: customerId,
        p_currency: "BTC",
        p_amount: feeBtc
      });
    }
  } else {
    // Below minimum threshold - accumulate without attempting transfer
    console.log(`BTC platform fee ${feeBtc} below minimum ${minBTC} - accumulating`);
    
    await sb.rpc("accumulate_platform_fee", {
      p_customer_id: customerId,
      p_currency: "BTC",
      p_amount: feeBtc
    });
  }
}
```

**3.2 Create accumulate_platform_fee RPC**
```sql
CREATE OR REPLACE FUNCTION lth_pvr.accumulate_platform_fee(
  p_customer_id BIGINT,
  p_currency TEXT,
  p_amount NUMERIC
) RETURNS VOID AS $$
BEGIN
  INSERT INTO lth_pvr.customer_accumulated_fees (customer_id, org_id, btc_accumulated, usdt_accumulated)
  VALUES (
    p_customer_id,
    (SELECT org_id FROM public.customer_details WHERE customer_id = p_customer_id),
    CASE WHEN p_currency = 'BTC' THEN p_amount ELSE 0 END,
    CASE WHEN p_currency = 'USDT' THEN p_amount ELSE 0 END
  )
  ON CONFLICT (customer_id) DO UPDATE SET
    btc_accumulated = lth_pvr.customer_accumulated_fees.btc_accumulated + 
      CASE WHEN p_currency = 'BTC' THEN p_amount ELSE 0 END,
    usdt_accumulated = lth_pvr.customer_accumulated_fees.usdt_accumulated + 
      CASE WHEN p_currency = 'USDT' THEN p_amount ELSE 0 END,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**3.3 Create ef_transfer_accumulated_fees (NEW)**

Monthly cron job (1st of month at 02:00 UTC):

```typescript
// supabase/functions/ef_transfer_accumulated_fees/index.ts

Deno.serve(async () => {
  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  
  // Get system config for minimum thresholds
  const { data: config } = await sb
    .from("system_config")
    .select("*")
    .in("config_key", ["valr_min_transfer_btc", "valr_min_transfer_usdt"]);
  
  const minBTC = parseFloat(config.find(c => c.config_key === "valr_min_transfer_btc").config_value);
  const minUSDT = parseFloat(config.find(c => c.config_key === "valr_min_transfer_usdt").config_value);
  
  // Get customers with accumulated fees >= minimum threshold
  const { data: customers } = await sb
    .from("customer_accumulated_fees")
    .select("*")
    .eq("org_id", org_id)
    .or(`btc_accumulated.gte.${minBTC},usdt_accumulated.gte.${minUSDT}`);
  
  let transferred = 0;
  let failed = 0;
  
  for (const customer of customers ?? []) {
    // Get exchange account
    const { data: exchangeAcct } = await sb
      .from("customer_strategies")
      .select("exchange_account_id, exchange_accounts(subaccount_id)")
      .eq("customer_id", customer.customer_id)
      .eq("strategy_code", "LTH_PVR")
      .single();
    
    if (!exchangeAcct) continue;
    
    // Transfer BTC if >= minimum
    if (customer.btc_accumulated >= minBTC) {
      const result = await transferToMainAccount(
        sb,
        {
          fromSubaccountId: exchangeAcct.exchange_accounts.subaccount_id,
          toAccount: "0", // main
          currency: "BTC",
          amount: customer.btc_accumulated,
          transferType: "platform_fee"
        },
        customer.customer_id
      );
      
      if (result.success) {
        await sb
          .from("customer_accumulated_fees")
          .update({ 
            btc_accumulated: 0,
            last_btc_transfer_success: new Date().toISOString()
          })
          .eq("customer_id", customer.customer_id);
        
        transferred++;
      } else {
        failed++;
      }
    }
    
    // Transfer USDT if >= minimum
    if (customer.usdt_accumulated >= minUSDT) {
      const result = await transferToMainAccount(
        sb,
        {
          fromSubaccountId: exchangeAcct.exchange_accounts.subaccount_id,
          toAccount: "0",
          currency: "USDT",
          amount: customer.usdt_accumulated,
          transferType: "platform_fee"
        },
        customer.customer_id
      );
      
      if (result.success) {
        await sb
          .from("customer_accumulated_fees")
          .update({ 
            usdt_accumulated: 0,
            last_usdt_transfer_success: new Date().toISOString()
          })
          .eq("customer_id", customer.customer_id);
        
        transferred++;
      } else {
        failed++;
      }
    }
  }
  
  return new Response(JSON.stringify({
    status: "ok",
    transferred,
    failed,
    total_customers: customers?.length || 0
  }));
});
```

**3.4 Add pg_cron Job**
```sql
-- Run monthly on 1st at 02:00 UTC (before fee invoicing at 02:30)
SELECT cron.schedule(
  'transfer-accumulated-fees-monthly',
  '0 2 1 * *',  -- At 02:00 on day 1 of every month
  $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_transfer_accumulated_fees',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key') || '"}'::jsonb
  );
  $$
);
```

---

### Phase 4: Customer Portal Updates (2 days)

**4.1 Update Dashboard Balance Display**
```javascript
// website/customer-portal.html

async function loadDashboard() {
  // Get withdrawable balance (excludes accumulated fees)
  const { data: balance, error } = await supabase
    .rpc('get_withdrawable_balance', { p_customer_id: customerId });
  
  if (error) throw error;
  
  // Display with breakdown
  document.getElementById('btc-total').textContent = balance.btc_total.toFixed(8);
  document.getElementById('btc-withdrawable').textContent = balance.btc_withdrawable.toFixed(8);
  document.getElementById('btc-accumulated').textContent = balance.btc_accumulated_fees.toFixed(8);
  
  document.getElementById('usdt-total').textContent = balance.usdt_total.toFixed(2);
  document.getElementById('usdt-withdrawable').textContent = balance.usdt_withdrawable.toFixed(2);
  document.getElementById('usdt-accumulated').textContent = balance.usdt_accumulated_fees.toFixed(2);
}
```

```html
<div class="balance-card">
  <h3>BTC Balance</h3>
  <div class="balance-total" id="btc-total">0.00000000</div>
  <div class="balance-breakdown">
    <div class="balance-row">
      <span>Your balance:</span>
      <strong id="btc-withdrawable">0.00000000 BTC</strong>
    </div>
    <div class="balance-row text-muted">
      <span>Accumulated fees:</span>
      <span id="btc-accumulated">0.00000000 BTC</span>
      <span class="info-icon" title="Platform fees below 0.0001 BTC accumulate and are transferred monthly">ℹ️</span>
    </div>
  </div>
</div>
```

**4.2 Update Transaction History**
```sql
-- Update public.list_customer_transactions RPC
ALTER FUNCTION public.list_customer_transactions 
  ADD COLUMN platform_fee_status TEXT;  -- 'transferred', 'accumulated', 'pending'

-- Join with valr_transfer_log to get transfer status
```

```html
<table>
  <thead>
    <tr>
      <th>Date</th>
      <th>Type</th>
      <th>BTC</th>
      <th>USDT</th>
      <th>Platform Fee (BTC)</th>
      <th>Fee Status</th> <!-- NEW -->
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>2026-01-23</td>
      <td>Deposit</td>
      <td>0.00007627</td>
      <td>-</td>
      <td style="color: #f59e0b">0.00000058</td>
      <td><span class="badge-blue">📦 Accumulated</span></td> <!-- NEW -->
    </tr>
  </tbody>
</table>
```

---

### Phase 5: Admin Portal & Reporting (1 day)

**5.1 Admin Dashboard - Accumulated Fees View**
```sql
-- RPC: List customers with accumulated fees
CREATE OR REPLACE FUNCTION public.list_accumulated_fees()
RETURNS TABLE (
  customer_id BIGINT,
  customer_name TEXT,
  btc_accumulated NUMERIC,
  usdt_accumulated NUMERIC,
  btc_value_usd NUMERIC,
  usdt_value_usd NUMERIC,
  total_value_usd NUMERIC,
  last_transfer_attempt TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    af.customer_id,
    cd.first_names || ' ' || cd.last_name AS customer_name,
    af.btc_accumulated,
    af.usdt_accumulated,
    af.btc_accumulated * 100000 AS btc_value_usd,  -- Approx BTC price
    af.usdt_accumulated AS usdt_value_usd,
    (af.btc_accumulated * 100000) + af.usdt_accumulated AS total_value_usd,
    GREATEST(af.last_btc_transfer_attempt, af.last_usdt_transfer_attempt) AS last_transfer_attempt
  FROM lth_pvr.customer_accumulated_fees af
  JOIN public.customer_details cd USING (customer_id)
  WHERE af.btc_accumulated > 0 OR af.usdt_accumulated > 0
  ORDER BY total_value_usd DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**5.2 Monthly Fee Invoice Generation**
Update `ef_fee_monthly_close` to populate new columns:
```typescript
// Calculate transferred vs accumulated fees
const { data: transferredFees } = await sb
  .from("valr_transfer_log")
  .select("amount, currency")
  .eq("customer_id", customerId)
  .eq("status", "completed")
  .eq("transfer_type", "platform_fee")
  .gte("created_at", monthStart)
  .lt("created_at", monthEnd);

const platformFeesTransferred = transferredFees
  .filter(t => t.currency === "USDT")
  .reduce((sum, t) => sum + parseFloat(t.amount), 0);

const platformFeesAccumulated = platformFeesDue - platformFeesTransferred;

// Insert invoice with breakdown
await sb.from("fee_invoices").insert({
  customer_id: customerId,
  invoice_month: monthStart,
  platform_fees_due: platformFeesDue,
  platform_fees_transferred: platformFeesTransferred,
  platform_fees_accumulated: platformFeesAccumulated,
  ...
});
```

---

## Testing Plan

### Test Case: TC1.2-A (Extension of TC1.2)

**Objective:** Verify platform fee accumulation and batch transfer logic

**Test Steps:**

1. **Small Deposit (Below Minimum)**
   - Deposit: 0.00007685 BTC
   - Platform fee: 0.00000058 BTC (5.8 sats)
   - Expected: Fee accumulated, NOT transferred
   - Verify: `customer_accumulated_fees.btc_accumulated = 0.00000058`

2. **Check Balance Reconciliation**
   - Expected VALR: recorded + accumulated (0.00007627 + 0.00000058 = 0.00007685)
   - Verify: No discrepancy alert

3. **Make 100 More Small Deposits**
   - Total accumulated: 0.00005800 BTC (58 sats × 100 = 5,800 sats = 0.00005800)
   - Still below minimum (0.0001 BTC)
   - Expected: All fees accumulated

4. **One Large Deposit (Pushes Over Minimum)**
   - Deposit: 0.01 BTC
   - Platform fee: 0.000075 BTC (75 sats)
   - Total accumulated: 0.00005800 + 0.000075 = 0.00013300 BTC
   - Expected: >= 0.0001 BTC threshold → **TRANSFER TRIGGERED**
   - Verify: Transfer successful, `customer_accumulated_fees.btc_accumulated = 0`

5. **Monthly Batch Transfer Test**
   - Run `ef_transfer_accumulated_fees` manually
   - Verify: All customers with accumulated fees >= minimum transferred
   - Verify: Alert log shows "Transferred accumulated fees for X customers"

**Success Criteria:**
- ✅ Small fees accumulate without transfer attempts
- ✅ Balance reconciliation accounts for accumulated fees
- ✅ Threshold crossing triggers transfer
- ✅ Monthly job transfers all eligible accumulated fees

---

## Rollout Plan

### Pre-Production Checklist

- [ ] VALR minimum transfer thresholds documented
- [ ] System configuration table created
- [ ] Accumulated fees table created
- [ ] RPC functions deployed
- [ ] ef_post_ledger_and_balances updated with threshold logic
- [ ] ef_transfer_accumulated_fees created and tested
- [ ] pg_cron job scheduled (monthly)
- [ ] Customer portal updated (balance display, transaction history)
- [ ] Admin portal updated (accumulated fees view)
- [ ] Monthly invoice generation updated
- [ ] TC1.2-A test case passed
- [ ] Documentation updated (SDD, operations guide)

### Migration Strategy

**Existing Customers (in production):**
1. Run one-time script to populate `customer_accumulated_fees` from historical failed transfers
2. Attempt batch transfer for all accumulated fees >= minimum
3. Send email to customers: "Small accumulated fees have been transferred"

**New Customers:**
- New logic applies immediately (accumulate below threshold, transfer when >= minimum)

---

## Timeline Estimate

| Phase | Duration | Depends On |
|-------|----------|------------|
| Research & Config | 2 days | - |
| Database Schema | 1 day | Phase 1 |
| Edge Functions | 3 days | Phase 2 |
| Customer Portal | 2 days | Phase 3 |
| Admin Portal | 1 day | Phase 3 |
| Testing | 2 days | Phase 4 |
| Documentation | 1 day | Phase 5 |
| **Total** | **12 days** | **~2.5 weeks** |

---

## Decision Required

**Question for User:**
Should we implement this **before marking TC1.2 as PASS** or defer to Phase 2 (post-launch)?

**Option A: Implement Now (Recommended)**
- ✅ Complete solution before production
- ✅ No technical debt
- ✅ Customer-facing features work correctly
- ❌ Delays TC1.2 completion by 2 weeks

**Option B: Defer to Phase 2**
- ✅ TC1.2 passes with "known limitation" disclaimer
- ✅ Faster initial launch
- ❌ Revenue leakage during Phase 1
- ❌ Customer confusion (balance display incorrect)
- ❌ Withdrawal logic broken (can't distinguish customer balance from fees)

**Recommendation:** **Option A** - This is a **blocking issue** for production. The withdrawal logic alone makes this critical.

---

**Next Steps:**
1. User decides: Implement now (Option A) or defer (Option B)?
2. If Option A → Start Phase 1 (research VALR minimums)
3. If Option B → Mark TC1.2 as "⚠️ PARTIAL PASS" with documented limitations

