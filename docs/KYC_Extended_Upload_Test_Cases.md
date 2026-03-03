# KYC Extended Document Upload — Test Cases
**Feature:** v0.6.59 — Extended KYC from 1 to 4 documents  
**Date:** 2026-03-03  
**Tester:** _______________

**Status legend:** ✅ PASS | ❌ FAIL | ⏭ SKIP

---

## Section 1 — Database Schema

### TC-DB-01: New columns exist on customer_details

**SQL to run (Supabase SQL Editor):**
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'customer_details'
  AND column_name LIKE 'kyc_%'
ORDER BY column_name;
```

**Expected result:** 11 rows returned, including all of:
- `kyc_bank_confirmation_uploaded_at` — timestamptz, YES
- `kyc_bank_confirmation_url` — text, YES
- `kyc_id_document_url` — text, YES
- `kyc_id_uploaded_at` — timestamptz, YES
- `kyc_id_verified_at` — timestamptz, YES
- `kyc_proof_address_uploaded_at` — timestamptz, YES
- `kyc_proof_address_url` — text, YES
- `kyc_source_of_income` — text, YES
- `kyc_source_of_income_doc_uploaded_at` — timestamptz, YES
- `kyc_source_of_income_doc_url` — text, YES
- `kyc_verified_by` — uuid, YES

**Result:** ___  **Notes:** _______________

---

### TC-DB-02: Source of income CHECK constraint rejects invalid values

**SQL to run:**
```sql
-- This must FAIL with constraint violation
UPDATE public.customer_details
SET kyc_source_of_income = 'Lottery winnings'
WHERE customer_id = (SELECT MIN(customer_id) FROM public.customer_details LIMIT 1);
```

**Expected result:** Error — `ERROR: new row for relation "customer_details" violates check constraint "chk_kyc_source_of_income"`

**Result:** ___  **Notes:** _______________

---

### TC-DB-03: Source of income CHECK constraint accepts valid values

**SQL to run (then roll back):**
```sql
BEGIN;
UPDATE public.customer_details
SET kyc_source_of_income = 'Employment / Salary'
WHERE customer_id = (SELECT MIN(customer_id) FROM public.customer_details LIMIT 1);
-- Should succeed — then roll back so we don't affect real data
ROLLBACK;
```

**Expected result:** UPDATE executes without error; ROLLBACK succeeds.

**Result:** ___  **Notes:** _______________

---

### TC-DB-04: get_customer_onboarding_status returns new KYC keys

**SQL to run (use any customer currently at status='kyc', or any active customer):**
```sql
SELECT public.get_customer_onboarding_status(
  (SELECT customer_id FROM public.customer_details 
   WHERE registration_status IN ('kyc','setup','active') 
   LIMIT 1)
);
```

**Expected result:** JSON includes all of these keys:
- `kyc_id_uploaded` (boolean, legacy key — still present)
- `kyc_docs_uploaded` (integer 0–4)
- `kyc_all_docs_uploaded` (boolean)
- `kyc_id_doc_uploaded` (boolean)
- `kyc_proof_address_uploaded` (boolean)
- `kyc_source_of_income_set` (boolean)
- `kyc_income_doc_uploaded` (boolean)
- `kyc_bank_conf_uploaded` (boolean)
- `next_action` — for status='kyc' should contain "X/4 complete" if docs missing

**Result:** ___  **Notes:** _______________

---

## Section 2 — Edge Function: ef_upload_kyc_documents

> **Base URL:** `https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_upload_kyc_documents`  
> **Auth:** Bearer token from a logged-in customer's session (or use the anon key for testing — JWT is enabled so requests without a valid token will get 401).

---

### TC-EF-01: Missing required fields returns 400

**PowerShell:**
```powershell
$response = Invoke-RestMethod `
  -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_upload_kyc_documents" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer <anon_key>"; "Content-Type" = "application/json" } `
  -Body '{"customer_id": 1}' `
  -ErrorAction SilentlyContinue
$response | ConvertTo-Json
```

