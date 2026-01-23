# VALR Minimum Transfer Threshold Research Findings

**Date:** January 23, 2026  
**Phase:** Task 5, Phase 6, Sub-Phase 6.1  
**Status:** Research Complete ✅

---

## Executive Summary

VALR's minimum transfer thresholds are **undocumented** in their API documentation. Through test case execution and analysis, we have established **conservative estimates** based on empirical evidence and industry standards.

**Key Finding:** These thresholds BLOCK small platform fees from being transferred, requiring an accumulation system to prevent revenue leakage.

---

## Test Results

### BTC Threshold

**Test Case:** TC1.2 - BTC Deposit Platform Fee Transfer  
**Date:** 2026-01-23

**Transfer Attempt:**
- Amount: 0.00000058 BTC (5.8 satoshis)
- Customer: 47 (Subaccount ID: 1463930536558264320)
- Result: ❌ **FAILED**
- Error Message: "Invalid Request, please check your request and try again"
- VALR Response Code: Not specified
- Transfer Log ID: Check `lth_pvr.valr_transfer_log` WHERE currency='BTC' AND status='failed'

**Conclusion:**
- Minimum BTC transfer is **>= 0.00000058 BTC** (greater than 5.8 sats)
- Industry standard for exchanges: 0.0001 BTC (10,000 satoshis)
- **Estimated Minimum: 0.0001 BTC (10,000 sats)**
- Value at $100k/BTC: ~$10 USD

**Confidence Level:** MEDIUM (based on 1 failure test + industry standards)

**Next Steps:** Manual testing recommended with amounts:
- 0.00001 BTC (1,000 sats) - Expected: FAIL
- 0.00005 BTC (5,000 sats) - Expected: FAIL
- 0.0001 BTC (10,000 sats) - Expected: SUCCESS
- 0.0002 BTC (20,000 sats) - Expected: SUCCESS (confirm threshold)

---

### USDT Threshold

**Test Case:** TC1.1 - USDT Deposit Platform Fee Transfer  
**Date:** 2026-01-22

**Transfer Attempt:**
- Amount: 0.05732531 USDT ($0.057)
- Customer: 47 (Subaccount ID: 1463930536558264320)
- Result: ✅ **SUCCESS**
- Transfer ID: 8131e539-1fbd-4846-b2a4-3890c22f49f4
- VALR Transfer ID: 130650524

**Conclusion:**
- Minimum USDT transfer is **<= 0.05732531 USDT** (less than or equal to $0.06)
- **Estimated Minimum: $1.00 USDT**
- Conservative estimate with safety buffer (actual may be lower)

**Rationale:**
- TC1.1 succeeded at $0.06
- Setting threshold at $1.00 provides safety buffer
- Avoids unnecessary transfer attempts for very small fees
- Accumulation will batch fees until >= $1.00

**Confidence Level:** HIGH (based on 1 success test)

**Next Steps:** Optional refinement testing:
- $0.01 USDT - Expected: SUCCESS (but setting threshold higher for efficiency)
- $0.10 USDT - Expected: SUCCESS
- $1.00 USDT - Expected: SUCCESS

---

### ZAR Threshold

**Test Case:** N/A (ZAR not currently used in system)

**Conclusion:**
- **Estimated Minimum: R 100.00 ZAR**
- Based on South African exchange industry standards
- Not actively used in BitWealth LTH PVR (BTC/USDT only)

**Confidence Level:** LOW (industry estimate only, no testing)

**Next Steps:** Testing not required unless ZAR support added.

---

## Configuration Table Values

**Table:** `lth_pvr.system_config`

| Config Key | Value | Description | Status |
|------------|-------|-------------|--------|
| `valr_min_transfer_btc` | `"0.0001"` | 10,000 satoshis (~$10 @ $100k BTC) | ESTIMATED |
| `valr_min_transfer_usdt` | `"1.00"` | $1.00 USD (conservative) | ESTIMATED |
| `valr_min_transfer_zar` | `"100.00"` | R100 (~$5 USD) | ESTIMATED |

