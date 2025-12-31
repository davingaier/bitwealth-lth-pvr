# Milestone 2: Strategy Confirmation - COMPLETE

**Completion Date:** 2025-12-31  
**Status:** ✅ DEPLOYED & TESTED

## What Was Built

### 1. Edge Function: ef_confirm_strategy

**Deployment:**
```bash
supabase functions deploy ef_confirm_strategy --project-ref wqnmxpooabmedvtackji --no-verify-jwt
```

**Functionality:**
- Validates customer status = 'prospect'
- Fetches strategy from `public.strategies` table
- Creates `customer_portfolios` entry:
  ```sql
  INSERT INTO customer_portfolios (
    org_id, customer_id, strategy_code, 
    status='pending', 
    label='{first_names} {last_name} - {strategy_name}'
  )
  ```
- Updates `customer_details.registration_status = 'kyc'`
- Generates registration URL: `{WEBSITE_URL}/register.html?customer_id={id}&email={email}`
- Sends `kyc_portal_registration` email via `ef_send_email`
- Returns: success, portfolio_id, registration_url, email_sent

**API Endpoint:**
```
POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_confirm_strategy
Content-Type: application/json

{
  "customer_id": 31,
  "strategy_code": "LTH_PVR",
  "admin_email": "admin@bitwealth.co.za"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Strategy confirmed for Jemaica Gaier",
  "customer_id": 31,
  "portfolio_id": "24ee10ac-35e4-4486-a265-848e6f0faf56",
  "strategy_code": "LTH_PVR",
  "strategy_name": "LTH PVR BTC DCA",
  "email": "jemaicagaier@gmail.com",
  "registration_url": "https://wqnmxpooabmedvtackji.supabase.co/website/register.html?customer_id=31&email=jemaicagaier%40gmail.com",
  "email_sent": true
}
```

### 2. Email Template: kyc_portal_registration

**Created:** 2025-12-31  
**Template Key:** `kyc_portal_registration`  
**Subject:** "Welcome to BitWealth - Create Your Portal Account"

**Placeholders:**
- `{{first_name}}` - Customer's first name
- `{{strategy_name}}` - Selected strategy name (e.g., "LTH PVR BTC DCA")
- `{{registration_url}}` - Unique registration link with customer_id + email
- `{{website_url}}` - BitWealth website URL

**Email Content:**
- Welcome message
- Explains next step: Create portal account
- Lists portal features (ID upload, performance tracking, etc.)
- Warning: ID upload required after registration (KYC compliance)
- Call-to-action button: "Create Your Account →"
- Contact info for support

**Sender:** noreply@bitwealth.co.za

### 3. Admin UI: Customer Onboarding Pipeline

**Location:** `ui/Advanced BTC DCA Strategy.html` → Customer Management module

**Module Rename:**
- OLD: "Customer Maintenance"
- NEW: "Customer Management" ✅

**UI Components:**

**Card Title:** "Customer Onboarding Pipeline"

**Table Columns:**
1. ID (customer_id)
2. Name (first_names + last_name)
3. Email
4. Phone
5. Status (milestone badge)
6. Submitted (created_at)
7. Actions (strategy dropdown + confirm button)

**Status Badges:**
- `prospect` → Yellow "M1: Prospect"
- `kyc` → Cyan "M3: KYC"
- `setup` → Purple "M4: Setup"
- `deposit` → Orange "M5: Deposit"
- `active` → Green "M6: Active"
- `inactive` → Gray "Inactive"

**Actions Column:**
- Strategy dropdown (populated from `public.strategies` table)
  * Options: ADV_DCA, LTH_PVR
  * Default: "Select Strategy..."
- "Confirm" button (only shown for status='prospect')
- onClick: `window.confirmStrategy(customer_id)`

**JavaScript Functions:**
- `loadStrategies()` - Fetches strategies from database
- `loadProspects()` - Fetches customers with optional status filter
- `renderProspects()` - Builds table HTML with inline dropdowns
- `confirmStrategy(customerId)` - Main action handler:
  1. Gets selected strategy_code from dropdown
  2. Shows confirmation dialog with strategy name
  3. Calls `ef_confirm_strategy` endpoint
  4. Displays success/error message
  5. Reloads prospects list

**Filters:**
- "Prospects Only" checkbox (default: checked)
- Search input (filters by name/email)
- Refresh button

### 4. Testing

**Test Case: TC2.1**
- **Customer:** customer_id=31 (Jemaica Gaier)
- **Strategy:** LTH_PVR
- **Result:** ✅ PASS

**Verified:**
- ✅ customer_details.registration_status changed: `prospect` → `kyc`
- ✅ customer_portfolios entry created:
  * portfolio_id: `24ee10ac-35e4-4486-a265-848e6f0faf56`
  * strategy_code: `LTH_PVR`
  * status: `pending`
  * label: `Jemaica Gaier - LTH PVR BTC DCA`
- ✅ Email sent to jemaicagaier@gmail.com
- ✅ Registration URL generated correctly

**Test Documentation:** [docs/Customer_Onboarding_Test_Cases.md](docs/Customer_Onboarding_Test_Cases.md)

## Files Modified

