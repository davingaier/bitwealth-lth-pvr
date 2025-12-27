# Security Remediation Guide

**Date:** 2025-12-27  
**Issue:** Exposed API keys detected in GitHub repository

## Exposed Secrets

1. **Supabase Service Role JWT** - Exposed in git history
2. **Resend API Key** (`re_ZUoZ9aRn_...`) - Exposed in commit `abccda2` and docs/SDD_v0.6.md

---

## Immediate Actions (CRITICAL - Do These Now)

### 1. Rotate Supabase Service Role JWT

```bash
# Go to Supabase Dashboard
https://supabase.com/dashboard/project/wqnmxpooabmedvtackji/settings/api

# Click "Reset Service Role Key" or rotate the JWT secret
# Copy the new service role key
```

After rotating, update the Supabase secret:
```bash
cd C:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="[NEW_SERVICE_ROLE_KEY]" \
  --project-ref wqnmxpooabmedvtackji
```

### 2. Rotate Resend API Key

```bash
# Go to Resend Dashboard
https://resend.com/api-keys

# 1. REVOKE the exposed key: re_ZUoZ9aRn_LUxV8exouZvKXNW7xYk6jXYc
# 2. Generate a NEW API key
# 3. Copy the new key
```

Update the Supabase secret:
```bash
supabase secrets set RESEND_API_KEY="[NEW_RESEND_KEY]" \
  --project-ref wqnmxpooabmedvtackji
```

---

## Remove Secrets from Git History

### Option 1: BFG Repo-Cleaner (Recommended - Fastest)

1. **Download BFG:**
   ```powershell
   # Download from: https://rtyley.github.io/bfg-repo-cleaner/
   # Or use Chocolatey:
   choco install bfg-repo-cleaner
   ```

2. **Create a file with secrets to remove:**
   ```powershell
   # Create secrets.txt with one secret per line
   @"
re_ZUoZ9aRn_LUxV8exouZvKXNW7xYk6jXYc
davin.gaier@gmail.com
"@ | Out-File -FilePath secrets.txt -Encoding utf8
   ```

3. **Run BFG to remove secrets:**
   ```powershell
   cd C:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr
   
   # Clone a fresh bare copy
   git clone --mirror https://github.com/davingaier/bitwealth-lth-pvr.git bitwealth-lth-pvr-clean.git
   
   # Run BFG to replace secrets
   java -jar bfg.jar --replace-text secrets.txt bitwealth-lth-pvr-clean.git
   
   # Clean up
   cd bitwealth-lth-pvr-clean.git
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive
   ```

4. **Force push the cleaned history:**
   ```powershell
   # WARNING: This rewrites history - coordinate with team members!
   git push --force
   ```

### Option 2: Git Filter-Repo (More Powerful)

```powershell
# Install git-filter-repo
pip install git-filter-repo

cd C:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr

# Create expressions file
@"
re_ZUoZ9aRn_LUxV8exouZvKXNW7xYk6jXYc==>***REMOVED***
davin.gaier@gmail.com==>***REMOVED***
"@ | Out-File -FilePath replacements.txt -Encoding utf8

# Run filter-repo
git filter-repo --replace-text replacements.txt --force

# Force push (WARNING: rewrites history!)
git push --force origin main
```

### Option 3: Manual Git Filter-Branch (Slower)

```bash
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch docs/SDD_v0.6.md" \
  --prune-empty --tag-name-filter cat -- --all

# Force push
git push --force origin main
```

---

## Prevent Future Exposures

### 1. Create .env File Structure

```bash
# Create .env for local development (NOT committed to git)
# .env
SUPABASE_URL=https://wqnmxpooabmedvtackji.supabase.co
SUPABASE_SERVICE_ROLE_KEY=[your-service-role-key]
SUPABASE_ANON_KEY=[your-anon-key]
RESEND_API_KEY=[your-resend-key]
VALR_API_KEY=[your-valr-key]
VALR_API_SECRET=[your-valr-secret]
```

### 2. Update .gitignore

```bash
# Add to .gitignore
.env
.env.local
.env.*.local
*.key
*.pem
secrets.txt
replacements.txt
```

### 3. Use Supabase Secrets for Production

All production secrets should be stored in Supabase Edge Function secrets:

```bash
supabase secrets set \
  SUPABASE_SERVICE_ROLE_KEY="[key]" \
  RESEND_API_KEY="[key]" \
  VALR_API_KEY="[key]" \
  VALR_API_SECRET="[secret]" \
  --project-ref wqnmxpooabmedvtackji
```

### 4. Install Git Secrets Tool

```powershell
# Prevent future commits with secrets
git clone https://github.com/awslabs/git-secrets.git
cd git-secrets
./install.ps1

# Configure patterns
git secrets --add 're_[A-Za-z0-9_]{30,}'  # Resend API keys
git secrets --add 'eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*'  # JWTs
git secrets --add 'sk_[A-Za-z0-9]{20,}'  # Service keys

# Install hooks
git secrets --install
```

---

## Verification

After remediation, verify no secrets remain:

```bash
# Search for potential secrets
git grep -E "re_[A-Za-z0-9_]{30,}" HEAD
git grep -E "eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*" HEAD
git grep -E "sk_[A-Za-z0-9]{20,}" HEAD

# Check git history
git log --all --full-history --source --pretty=format: --name-only | sort -u | xargs git grep -E "re_[A-Za-z0-9_]{30,}"
```

---

## Post-Remediation Checklist

- [ ] Rotated Supabase Service Role JWT
- [ ] Rotated Resend API Key  
- [ ] Removed secrets from current files (docs/SDD_v0.6.md)
- [ ] Removed secrets from git history using BFG/filter-repo
- [ ] Force pushed cleaned history to GitHub
- [ ] Updated Supabase secrets with new keys
- [ ] Created .env file (not committed)
- [ ] Added .env to .gitignore
- [ ] Installed git-secrets or equivalent pre-commit hook
- [ ] Verified no secrets in git log/history
- [ ] Dismissed GitHub security alerts after verification
- [ ] Documented incident for security audit trail

---

## Important Notes

⚠️ **Force Push Warning:** Rewriting git history requires force push, which will affect anyone with a clone of the repository. Coordinate with team members.

⚠️ **Supabase Functions:** After rotating Supabase Service Role Key, Edge Functions will automatically use the new key from the secrets store. No code changes needed.

⚠️ **VALR Keys:** If VALR API keys were also exposed, rotate them at https://www.valr.com/account/api

⚠️ **Monitor Usage:** Check Resend and Supabase dashboards for any unauthorized usage during the exposure period.