**Expected result:** HTTP 400. `error` field lists all missing field names (kyc_id_file_path, kyc_id_file_url, kyc_proof_address_file_path, etc.)

**Result:** ___  **Notes:** _______________

---

### TC-EF-02: Invalid source of income returns 400

**PowerShell:**
```powershell
$body = @{
  customer_id = 1
  kyc_id_file_path = "test/id.pdf"
  kyc_id_file_url  = "https://example.com/id.pdf"
  kyc_proof_address_file_path = "test/addr.pdf"
  kyc_proof_address_file_url  = "https://example.com/addr.pdf"
  kyc_source_of_income = "Lottery winnings"
  kyc_source_of_income_file_path = "test/income.pdf"
  kyc_source_of_income_file_url  = "https://example.com/income.pdf"
  kyc_bank_confirmation_file_path = "test/bank.pdf"
  kyc_bank_confirmation_file_url  = "https://example.com/bank.pdf"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_upload_kyc_documents" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer <anon_key>"; "Content-Type" = "application/json" } `
  -Body $body `
  -ErrorAction SilentlyContinue
```

**Expected result:** HTTP 400. `error` contains "Invalid source of income" and lists the valid values.

**Result:** ___  **Notes:** _______________

---

### TC-EF-03: Non-existent customer_id returns 404

**PowerShell:** Same body as TC-EF-02 but with valid income source and `customer_id = 99999`

**Expected result:** HTTP 404. `error` = "Customer not found"

**Result:** ___  **Notes:** _______________

---

### TC-EF-04: Customer with wrong status blocked

**SQL first — find a customer NOT in 'kyc' status:**
```sql
SELECT customer_id, registration_status 
FROM public.customer_details 
WHERE registration_status = 'active' LIMIT 1;
```

Then call the edge function with that customer's ID (full valid body).

**Expected result:** HTTP 400. `error` contains "Invalid customer status" and the actual status value.

**Result:** ___  **Notes:** _______________

---

### TC-EF-05: Successful call updates all 4 KYC columns (end-to-end)

> **Prerequisites:** A test customer must exist with `registration_status = 'kyc'`. Use one of the existing KYC-stage test customers, or create one.

**Step 1 — Find test customer:**
```sql
SELECT customer_id, first_names, last_name, email, registration_status
FROM public.customer_details
WHERE registration_status = 'kyc'
ORDER BY customer_id LIMIT 5;
```

**Step 2 — Log in as that customer** in `login.html` to get a valid JWT session token.

**Step 3 — Note the before state:**
```sql
SELECT customer_id, kyc_id_document_url, kyc_proof_address_url,
       kyc_source_of_income, kyc_source_of_income_doc_url, kyc_bank_confirmation_url,
       kyc_id_uploaded_at
FROM public.customer_details
WHERE customer_id = <test_customer_id>;
```

**Step 4 — Call the edge function** with the session's access_token and real (or dummy file path) payload with `kyc_source_of_income = 'Employment / Salary'`.

**Step 5 — Verify DB updated:**
```sql
SELECT customer_id, kyc_id_document_url, kyc_proof_address_url,
       kyc_source_of_income, kyc_source_of_income_doc_url, kyc_bank_confirmation_url,
       kyc_id_uploaded_at, kyc_proof_address_uploaded_at,
       kyc_source_of_income_doc_uploaded_at, kyc_bank_confirmation_uploaded_at
FROM public.customer_details
WHERE customer_id = <test_customer_id>;
```

**Expected result:**
- HTTP 200, `success: true`, `documents_uploaded: 4`
- All 9 KYC columns populated (4 URLs + 4 timestamps + 1 income source text)
- All timestamps are approximately NOW()
- `email_sent: true` (admin notification sent)

**Result:** ___  **Notes:** _______________

---

### TC-EF-06: Admin notification email received

After TC-EF-05, check admin inbox at `admin@bitwealth.co.za`.