1. **supabase/functions/ef_confirm_strategy/index.ts** (NEW - 221 lines)
2. **ui/Advanced BTC DCA Strategy.html** (UPDATED)
   - Lines ~304: CSS comment renamed
   - Lines ~399: Nav link renamed
   - Lines ~434-436: Section ID + heading renamed
   - Lines ~2256-2290: Replaced KYC Management card with Onboarding Pipeline card
   - Lines ~6010-6230: Replaced KYC Management module with Onboarding Pipeline module
3. **docs/SDD_v0.6.md** (UPDATED)
   - v0.6.3 changelog updated with Milestone 2 completion status
4. **docs/Customer_Onboarding_Test_Cases.md** (NEW - 582 lines)
   - Complete test suite for all 6 milestones
   - 34 test cases defined
   - 5 test cases passed (M1 + M2)

## Database Changes

**customer_details table:**
- `registration_status` values now include: prospect, kyc, setup, deposit, active, inactive
- Milestone 2 changes: `prospect` → `kyc`

**customer_portfolios table:**
- New entries created by Milestone 2
- Fields: portfolio_id, customer_id, strategy_code, status='pending', label

**email_templates table:**
- New template: `kyc_portal_registration`

**public.strategies table:**
- Queried for dropdown population
- 2 strategies available: ADV_DCA, LTH_PVR

## Next Steps (Milestone 3)

### 1. Customer Portal: ID Upload Page

**File:** `website/upload-id.html` (NEW)

**Requirements:**
- Shown when customer logs in with status='kyc'
- File input: Accept image/* and application/pdf (max 10MB)
- Upload to Supabase Storage bucket: `kyc-documents`
- File naming: `{ccyy-mm-dd}_{last_name}_{first_names}_id.pdf`
- Progress indicator during upload
- Success message after upload
- Update `customer_details.kyc_id_document_url`

**Supabase Storage Bucket:**
```sql
-- Create bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('kyc-documents', 'kyc-documents', false);

-- RLS policy: Customers can only upload their own ID
CREATE POLICY "Customers can upload own ID"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'kyc-documents' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- RLS policy: Admins can read all IDs
CREATE POLICY "Admins can read all IDs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'kyc-documents' 
  AND EXISTS (
    SELECT 1 FROM public.org_members 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);
```

### 2. Edge Function: ef_upload_kyc_id

**Functionality:**
- Receives uploaded file URL from client
- Validates file naming convention
- Updates `customer_details.kyc_id_document_url`
- Sets `customer_details.kyc_id_uploaded_at = NOW()`
- Sends `kyc_id_uploaded_notification` email to admin

**Deployment:**
```bash
supabase functions deploy ef_upload_kyc_id --project-ref wqnmxpooabmedvtackji
```
(Note: JWT verification ENABLED - called from authenticated customer portal)

### 3. Email Template: kyc_id_uploaded_notification

**To:** Admin (noreply@bitwealth.co.za)
**Subject:** "New ID Document Uploaded - {first_name} {last_name}"
**Placeholders:**
- `{{first_name}}`, `{{last_name}}`
- `{{customer_id}}`
- `{{upload_date}}`
- `{{admin_portal_url}}`

### 4. Admin UI: ID Verification Section

**Location:** Customer Management module (below Onboarding Pipeline)

**Card Title:** "KYC ID Verification"

**Table:**
- Columns: ID, Name, Email, Uploaded Date, Document, Actions
- Filter: Show only customers with status='kyc' AND kyc_id_document_url IS NOT NULL
- Document column: Link to view ID in new tab (Storage bucket URL)
- Actions column: "Verify ID" button

**Verify Button Logic:**
```javascript
async function verifyKycId(customerId) {
  const confirmed = confirm("Mark ID as verified for customer " + customerId + "?");
  if (!confirmed) return;
  
  // Call edge function or direct Supabase update
  const { data, error } = await supabase
    .from('customer_details')
    .update({
      registration_status: 'setup',
      kyc_verified_at: new Date().toISOString(),
      kyc_verified_by: adminEmail
    })
    .eq('customer_id', customerId);
    
  if (error) {
    alert("Error: " + error.message);
  } else {
    alert("ID verified successfully! Customer moved to M4: VALR Setup.");
    loadKycVerificationQueue(); // Reload list
  }
}
```

## Estimated Timeline

- **Milestone 2:** ✅ COMPLETE (1 day)
- **Milestone 3:** 2-3 days
  * Storage bucket setup: 0.5 day
  * Customer portal ID upload page: 1 day
  * Admin verification UI: 0.5 day
  * Testing: 1 day
- **Milestone 4:** 2 days
- **Milestone 5:** 1-2 days
- **Milestone 6:** 3-4 days
- **Total Remaining:** 8-11 days
- **Launch Target:** January 17, 2026 (17 days available) ✅ ON TRACK

## Notes

- Module rename ("Customer Maintenance" → "Customer Management") improves clarity
- Strategy selection from database (not hardcoded) allows easy expansion
- Email template follows BitWealth branding with gradient header
- UI uses milestone badges (M1-M6) for visual progress tracking
- Testing confirmed end-to-end workflow: prospect → strategy selection → status=kyc → email sent
- All code follows existing patterns (similar to ef_prospect_submit, ef_customer_register)

---

**Document Control:**
- Created: 2025-12-31
- Author: BitWealth Development Team
- Next Review: After Milestone 3 completion
