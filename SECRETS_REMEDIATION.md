# Security Incident Response - Exposed Secrets Remediation

**Date:** January 4, 2026  
**Status:** IN PROGRESS  
**Severity:** HIGH

---

## 📋 Incident Summary

During testing activities, the following secrets were exposed in git commit history and repository files:

1. **SMTP Password:** `D@v!nG@!er01020` for admin@bitwealth.co.za
2. **Supabase Service Role Key:** JWT token exposed in test script
3. **Email Address:** admin@bitwealth.co.za (public email, low risk)

### Files Affected (Now Fixed)
- ✅ `test-tc5-deposit-scan.ps1` - Supabase service role key removed
- ✅ `SMTP_MIGRATION_DEPLOYMENT_GUIDE.md` - SMTP password removed
- ✅ `diagnose-smtp.ps1` - SMTP credentials removed
- ✅ `SMTP_MIGRATION_QUICK_REF.md` - SMTP password removed

### Git Commits Containing Secrets
- **b1e20fe** - "Updated email-related docs with SMTP" (Jan 4, 15:46)
- **873ec66** - "Updated test case documentation" (Jan 4, 17:29)

---

## ✅ Immediate Actions Completed

### 1. Secrets Removed from Working Files
All hardcoded secrets replaced with environment variable references:
- `$env:SUPABASE_SERVICE_ROLE_KEY`
- `$env:SMTP_PASS`
- `$env:SMTP_USER`

### 2. Environment Variable Template Created
Created `.env.example` as template for secure credential storage.

### 3. Enhanced .gitignore
Added additional patterns to prevent future exposure:
```
passwords.txt
*_credentials.txt
credentials.json
auth.json
```

---

## ⚠️ Critical Actions Required (Manual Steps)

### Step 1: Rewrite Git History

**DANGER:** This will rewrite git history. All collaborators must re-clone.

```powershell
# Download BFG Repo-Cleaner
# https://rtyley.github.io/bfg-repo-cleaner/
# Place bfg.jar in your repo root

# Use the replacements.txt file (already created)
java -jar bfg.jar --replace-text replacements.txt .git

# Clean up refs
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force push to remote (DESTRUCTIVE - WARN COLLABORATORS FIRST)
git push origin --force --all
git push origin --force --tags
```

### Step 2: Rotate Compromised Credentials

#### A. Supabase Service Role Key
1. Go to https://supabase.com/dashboard/project/wqnmxpooabmedvtackji/settings/api
2. Generate new service role key
3. Update in Supabase Edge Functions secrets:
```powershell
# Set new key for all edge functions
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=new_key_here --project-ref wqnmxpooabmedvtackji
```
4. Update local `.env` file
5. Old key will expire automatically

#### B. SMTP Password
1. Log into mail.bitwealth.co.za control panel
2. Change password for admin@bitwealth.co.za
3. Update in Supabase Edge Functions secrets:
```powershell
supabase secrets set SMTP_PASS=new_password_here --project-ref wqnmxpooabmedvtackji
```
4. Update local `.env` file
5. Test with diagnose-smtp.ps1

#### C. VALR API Keys (Precautionary)
If exposed in other commits (not detected yet), rotate:
1. Log into VALR dashboard
2. API Settings → Revoke old key → Generate new key
3. Update Edge Functions secrets:
```powershell
supabase secrets set VALR_API_KEY=new_key --project-ref wqnmxpooabmedvtackji
supabase secrets set VALR_API_SECRET=new_secret --project-ref wqnmxpooabmedvtackji
```

### Step 3: Verify Rotation Complete

```powershell
# Test Supabase connection
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_deposit_scan `
  -H "Authorization: Bearer $env:SUPABASE_SERVICE_ROLE_KEY" `
  -H "Content-Type: application/json" `
  -d "{}"

# Test SMTP
.\diagnose-smtp.ps1
```

---

## 🔒 Prevention Measures Implemented

1. **Environment Variables:** All scripts now use `$env:VAR_NAME` instead of hardcoded values
2. **Template File:** `.env.example` provides structure without secrets
3. **Enhanced .gitignore:** Blocks common credential file patterns
4. **Documentation:** This file tracks incident and remediation steps

---

## 📊 Risk Assessment

| Secret | Exposure Window | Impact | Mitigation Status |
|--------|----------------|--------|-------------------|
| SMTP Password | ~6 hours | Medium | ✅ Removed from files, rotation pending |
| Supabase Service Key | ~1 hour | High | ✅ Removed from files, rotation pending |
| Email Address | Public info | Low | No action needed |

---

## 📝 Post-Incident Checklist

- [x] Identify all exposed secrets
- [x] Remove secrets from working files
- [x] Create environment variable template
- [x] Enhance .gitignore
- [ ] Rewrite git history with BFG Repo-Cleaner
- [ ] Force push cleaned history
- [ ] Rotate Supabase service role key
- [ ] Rotate SMTP password
- [ ] Verify all edge functions still work
- [ ] Update team documentation
- [ ] Schedule security review (monthly)

---

## 🎓 Lessons Learned

1. **Never commit secrets** - Use environment variables exclusively
2. **Test in isolation** - Create test scripts that reference env vars
3. **Review before commit** - Check `git diff` for sensitive data
4. **Automate detection** - Consider pre-commit hooks with secret scanning
5. **Regular audits** - Monthly scan for exposed credentials

---

**Next Steps:**
1. Execute git history rewrite (when ready)
2. Rotate all compromised credentials
3. Test all edge functions after rotation
4. Monitor for any authentication failures

**Reference:**
- [GitHub: Removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
- [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/)