**Expected result:**
- Subject: "KYC Documents Submitted — \<first_name\> \<last_name\>"
- Body shows customer name, ID, email, upload date
- Body shows all 4 file paths under "Uploaded Documents"
- Body shows income source selection
- Link to Admin Portal visible

**Result:** ___  **Notes:** _______________

---

## Section 3 — Customer Upload Page (upload-kyc.html)

> Open `https://www.bitwealth.co.za/upload-kyc.html` (or local equivalent) after logging in as a `status='kyc'` customer.

---

### TC-UI-01: Page loads with 4 sections and disabled submit button

**Steps:** Log in as a `status='kyc'` customer and navigate to upload-kyc.html.

**Expected result:**
- Page title "KYC Document Upload"
- Progress dots 1–2–3–4 all shown (grey/unfilled)
- Label shows "**0 of 4** sections complete"
- 4 upload sections visible: Identity Document, Proof of Address, Source of Income, Bank Account Confirmation Letter
- "Submit All Documents" button is **disabled** (greyed out)

**Result:** ___  **Notes:** _______________

---

### TC-UI-02: Status guard — wrong status redirects

Log in as an `status='active'` customer and navigate to upload-kyc.html.

**Expected result:** Blue info message appears: "KYC document upload is not required at this stage (status: active). Redirecting…" — page then redirects to customer-portal.html.

**Result:** ___  **Notes:** _______________

---

### TC-UI-03: File type validation

In Section 1 (Identity Document), try to select/drop a `.docx` or `.txt` file.

**Expected result:** Red error message: "Invalid file type. Please upload JPEG, PNG, or PDF." Upload area remains visible; progress does not advance.

**Result:** ___  **Notes:** _______________

---

### TC-UI-04: File size validation

In any section, attempt to upload a file larger than 10 MB.

**Expected result:** Red error message: "File too large. Maximum size is 10 MB."

**Result:** ___  **Notes:** _______________

---

### TC-UI-05: Progress dots update as sections complete

Upload valid files for sections 1, 2, 4 (skip section 3 for now).

**Expected result:**
- Dots 1, 2, 4 turn **blue/filled** ✓
- Dot 3 remains grey
- Label shows "**3 of 4** sections complete"
- Submit button remains **disabled**
- Completed section cards get a blue border

**Result:** ___  **Notes:** _______________

---

### TC-UI-06: Section 3 requires both dropdown AND document

Upload a file in Section 3 but leave the income dropdown at "— Select one —".

**Expected result:** Dot 3 remains grey. Label still shows "3 of 4". Submit still disabled.

Then select an income source from the dropdown (without uploading a file first).

**Expected result:** Dot 3 remains grey (both required). Only when BOTH dropdown is set AND a document is uploaded does dot 3 turn blue.

**Result:** ___  **Notes:** _______________

---

### TC-UI-07: "Change" clears the section

After uploading a file in any section, click the "Change" link.

**Expected result:** The file info disappears, upload area reappears, section dot reverts to grey, progress count decreases by 1, submit disables if it was enabled.

**Result:** ___  **Notes:** _______________

---

### TC-UI-08: Drag and drop works

Drag a valid PDF file and drop it onto any upload area.

**Expected result:** File is accepted (same validation as click-to-select), section dot turns blue.

**Result:** ___  **Notes:** _______________

---

### TC-UI-09: Submit uploads all 4 files and calls edge function

After completing all 4 sections, click "Submit All Documents".

**Expected result:**
- Progress bar appears and advances through: 10% → 30% → 50% → 70% → 85% → 100%
- Status label shows each step ("Uploading identity document…", etc.)
- Success message appears: "✅ All KYC documents submitted successfully! An admin will review them within 1–2 business days. Redirecting…"
- Page redirects to `customer-portal.html` after ~4 seconds
- **Verify in DB**: all 4 URL columns populated (see TC-EF-05 SQL)
- **Verify in Supabase Storage**: `kyc-documents` bucket contains 4 new files under `{user_id}/` with naming `{date}_{last}_{first}_{doctype}.{ext}`

**Result:** ___  **Notes:** _______________

---

