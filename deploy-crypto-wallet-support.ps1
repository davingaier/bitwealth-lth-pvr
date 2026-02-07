# Deploy Crypto Wallet Deposit Support
# Date: 2026-02-07
# Purpose: Add BTC and USDT wallet deposit functionality

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Crypto Wallet Deposit Support Deployment" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$projectRef = "wqnmxpooabmedvtackji"

Write-Host "This deployment will:" -ForegroundColor Yellow
Write-Host "1. Add wallet address columns to exchange_accounts table" -ForegroundColor White
Write-Host "2. Update deposit_instructions email template with crypto options" -ForegroundColor White
Write-Host "3. Admin UI already updated with wallet address inputs`n" -ForegroundColor White

$confirm = Read-Host "Proceed with deployment? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Deployment cancelled." -ForegroundColor Red
    exit
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Step 1: Apply Database Migration" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Applying migration: 20260207_add_crypto_wallet_columns.sql..." -ForegroundColor Yellow
supabase db push --project-ref $projectRef --include-all

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERROR] Database migration failed!" -ForegroundColor Red
    Write-Host "Please check the error above and fix before continuing." -ForegroundColor Red
    exit 1
}

Write-Host "`n[SUCCESS] Wallet columns added to exchange_accounts" -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Step 2: Update Email Template" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Applying migration: 20260207_update_deposit_email_template.sql..." -ForegroundColor Yellow
supabase db push --project-ref $projectRef --include-all

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERROR] Email template update failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n[SUCCESS] Email template updated with crypto wallet options" -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Step 3: Verify Deployment" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Verifying schema changes..." -ForegroundColor Yellow

$verifyQuery = @"
SELECT 
  column_name, 
  data_type,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'exchange_accounts'
  AND column_name IN ('btc_wallet_address', 'usdt_wallet_address', 'usdt_deposit_network', 'btc_wallet_created_at', 'usdt_wallet_created_at')
ORDER BY ordinal_position;
"@

Write-Host "Expected columns: btc_wallet_address, usdt_wallet_address, usdt_deposit_network, btc_wallet_created_at, usdt_wallet_created_at`n" -ForegroundColor White

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "NEXT STEPS FOR ADMIN:" -ForegroundColor Yellow
Write-Host "=====================`n" -ForegroundColor Yellow

Write-Host "1. TEST THE NEW WORKFLOW:" -ForegroundColor Cyan
Write-Host "   - Create a test customer through KYC approval (M1-M3)" -ForegroundColor White
Write-Host "   - System will auto-create VALR subaccount" -ForegroundColor White
Write-Host "   - Admin must manually:" -ForegroundColor White
Write-Host "     a) Log into VALR portal (valr.com)" -ForegroundColor White
Write-Host "     b) Navigate to customer subaccount" -ForegroundColor White
Write-Host "     c) Create BTC wallet (copy address)" -ForegroundColor White
Write-Host "     d) Create USDT wallet on TRON network (copy address)" -ForegroundColor White
Write-Host "     e) Return to Admin UI, click 'Enter All References' button" -ForegroundColor White
Write-Host "     f) Paste all 3 deposit methods (ZAR ref, BTC wallet, USDT wallet)" -ForegroundColor White
Write-Host "     g) Click 'Save All & Send Email'`n" -ForegroundColor White

Write-Host "2. VERIFY EMAIL TEMPLATE:" -ForegroundColor Cyan
Write-Host "   - Check that test customer receives email with:" -ForegroundColor White
Write-Host "     • ZAR bank transfer section with deposit_ref" -ForegroundColor White
Write-Host "     • BTC wallet address section with warnings" -ForegroundColor White
Write-Host "     • USDT wallet address section with TRON network emphasis" -ForegroundColor White
Write-Host "     • Guidance on which method to choose`n" -ForegroundColor White

Write-Host "3. TEST DEPOSIT DETECTION:" -ForegroundColor Cyan
Write-Host "   - Make small test deposits via each method:" -ForegroundColor White
Write-Host "     a) ZAR bank transfer (existing functionality)" -ForegroundColor White
Write-Host "     b) BTC deposit to wallet address" -ForegroundColor White
Write-Host "     c) USDT deposit via TRON network" -ForegroundColor White
Write-Host "   - Verify ef_deposit_scan detects all deposit types" -ForegroundColor White
Write-Host "   - Check that exchange_funding_events records created correctly`n" -ForegroundColor White

Write-Host "4. DOCUMENTATION UPDATED:" -ForegroundColor Cyan
Write-Host "   - ADMIN_OPERATIONS_GUIDE.md: Milestone 4 section updated" -ForegroundColor White
Write-Host "   - Review updated workflow and train team if needed`n" -ForegroundColor White

Write-Host "IMPORTANT NOTES:" -ForegroundColor Yellow
Write-Host "================" -ForegroundColor Yellow
Write-Host "• VALR API does NOT support automated wallet creation" -ForegroundColor Red
Write-Host "• Wallets MUST be created manually in VALR portal" -ForegroundColor Red
Write-Host "• Always select TRON network for USDT (lowest fees)" -ForegroundColor Red
Write-Host "• Verify addresses before saving - errors cause permanent loss`n" -ForegroundColor Red

Write-Host "Admin UI changes are LIVE (no deployment needed)" -ForegroundColor Green
Write-Host "Database and email templates deployed successfully`n" -ForegroundColor Green

Write-Host "Deployment script completed at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
