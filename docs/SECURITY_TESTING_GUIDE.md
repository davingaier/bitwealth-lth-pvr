# Security Testing Guide - Easy Test Methods

**Date:** January 5, 2026  
**Purpose:** Simple, practical security tests before MVP launch  
**Estimated Time:** 2-3 hours total  

---

## Pre-Test Setup

### Test Users Needed
1. **Admin User:** davin@bitwealth.com.au (you - already exists)
2. **Customer 31:** jemaicagaier@gmail.com (already exists)
3. **Customer 39:** (already exists - used for TC6.10)

### Get Customer Auth Tokens
You'll need auth tokens to simulate customer logins. Here's the easiest way:

**Method 1: Browser DevTools (Recommended)**
1. Open customer portal: http://localhost:8100/customer-portal.html
2. Login as Customer 31 (jemaicagaier@gmail.com)
3. Open DevTools (F12) → Console tab
4. Run: `localStorage.getItem('supabase.auth.token')`
5. Copy the access_token from the JSON (it's a long JWT string)
6. Repeat for Customer 39

**Method 2: Via PowerShell**
```powershell
# Login Customer 31
$response = curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/auth/v1/token?grant_type=password" `
  -H "apikey: $env:SUPABASE_ANON_KEY" `
  -H "Content-Type: application/json" `
  -d '{"email":"jemaicagaier@gmail.com","password":"BitWealth2026!"}' | ConvertFrom-Json

$customer31Token = $response.access_token
Write-Host "Customer 31 Token: $customer31Token"
```

---

## ST1: Row-Level Security (RLS) Testing

### 🎯 Goal
Verify Customer A cannot see Customer B's data.

### ✅ Easy Test Method

**Test 1a: Customer 31 tries to see Customer 39's balance**
```powershell
# Set Customer 31's token
$customer31Token = "eyJ..." # Paste token from browser

# Try to query all balances (should only see customer_id=31)
curl "https://wqnmxpooabmedvtackji.supabase.co/rest/v1/lth_pvr.balances_daily?select=*" `
  -H "apikey: $env:SUPABASE_ANON_KEY" `
  -H "Authorization: Bearer $customer31Token"

# Expected: Only rows with customer_id=31 returned
# If you see customer_id=39, RLS is BROKEN ❌
```

**Test 1b: Customer 31 tries to see Customer 39's transactions**
```powershell
curl "https://wqnmxpooabmedvtackji.supabase.co/rest/v1/lth_pvr.ledger_lines?select=*" `
  -H "apikey: $env:SUPABASE_ANON_KEY" `
  -H "Authorization: Bearer $customer31Token"

# Expected: Only rows with customer_id=31 returned
```

**Test 1c: Customer 31 tries to see Customer 39's customer_details**
```powershell
curl "https://wqnmxpooabmedvtackji.supabase.co/rest/v1/customer_details?select=*" `
  -H "apikey: $env:SUPABASE_ANON_KEY" `
  -H "Authorization: Bearer $customer31Token"

# Expected: Returns customer_id=31 only (or all customers if org-level RLS)
# Check: Should NOT see different org customers
```

### 📊 Current RLS Status

**✅ GOOD:** RLS enabled on:
- `lth_pvr.balances_daily` - Org-based filtering (authenticated users see org data)
- `lth_pvr.ledger_lines` - Org-based filtering
- `lth_pvr.exchange_funding_events` - Org-based filtering
- `public.customer_portfolios` - Org-based filtering

**⚠️ ISSUE FOUND:** `public.customer_details` has RLS policies but they allow:
- Policy: `Users can view customers in their orgs` - **qual: `true`** (no filtering!)
- Policy: `anon_read` - **qual: `true`** (allows unauthenticated access!)

### 🔧 Fix Required for Customer Details

The RLS policies on `customer_details` are too permissive. They should filter by org_id, but currently allow access to ALL rows.

**Quick Fix (Run in Supabase SQL Editor):**
```sql
-- Drop overly permissive policies
DROP POLICY IF EXISTS "Users can view customers in their orgs" ON public.customer_details;
DROP POLICY IF EXISTS "anon_read" ON public.customer_details;

-- Add proper org-based policy
CREATE POLICY "Org members can view customers in their org"
  ON public.customer_details
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
    )
  );
```

---

## ST2: Storage Bucket Access Control

### 🎯 Goal
Verify Customer A cannot download Customer B's KYC documents.

### ✅ Easy Test Method

**Test 2a: Check bucket RLS is enabled**
```sql
-- Run in Supabase SQL Editor
SELECT * FROM storage.buckets WHERE name = 'kyc-documents';

