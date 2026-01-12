# URGENT: Remove Secrets from Git History
# This script will clean exposed secrets from git history
# WARNING: This rewrites git history and requires force push

Write-Host "=== URGENT: Removing Exposed Secrets from Git History ===" -ForegroundColor Red
Write-Host ""

Write-Host "SECRETS EXPOSED IN COMMIT: d7a8df6 'created contact form functionality'" -ForegroundColor Yellow
Write-Host ""
Write-Host "Exposed secrets:" -ForegroundColor Red
Write-Host "  1. reCAPTCHA secret key in deploy-contact-form.ps1" -ForegroundColor White
Write-Host "  2. Database password in deploy-contact-form.ps1" -ForegroundColor White
Write-Host "  3. reCAPTCHA site key in SDD_v0.6.md and CONTACT_FORM_QUICK_REF.md" -ForegroundColor White
Write-Host ""

Write-Host "=== STEP 1: Rotate Compromised Secrets ===" -ForegroundColor Yellow
Write-Host ""
Write-Host "BEFORE cleaning git history, you MUST rotate these secrets:" -ForegroundColor Red
Write-Host ""
Write-Host "1. Regenerate reCAPTCHA keys:" -ForegroundColor White
Write-Host "   - Go to: https://www.google.com/recaptcha/admin" -ForegroundColor Gray
Write-Host "   - Delete existing site" -ForegroundColor Gray
Write-Host "   - Create new site with same domain (bitwealth.co.za)" -ForegroundColor Gray
Write-Host "   - Get new SITE KEY and SECRET KEY" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Update reCAPTCHA site key in website files:" -ForegroundColor White
Write-Host "   - website/index.html (line 443)" -ForegroundColor Gray
Write-Host "   - website/lth-pvr-backtest.html (existing reCAPTCHA)" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Update reCAPTCHA secret key in Supabase:" -ForegroundColor White
Write-Host '   supabase secrets set RECAPTCHA_SECRET_KEY="<new-secret-key>" --project-ref wqnmxpooabmedvtackji' -ForegroundColor Gray
Write-Host ""
Write-Host "4. Change Supabase database password:" -ForegroundColor White
Write-Host "   - Go to: https://supabase.com/dashboard/project/wqnmxpooabmedvtackji/settings/database" -ForegroundColor Gray
Write-Host "   - Click 'Reset Database Password'" -ForegroundColor Gray
Write-Host "   - Update any local connection strings" -ForegroundColor Gray
Write-Host ""

$confirm = Read-Host "Have you rotated ALL secrets listed above? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host ""
    Write-Host "❌ ABORTING: Please rotate secrets first before cleaning git history" -ForegroundColor Red
    Write-Host ""
    Write-Host "Why? If you clean git history before rotating secrets, the old secrets" -ForegroundColor Yellow
    Write-Host "are still valid and can be used by anyone who cloned your repo." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "=== STEP 2: Remove Secrets from Git History ===" -ForegroundColor Yellow
Write-Host ""

# Create a backup branch
Write-Host "Creating backup branch..." -ForegroundColor Cyan
git branch backup-before-secret-removal
Write-Host "✓ Backup created: backup-before-secret-removal" -ForegroundColor Green
Write-Host ""

# Use git filter-repo to remove secrets (better than filter-branch)
Write-Host "Checking if git-filter-repo is installed..." -ForegroundColor Cyan
$filterRepo = Get-Command git-filter-repo -ErrorAction SilentlyContinue

if (-not $filterRepo) {
    Write-Host ""
    Write-Host "git-filter-repo not found. Installing via pip..." -ForegroundColor Yellow
    pip install git-filter-repo
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "❌ Failed to install git-filter-repo" -ForegroundColor Red
        Write-Host ""
        Write-Host "Manual installation options:" -ForegroundColor Yellow
        Write-Host "  1. pip install git-filter-repo" -ForegroundColor Gray
        Write-Host "  2. Download from: https://github.com/newren/git-filter-repo" -ForegroundColor Gray
        Write-Host ""
        Write-Host "Alternative: Use BFG Repo-Cleaner (faster):" -ForegroundColor Yellow
        Write-Host "  1. Download BFG: https://rtyley.github.io/bfg-repo-cleaner/" -ForegroundColor Gray
        Write-Host "  2. Run: java -jar bfg.jar --replace-text secrets.txt" -ForegroundColor Gray
        exit 1
    }
}