### TC-UI-10: File naming convention

After TC-UI-09, check Supabase Storage → `kyc-documents` bucket.

**Expected result:** 4 files with names matching:
- `2026-03-03_<LastName>_<FirstName>_id.<ext>`
- `2026-03-03_<LastName>_<FirstName>_address.<ext>`
- `2026-03-03_<LastName>_<FirstName>_income.<ext>`
- `2026-03-03_<LastName>_<FirstName>_bank.<ext>`

**Result:** ___  **Notes:** _______________

---

### TC-UI-11: Not logged in redirects to login

Navigate to upload-kyc.html while not logged in (or after clearing session).

**Expected result:** Error message "Please log in to upload your KYC documents." then redirect to `login.html` after 2.5 seconds.

**Result:** ___  **Notes:** _______________

---

## Section 4 — Admin UI: KYC Verification Panel

> Open the Admin UI → Customer Management → scroll to the KYC ID Verification card.

---

### TC-ADMIN-01: Table only shows customers with all 4 docs uploaded

Confirm that a customer who has uploaded ONLY their ID (but not the other 3 docs) does NOT appear in the KYC table.

**SQL to check:**
```sql
-- Should return rows (customers with partial uploads)
SELECT customer_id, registration_status, 
  kyc_id_document_url IS NOT NULL AS has_id,
  kyc_proof_address_url IS NOT NULL AS has_addr,
  kyc_source_of_income_doc_url IS NOT NULL AS has_income,
  kyc_bank_confirmation_url IS NOT NULL AS has_bank
FROM public.customer_details
WHERE registration_status = 'kyc'
  AND kyc_id_document_url IS NOT NULL;
```

Customers missing any of the 4 doc columns should NOT appear in the Admin UI table.

**Expected result:** Admin UI table is empty (or shows only customers with all 4 present). Partial uploads are invisible until fully submitted.

**Result:** ___  **Notes:** _______________

---

### TC-ADMIN-02: Table shows correct columns after full submission

After TC-UI-09, refresh the Admin UI KYC panel.

**Expected result:** The test customer appears with 7 columns:
1. Customer ID
2. Full name
3. Email
4. Submitted date/time
5. Income source (e.g. "Employment / Salary")
6. Documents — 4 icon links: 🪪 ID | 🏠 Address | 💼 Income | 🏦 Bank
7. ✓ Verify button

Each document link opens the correct signed URL in a new tab.

**Result:** ___  **Notes:** _______________

---

### TC-ADMIN-03: Search filters by name and email

In the search box, type part of the test customer's last name or email.

**Expected result:** Table filters in real time; only matching rows shown.

**Result:** ___  **Notes:** _______________

---

### TC-ADMIN-04: Verify button moves customer to 'setup' and creates VALR subaccount

Click ✓ Verify for the test customer.

**Expected result:**
- Confirmation dialog describes the action (status → 'setup', creates VALR subaccount, moves to Milestone 4)
- After confirming: success message appears
- Customer disappears from KYC table
- Customer appears in VALR Account Setup table (or already has subaccount — 409 handled gracefully)
- **Verify in DB:**
```sql
SELECT registration_status, kyc_id_verified_at, kyc_verified_by
FROM public.customer_details
WHERE customer_id = <test_customer_id>;
```
  Expect: `registration_status = 'setup'`, `kyc_id_verified_at` is set to ~NOW(), `kyc_verified_by` is the admin's UUID.

**Result:** ___  **Notes:** _______________

---

## Section 5 — Email Templates

### TC-EMAIL-01: kyc_request template shows all 4 documents