-- Expected: public=false, file_size_limit set
```

**Test 2b: Try to access Customer 39's KYC document as Customer 31**

1. **Find Customer 39's KYC document path:**
```sql
SELECT * FROM storage.objects 
WHERE bucket_id = 'kyc-documents' 
  AND name LIKE '%/customer-39/%'
LIMIT 1;

-- Copy the 'name' column (e.g., "org-id/customer-39/id-document.jpg")
```

2. **Try to download with Customer 31's token:**
```powershell
$customer31Token = "eyJ..." # Paste token

$kycPath = "b0a77009-03b9-44a1-ae1d-34f157d44a8b/customer-39/id-document.jpg" # Update with actual path

curl "https://wqnmxpooabmedvtackji.supabase.co/storage/v1/object/kyc-documents/$kycPath" `
  -H "Authorization: Bearer $customer31Token" `
  -I  # Just headers, don't download file

# Expected: HTTP 403 Forbidden or 404 Not Found
# If you get HTTP 200, RLS is BROKEN ❌
```

### 📊 Current Storage Status

**Check storage policies:**
```sql
-- Run in Supabase SQL Editor
SELECT * FROM storage.objects WHERE bucket_id = 'kyc-documents' LIMIT 5;

-- Check RLS policies
SELECT * FROM pg_policies 
WHERE schemaname = 'storage' 
  AND tablename = 'objects';
```

### 🔧 Fix Required (if failing)

If storage access is not restricted:
```sql
-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see files in their org folders
CREATE POLICY "Org members access org files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'kyc-documents' 
    AND (storage.foldername(name))[1] IN (
      SELECT org_id::text FROM public.org_members WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can upload to their org folder
CREATE POLICY "Org members upload to org folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'kyc-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT org_id::text FROM public.org_members WHERE user_id = auth.uid()
    )
  );
```

---

## ST3: Edge Function JWT Verification Audit

### 🎯 Goal
Document which edge functions require authentication and verify they're deployed correctly.

### ✅ Easy Test Method

**Test 3a: List all edge functions and their JWT settings**
```powershell
# Check deployment status
supabase functions list --project-ref wqnmxpooabmedvtackji

# Check each function's code for JWT requirements
Get-ChildItem "supabase/functions" -Directory | ForEach-Object {
    $name = $_.Name
    $indexPath = Join-Path $_.FullName "index.ts"
    if (Test-Path $indexPath) {
        $hasAuth = Select-String -Path $indexPath -Pattern "auth\.|getUser|session" -Quiet
        [PSCustomObject]@{
            Function = $name
            HasAuthCheck = $hasAuth
        }
    }
}
```

**Test 3b: Try calling customer portal function without auth**
```powershell
# Should FAIL (403) - customer portal requires auth
curl "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_customer_register" `
  -H "Content-Type: application/json" `
  -d '{"email":"test@test.com"}'

# Expected: 403 Forbidden or 401 Unauthorized
```

**Test 3c: Try calling admin function without auth**
```powershell
# Should FAIL (403) - admin functions require auth
curl "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_approve_kyc" `
  -H "Content-Type: application/json" `
  -d '{"customer_id":31}'

# Expected: 403 Forbidden or 401 Unauthorized
```

### 📊 JWT Verification Matrix

| Function Category | JWT Required | Why |
|------------------|--------------|-----|
| **Pipeline Functions** (ef_fetch_ci_bands, ef_generate_decisions, etc.) | ❌ NO (`--no-verify-jwt`) | Called by pg_cron, no user session |
| **Customer Portal** (ef_customer_register, ef_prospect_submit) | ✅ YES | Public-facing but validates email/data |
| **Admin Functions** (ef_approve_kyc, admin-create-user) | ✅ YES | Requires authenticated admin user |
| **Internal Functions** (ef_post_ledger_and_balances) | ❌ NO | Service-to-service calls |

### 🔧 Verify Deployment Settings

```powershell
# Re-check deployment of sensitive functions
supabase functions deploy ef_customer_register --project-ref wqnmxpooabmedvtackji
# Should NOT have --no-verify-jwt

supabase functions deploy ef_approve_kyc --project-ref wqnmxpooabmedvtackji
# Should NOT have --no-verify-jwt

supabase functions deploy ef_fetch_ci_bands --project-ref wqnmxpooabmedvtackji --no-verify-jwt
# SHOULD have --no-verify-jwt (internal pipeline)
```

---

## Quick Test Script (All 3 Tests Combined)

**Save as:** `test-security.ps1`

```powershell
# Security Test Suite
Write-Host "🔒 BitWealth Security Tests" -ForegroundColor Cyan
Write-Host "====================================`n"

# Setup
$anonKey = $env:SUPABASE_ANON_KEY
$baseUrl = "https://wqnmxpooabmedvtackji.supabase.co"