Write-Host ""
Write-Host "Creating text replacements file..." -ForegroundColor Cyan
$replacements = @"
6LdJOqAqAAAAABrKON0vX9YZ8jHhZ_6bQ8X8xBkU==>***REMOVED-RECAPTCHA-SECRET***
Y0urL0ngT3mporaryP4ssw0rd!@aws-0-ap-southeast-1.pooler.supabase.com==>***REMOVED-DB-PASSWORD***
6LdJOqAqAAAAALnCrUYHhKW6rKB__ijYsU_4_Aq2==>***REMOVED-RECAPTCHA-SITEKEY***
"@

$replacements | Out-File -FilePath "secrets-to-remove.txt" -Encoding UTF8
Write-Host "✓ Created secrets-to-remove.txt" -ForegroundColor Green
Write-Host ""

Write-Host "Running git-filter-repo to remove secrets from history..." -ForegroundColor Cyan
Write-Host "(This may take a few minutes)" -ForegroundColor Gray
Write-Host ""

git filter-repo --replace-text secrets-to-remove.txt --force

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ git-filter-repo failed" -ForegroundColor Red
    Write-Host ""
    Write-Host "Alternative method using BFG Repo-Cleaner:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "1. Download BFG: https://rtyley.github.io/bfg-repo-cleaner/" -ForegroundColor Gray
    Write-Host "2. Create secrets.txt with patterns to replace (already created as secrets-to-remove.txt)" -ForegroundColor Gray
    Write-Host "3. Run: java -jar bfg.jar --replace-text secrets-to-remove.txt" -ForegroundColor Gray
    Write-Host "4. Run: git reflog expire --expire=now --all && git gc --prune=now --aggressive" -ForegroundColor Gray
    Write-Host "5. Force push: git push origin --force --all" -ForegroundColor Gray
    exit 1
}

Write-Host "✓ Secrets removed from git history" -ForegroundColor Green
Write-Host ""

# Clean up repository
Write-Host "Cleaning up repository..." -ForegroundColor Cyan
git reflog expire --expire=now --all
git gc --prune=now --aggressive

Write-Host "✓ Repository cleaned" -ForegroundColor Green
Write-Host ""

Write-Host "=== STEP 3: Force Push to Remote ===" -ForegroundColor Yellow
Write-Host ""
Write-Host "⚠️  WARNING: This will rewrite remote history!" -ForegroundColor Red
Write-Host ""
Write-Host "If others have cloned this repo, they will need to:" -ForegroundColor Yellow
Write-Host "  1. Delete their local clone" -ForegroundColor Gray
Write-Host "  2. Re-clone from GitHub" -ForegroundColor Gray
Write-Host ""

$pushConfirm = Read-Host "Force push to origin? (yes/no)"
if ($pushConfirm -eq "yes") {
    Write-Host ""
    Write-Host "Force pushing to origin..." -ForegroundColor Cyan
    git push origin --force --all
    git push origin --force --tags
    
    Write-Host "✓ Force push complete" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "⚠️  Skipped force push. To push later, run:" -ForegroundColor Yellow
    Write-Host "   git push origin --force --all" -ForegroundColor Gray
    Write-Host "   git push origin --force --tags" -ForegroundColor Gray
    Write-Host ""
}

Write-Host "=== STEP 4: Verify Secrets Removed ===" -ForegroundColor Yellow
Write-Host ""
Write-Host "Checking if secrets still exist in history..." -ForegroundColor Cyan

$foundSecrets = $false

# Search for secrets in git history
$searches = @(
    "6LdJOqAqAAAAABrKON0vX9YZ8jHhZ_6bQ8X8xBkU",
    "Y0urL0ngT3mporaryP4ssw0rd",
    "6LdJOqAqAAAAALnCrUYHhKW6rKB__ijYsU_4_Aq2"
)

foreach ($secret in $searches) {
    $found = git log -S"$secret" --all --oneline
    if ($found) {
        Write-Host "❌ Found secret in history: $secret" -ForegroundColor Red
        $foundSecrets = $true
    }
}

if (-not $foundSecrets) {
    Write-Host "✓ No secrets found in git history" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ Secrets still exist in history!" -ForegroundColor Red
    Write-Host "Manual cleanup required - see BFG Repo-Cleaner instructions above" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Cleanup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Verify secrets are rotated (check Supabase dashboard)" -ForegroundColor White
Write-Host "  2. Test website contact form with new reCAPTCHA keys" -ForegroundColor White
Write-Host "  3. Delete backup branch if everything works: git branch -D backup-before-secret-removal" -ForegroundColor White
Write-Host "  4. Delete secrets-to-remove.txt file" -ForegroundColor White
Write-Host ""

# Clean up
Remove-Item "secrets-to-remove.txt" -ErrorAction SilentlyContinue