**SQL to verify:**
```sql
SELECT 
  CASE WHEN body_html LIKE '%Bank Account Confirmation%' THEN 'PASS' ELSE 'FAIL' END AS has_bank_doc,
  CASE WHEN body_html LIKE '%Proof of Address%' THEN 'PASS' ELSE 'FAIL' END AS has_addr_doc,
  CASE WHEN body_html LIKE '%Source of income%' THEN 'PASS' ELSE 'FAIL' END AS has_income_doc,
  CASE WHEN body_html LIKE '%Identity document%' THEN 'PASS' ELSE 'FAIL' END AS has_id_doc,
  CASE WHEN body_html LIKE '%1–2 business days%' THEN 'PASS' ELSE 'FAIL' END AS has_updated_instructions,
  CASE WHEN body_html LIKE '%<ol>%' THEN 'PASS' ELSE 'FAIL' END AS uses_ordered_list
FROM public.email_templates
WHERE template_key = 'kyc_request';
```

**Expected result:** All 6 columns show 'PASS'.

**Result:** ___  **Notes:** _______________

---

### TC-EMAIL-02: kyc_documents_uploaded_notification template exists and is correct

**SQL to verify:**
```sql
SELECT 
  template_key, name, subject,
  CASE WHEN body_html LIKE '%all required KYC documents%' THEN 'PASS' ELSE 'FAIL' END AS has_new_intro,
  CASE WHEN body_html LIKE '%kyc_id_file_path%' THEN 'PASS' ELSE 'FAIL' END AS has_id_placeholder,
  CASE WHEN body_html LIKE '%kyc_proof_address_file_path%' THEN 'PASS' ELSE 'FAIL' END AS has_addr_placeholder,
  CASE WHEN body_html LIKE '%kyc_source_of_income_file_path%' THEN 'PASS' ELSE 'FAIL' END AS has_income_placeholder,
  CASE WHEN body_html LIKE '%kyc_bank_confirmation_file_path%' THEN 'PASS' ELSE 'FAIL' END AS has_bank_placeholder,
  CASE WHEN body_html LIKE '%kyc_source_of_income%' THEN 'PASS' ELSE 'FAIL' END AS has_income_source
FROM public.email_templates
WHERE template_key = 'kyc_documents_uploaded_notification';
```

**Expected result:** 1 row returned; all PASS/CASE columns show 'PASS'. Subject = 'KYC Documents Submitted — {{first_name}} {{last_name}}'.

**Result:** ___  **Notes:** _______________

---

## Section 6 — Regression Tests

### TC-REG-01: login.html routing unchanged

Log in as a `status='kyc'` customer via `login.html`.

**Expected result:** Redirected to `upload-kyc.html` (not customer-portal.html). This routing was not changed in this release — confirm it still works.

**Result:** ___  **Notes:** _______________

---

### TC-REG-02: Legacy ef_upload_kyc_id still deployed and responses correctly

```powershell
Invoke-RestMethod `
  -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_upload_kyc_id" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer <anon_key>"; "Content-Type" = "application/json" } `
  -Body '{}' `
  -ErrorAction SilentlyContinue
```

**Expected result:** HTTP 400 with `error: "Missing required fields..."` (not a 404 or deployment error — function still exists).

**Result:** ___  **Notes:** _______________

---

### TC-REG-03: ef_upload_kyc_documents is active in Supabase dashboard

Navigate to Supabase Dashboard → Edge Functions.

**Expected result:** `ef_upload_kyc_documents` appears with status **ACTIVE**, version 1, JWT verification **ON**.

**Result:** ___  **Notes:** _______________

---

### TC-REG-04: Active/deposit/setup customers unaffected

Navigate to Admin UI → Customer Management. Confirm existing active customers still display correctly in the Active Customers table, and the VALR Account Setup table is unchanged.

**Expected result:** No regressions in other milestone cards.

**Result:** ___  **Notes:** _______________

---

## Sign-off

| Section | # Tests | Passed | Failed | Skipped |
|---------|---------|--------|--------|---------|
| 1 — DB Schema | 4 | | | |
| 2 — Edge Function | 6 | | | |
| 3 — Customer Upload UI | 11 | | | |
| 4 — Admin UI | 4 | | | |
| 5 — Email Templates | 2 | | | |
| 6 — Regression | 4 | | | |
| **Total** | **31** | | | |

**Signed off by:** _______________  
**Date:** _______________  
**Feature ready for production use:** YES / NO