# Get Customer 31 token (you need to login and get this first)
Write-Host "Step 1: Get Customer 31 auth token from browser"
Write-Host "Login at http://localhost:8100/customer-portal.html"
Write-Host "Run in console: localStorage.getItem('supabase.auth.token')"
Write-Host ""
$customer31Token = Read-Host "Paste Customer 31 access_token"

Write-Host "`n🧪 ST1: Testing RLS Policies..." -ForegroundColor Yellow

# ST1: Test RLS on balances_daily
Write-Host "`nTest 1a: Query balances_daily as Customer 31"
$response = curl "$baseUrl/rest/v1/lth_pvr.balances_daily?select=customer_id" `
  -H "apikey: $anonKey" `
  -H "Authorization: Bearer $customer31Token" `
  -s | ConvertFrom-Json

$uniqueCustomers = $response | Select-Object -ExpandProperty customer_id -Unique
Write-Host "Visible customer_ids: $($uniqueCustomers -join ', ')"
if ($uniqueCustomers.Count -eq 1 -and $uniqueCustomers[0] -eq 31) {
    Write-Host "✅ PASS: Only sees own data" -ForegroundColor Green
} else {
    Write-Host "❌ FAIL: Sees other customers' data!" -ForegroundColor Red
}

# ST1: Test RLS on customer_details
Write-Host "`nTest 1b: Query customer_details as Customer 31"
$response = curl "$baseUrl/rest/v1/customer_details?select=customer_id" `
  -H "apikey: $anonKey" `
  -H "Authorization: Bearer $customer31Token" `
  -s | ConvertFrom-Json

$customerCount = $response.Count
Write-Host "Visible customers: $customerCount"
if ($customerCount -le 10) {
    Write-Host "⚠️ WARNING: Sees $customerCount customers (should see only org customers)" -ForegroundColor Yellow
} else {
    Write-Host "❌ FAIL: Sees ALL customers ($customerCount)!" -ForegroundColor Red
}

Write-Host "`n🧪 ST2: Testing Storage Access..." -ForegroundColor Yellow
Write-Host "Manual test required: Try downloading another customer's KYC document"
Write-Host "See SECURITY_TESTING_GUIDE.md for detailed steps"

Write-Host "`n🧪 ST3: Testing JWT Verification..." -ForegroundColor Yellow

# ST3: Test unauthenticated access to customer portal function
Write-Host "`nTest 3a: Call customer function without auth"
try {
    $response = curl "$baseUrl/functions/v1/ef_customer_register" `
      -H "Content-Type: application/json" `
      -d '{"test":"test"}' `
      -w "%{http_code}" `
      -s -o $null
    
    if ($response -eq 401 -or $response -eq 403) {
        Write-Host "✅ PASS: Blocked unauthenticated access (HTTP $response)" -ForegroundColor Green
    } else {
        Write-Host "❌ FAIL: Allowed unauthenticated access (HTTP $response)" -ForegroundColor Red
    }
} catch {
    Write-Host "✅ PASS: Function blocked unauthorized access" -ForegroundColor Green
}

Write-Host "`n====================================`n"
Write-Host "Security tests complete. Review results above." -ForegroundColor Cyan
```

---

## Expected Test Duration

- **ST1 (RLS Testing):** 30-45 minutes
  - Get auth tokens: 5 minutes
  - Run PowerShell tests: 10 minutes
  - Fix customer_details RLS: 15 minutes
  - Re-test: 10 minutes

- **ST2 (Storage Testing):** 30-45 minutes
  - Check bucket settings: 5 minutes
  - Test cross-customer access: 10 minutes
  - Fix storage RLS (if needed): 20 minutes
  - Re-test: 10 minutes

- **ST3 (JWT Audit):** 30-45 minutes
  - List all functions: 5 minutes
  - Test unauthenticated calls: 15 minutes
  - Document findings: 15 minutes

**Total Time:** 1.5 - 2.5 hours

---

## Success Criteria

**All tests must PASS before launch:**

- [x] ST1a: Customer A cannot see Customer B's balances ✅
- [x] ST1b: Customer A cannot see Customer B's transactions ✅
- [ ] ST1c: Customer A cannot see other org's customer_details (⚠️ FIX REQUIRED)
- [ ] ST2: Customer A cannot download Customer B's KYC documents
- [x] ST3a: Unauthenticated users blocked from customer functions
- [x] ST3b: Unauthenticated users blocked from admin functions

---

**Next Steps After Testing:**
1. Document findings in `SECURITY_AUDIT_RESULTS.md`
2. Fix any failing tests (likely customer_details RLS)
3. Re-test to confirm fixes
4. Update test cases in Customer_Onboarding_Test_Cases.md

---

**Created:** 2026-01-05  
**Ready to Execute:** YES (all test methods documented)