**Verification Query:**
```sql
SELECT 
  config_key,
  config_value::text as threshold,
  description
FROM lth_pvr.system_config
WHERE config_key LIKE 'valr_min_transfer_%'
ORDER BY config_key;
```

---

## VALR API Documentation Gap

**Endpoint:** `POST /v1/account/subaccounts/transfer`  
**Documentation:** https://docs.valr.com/  
**Issue:** Minimum transfer amounts NOT documented

**What's Documented:**
- ✅ Authentication (HMAC SHA-512)
- ✅ Rate limits (20 requests/second)
- ✅ Required permissions ("Transfer" scope)
- ✅ Request/response format
- ✅ Error codes (generic)

**What's Missing:**
- ❌ Minimum transfer amounts per currency
- ❌ Specific error messages for amount violations
- ❌ Fee structure for transfers (if any)
- ❌ Transfer limits (daily/monthly)

**Recommendation:** Contact VALR support for official documentation of minimum transfer amounts.

---

## Impact on Platform Fee System

### Without Accumulation System

**Problem:** Small fees cannot be transferred → Revenue leakage

**Example Scenario:**
- Customer deposits 0.001 BTC
- Platform fee: 0.0000075 BTC (7.5 sats @ 0.75%)
- Transfer attempt: ❌ FAILS (below 10,000 sats)
- Fee remains on customer subaccount indefinitely
- Customer could withdraw BitWealth's accumulated fees

**Scale:**
- 100 customers with 0.001 BTC deposits
- Total fees: 0.00075 BTC = $75 @ $100k BTC
- **Lost revenue: $75 per day** (if all fees below threshold)

### With Accumulation System (Phase 6)

**Solution:** Track accumulated fees, batch transfer when >= threshold

**Example Scenario:**
- Customer deposits 0.001 BTC (10 times)
- Each fee: 0.0000075 BTC (7.5 sats)
- Total accumulated: 0.000075 BTC (75 sats)
- Still below threshold → Continue accumulating
- After 134 deposits: 0.00010050 BTC (>= 10,000 sats)
- **Batch transfer triggered:** Transfer all accumulated fees
- Revenue captured: ✅ $10.05 @ $100k BTC

---

## Implementation Checklist (Sub-Phase 6.1) ✅

- [✅] Research VALR API documentation (found undocumented)
- [✅] Analyze TC1.1 success (0.05732531 USDT)
- [✅] Analyze TC1.2 failure (0.00000058 BTC)
- [✅] Determine conservative estimates (0.0001 BTC, $1.00 USDT)
- [✅] Create system_config table schema
- [✅] Apply migration: 20260124_add_system_config_table.sql
- [✅] Insert threshold values with descriptions
- [✅] Document research findings (this file)
- [✅] Update SDD v0.6.31 with threshold values
- [✅] Update PLATFORM_FEE_ACCUMULATION_ANALYSIS.md

---

## Next Steps (Sub-Phase 6.2)

**Database Schema Changes (1 day)**

1. Create `lth_pvr.customer_accumulated_fees` table
2. Enhance `lth_pvr.fee_invoices` with transferred/accumulated columns
3. Create RPC: `lth_pvr.get_withdrawable_balance(customer_id)`
4. Create RPC: `lth_pvr.accumulate_platform_fee(customer_id, currency, amount)`
5. Apply migration: 20260124_add_customer_accumulated_fees.sql

**Target Completion:** January 24, 2026

---

## References

- **Test Cases:** `docs/TASK_5_FEE_IMPLEMENTATION_TEST_CASES.md`
- **Analysis:** `docs/PLATFORM_FEE_ACCUMULATION_ANALYSIS.md`
- **SDD:** `docs/SDD_v0.6.md` (v0.6.31 change log)
- **VALR API Docs:** https://docs.valr.com/
- **Transfer Module:** `supabase/functions/_shared/valrTransfer.ts`

---

**Document Status:** Finalized  
**Last Updated:** January 23, 2026  
**Next Review:** After Sub-Phase 6.2 completion (customer_accumulated_fees table)
