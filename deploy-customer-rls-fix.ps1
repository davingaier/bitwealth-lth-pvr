# Fix Customer Portal Login - RLS Policy for customer_details
# Date: January 7, 2026
# Issue: PGRST118 error - customers cannot read their own customer_details after auth

Write-Host "=== Fix Customer Portal Login - RLS Policy ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Issue: After successful authentication, customers get error when trying to" -ForegroundColor Yellow
Write-Host "       access customer_details table due to restrictive RLS policies." -ForegroundColor Yellow
Write-Host ""
Write-Host "Solution: Add RLS policy allowing auth.uid() = customer_id" -ForegroundColor Green
Write-Host ""

$migrationFile = "supabase\migrations\20260107_fix_customer_details_rls.sql"

if (-not (Test-Path $migrationFile)) {
    Write-Host "ERROR: Migration file not found: $migrationFile" -ForegroundColor Red
    exit 1
}

Write-Host "Migration file: $migrationFile" -ForegroundColor Green
Write-Host ""

# Apply migration
Write-Host "Applying migration to production database..." -ForegroundColor Cyan

try {
    $output = supabase db push --project-ref wqnmxpooabmedvtackji 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Migration applied successfully!" -ForegroundColor Green
    } else {
        Write-Host "✗ Migration failed with exit code: $LASTEXITCODE" -ForegroundColor Red
        Write-Host $output -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Error applying migration: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Testing the Fix ===" -ForegroundColor Cyan
Write-Host "1. Go to: https://bitwealth.co.za/login.html" -ForegroundColor Yellow
Write-Host "2. Log in with the test customer credentials" -ForegroundColor Yellow
Write-Host "3. Should now redirect properly (no PGRST118 error)" -ForegroundColor Yellow
Write-Host "4. Check browser console - no errors" -ForegroundColor Yellow
Write-Host ""

Write-Host "=== What Was Fixed ===" -ForegroundColor Cyan
Write-Host "Before: customer_details RLS only allowed org-based admin access" -ForegroundColor Red
Write-Host "After:  Added policy for customers to read their own record via auth.uid()" -ForegroundColor Green
Write-Host ""

Write-Host "RLS Policy Added:" -ForegroundColor Yellow
Write-Host "  - customer_details_select_own: customer_id = auth.uid()" -ForegroundColor Gray
Write-Host "  - customer_details_update_own: customer_id = auth.uid()" -ForegroundColor Gray
Write-Host ""

Write-Host "Deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next: Test the complete flow end-to-end:" -ForegroundColor Cyan
Write-Host "  1. Register new account" -ForegroundColor Gray
Write-Host "  2. Login → should redirect to upload-kyc.html" -ForegroundColor Gray
Write-Host "  3. Upload ID document" -ForegroundColor Gray
Write-Host "  4. Verify redirect to customer portal" -ForegroundColor Gray
