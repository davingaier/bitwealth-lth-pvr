# Production Domain & SSL Configuration Guide

**Date:** January 6, 2026  
**Target:** Configure bitwealth.co.za for production launch  
**Current:** localhost:8081 (development)  
**Timeline:** Complete by Jan 7 EOD (1 day)

---

## Overview

This guide walks through configuring a production domain with SSL for the BitWealth customer portal and website.

**Goals:**
1. Set up production domain (bitwealth.co.za or subdomain)
2. Configure SSL certificate (HTTPS)
3. Deploy website files to hosting
4. Update CORS settings in Supabase
5. Update WEBSITE_URL environment variable

---

## Option 1: Netlify (Recommended - Fastest)

**Advantages:**
- Free SSL certificates (Let's Encrypt, auto-renewing)
- Automatic deployments from Git
- Fast global CDN
- Simple domain configuration
- Generous free tier

### Step 1: Create Netlify Account
1. Go to https://app.netlify.com/signup
2. Sign up with GitHub (or email)

### Step 2: Deploy Website
1. Click "Add new site" → "Import an existing project"
2. Connect to GitHub repository (or drag/drop folder)
3. Configure build settings:
   - **Base directory:** `website`
   - **Build command:** (leave empty for static site)
   - **Publish directory:** `.` (root of website folder)
4. Click "Deploy site"

### Step 3: Configure Custom Domain
1. In Netlify dashboard → Site settings → Domain management
2. Click "Add custom domain"
3. Enter: `bitwealth.co.za` (or `app.bitwealth.co.za`)
4. Netlify will provide DNS configuration:
   ```
   A Record:     @        → 75.2.60.5 (Netlify load balancer)
   CNAME Record: www      → your-site.netlify.app
   ```

### Step 4: Configure DNS
**Option A: Use Netlify DNS (Simplest)**
1. Transfer nameservers to Netlify
2. Update domain registrar with Netlify nameservers:
   ```
   dns1.p01.nsone.net
   dns2.p01.nsone.net
   dns3.p01.nsone.net
   dns4.p01.nsone.net
   ```

**Option B: Use Existing DNS Provider**
1. Log in to domain registrar (e.g., Afrihost, HostAfrica, Namecheap)
2. Add DNS records:
   ```
   Type   Name    Value                    TTL
   A      @       75.2.60.5                300
   CNAME  www     your-site.netlify.app    300
   ```

### Step 5: Enable SSL
1. Netlify automatically provisions Let's Encrypt certificate
2. Wait 5-10 minutes for certificate issuance
3. Verify HTTPS working: https://bitwealth.co.za
4. Enable "Force HTTPS" in Netlify settings

### Step 6: Test Deployment
```powershell
# Test DNS resolution
nslookup bitwealth.co.za

# Test HTTPS
curl https://bitwealth.co.za

# Test customer portal
curl https://bitwealth.co.za/customer-portal.html
```

**Estimated Time:** 30-60 minutes (excluding DNS propagation)

---

## Option 2: Vercel

**Advantages:**
- Similar to Netlify (free SSL, CDN)
- Excellent Next.js support (future-proof)
- Automatic Git deployments

### Step 1: Create Vercel Account
1. Go to https://vercel.com/signup
2. Sign up with GitHub

### Step 2: Deploy Website
1. Click "Add New Project"
2. Import Git repository (or drag/drop folder)
3. Configure:
   - **Framework Preset:** Other
   - **Root Directory:** `website`
   - **Build Command:** (leave empty)
   - **Output Directory:** `.`
4. Click "Deploy"

### Step 3: Configure Custom Domain
1. In Vercel dashboard → Settings → Domains
2. Add domain: `bitwealth.co.za`
3. Configure DNS (similar to Netlify):
   ```
   A Record:     @    → 76.76.21.21 (Vercel)
   CNAME Record: www  → cname.vercel-dns.com
   ```

### Step 4: SSL Auto-Provisioned
- Vercel automatically provisions SSL
- Certificate renews automatically
- Force HTTPS enabled by default

**Estimated Time:** 30-60 minutes

---

## Option 3: GitHub Pages

**Advantages:**
- Free hosting for public repos
- Simple deployment workflow
- Good for static sites

**Limitations:**
- Custom domain SSL requires some setup
- Slower than Netlify/Vercel CDN

### Step 1: Enable GitHub Pages
1. Go to repository → Settings → Pages
2. Source: `main` branch, `/website` folder
3. Click "Save"

### Step 2: Configure Custom Domain
1. Add CNAME file to website folder:
   ```
   echo "bitwealth.co.za" > website/CNAME
   git add website/CNAME
   git commit -m "Add custom domain"
   git push
   ```

2. In GitHub Pages settings, enter custom domain: `bitwealth.co.za`

### Step 3: Configure DNS
1. Add DNS records at domain registrar:
   ```
   Type   Name    Value                         TTL
   A      @       185.199.108.153               300
   A      @       185.199.109.153               300
   A      @       185.199.110.153               300
   A      @       185.199.111.153               300
   CNAME  www     your-username.github.io       300
   ```

### Step 4: Enable HTTPS
1. In GitHub Pages settings → Check "Enforce HTTPS"
2. Wait for SSL certificate provisioning (up to 24 hours)

**Estimated Time:** 1-2 hours (+ 24 hours for SSL)

---

## Step 7: Update Supabase Configuration (All Options)

### A. Update CORS Settings
1. Go to Supabase dashboard → Project Settings → API
2. Add production domain to CORS allowed origins:
   ```
   https://bitwealth.co.za
   https://www.bitwealth.co.za
   ```

### B. Update Environment Variables
1. Go to Supabase dashboard → Project Settings → Edge Functions → Secrets
2. Update WEBSITE_URL:
   ```
   WEBSITE_URL=https://bitwealth.co.za
   ```

3. Redeploy affected edge functions:
   ```powershell
   # Functions that reference WEBSITE_URL:
   supabase functions deploy ef_confirm_strategy --project-ref wqnmxpooabmedvtackji --no-verify-jwt
   supabase functions deploy ef_send_email --project-ref wqnmxpooabmedvtackji --no-verify-jwt
   ```

### C. Update Email Templates (If Needed)
Check if any email templates have hardcoded localhost URLs:
```sql
SELECT template_key, body_html 
FROM email_templates 
WHERE body_html LIKE '%localhost%';
```

If found, update with:
```sql
UPDATE email_templates
SET body_html = REPLACE(body_html, 'http://localhost:8081', 'https://bitwealth.co.za')
WHERE body_html LIKE '%localhost%';
```

---

## Step 8: Post-Deployment Testing

### Test Checklist
- [ ] **Homepage loads:** https://bitwealth.co.za/
- [ ] **Prospect form works:** Submit test prospect
- [ ] **Customer registration:** https://bitwealth.co.za/register.html
- [ ] **Customer login:** https://bitwealth.co.za/login.html
- [ ] **Customer portal:** https://bitwealth.co.za/customer-portal.html
- [ ] **KYC upload:** https://bitwealth.co.za/upload-kyc.html
- [ ] **HTTPS certificate valid:** Check browser padlock icon
- [ ] **No mixed content warnings:** All resources load via HTTPS
- [ ] **Authentication works:** Test Supabase Auth login/logout
- [ ] **Edge functions callable:** Test prospect submission → email sent

### Test Script (PowerShell)
```powershell
# Test homepage
$response = Invoke-WebRequest -Uri "https://bitwealth.co.za/" -UseBasicParsing
Write-Host "Homepage Status: $($response.StatusCode)" -ForegroundColor Green

# Test customer portal
$response = Invoke-WebRequest -Uri "https://bitwealth.co.za/customer-portal.html" -UseBasicParsing
Write-Host "Portal Status: $($response.StatusCode)" -ForegroundColor Green

# Test prospect form submission (with test data)
$body = @{
    first_names = "Test"
    last_name = "Production"
    email = "test.production@example.com"
    phone = "+27123456789"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_prospect_submit" `
    -Method Post `
    -Headers @{ "Content-Type" = "application/json" } `
    -Body $body

Write-Host "Prospect Submit: $($response.message)" -ForegroundColor Green
```

---

## Step 9: Update Documentation

After successful deployment, update these files:

### PRE_DEPLOYMENT_CHECKLIST.md
```markdown
### Production Deployment (COMPLETE)
- [x] Domain: bitwealth.co.za ✅
- [x] SSL certificate: Let's Encrypt (auto-renewing) ✅
- [x] Hosting: Netlify (or Vercel/GitHub Pages) ✅
- [x] WEBSITE_URL environment variable updated ✅
- [x] CORS settings in Supabase updated ✅
```

### NEXT_STEPS_MVP_LAUNCH.md
```markdown
### Day 22 (Jan 7, 2026) - PRODUCTION SETUP
- [x] Configure production domain (bitwealth.co.za) ✅
- [x] Configure SSL certificate (Let's Encrypt) ✅
- [x] Deploy website files to Netlify ✅
- [x] Update WEBSITE_URL environment variable ✅
- [x] Test all pages accessible via HTTPS ✅
```

---

## Troubleshooting

### Issue: DNS not propagating
**Solution:**
- Wait 5-60 minutes for DNS propagation
- Check DNS: `nslookup bitwealth.co.za`
- Use different DNS: `nslookup bitwealth.co.za 8.8.8.8`

### Issue: SSL certificate not issued
**Solution:**
- Verify domain points to hosting provider
- Check CAA records not blocking Let's Encrypt
- Wait up to 24 hours for GitHub Pages SSL

### Issue: Mixed content warnings
**Solution:**
- Replace all `http://` with `https://` in HTML/JS files
- Update Supabase URLs to use HTTPS
- Check browser console for specific blocked resources

### Issue: Authentication not working
**Solution:**
- Verify CORS settings include production domain
- Check Supabase Auth URL settings
- Clear browser cookies and try again

### Issue: Edge functions failing
**Solution:**
- Verify WEBSITE_URL environment variable updated
- Redeploy edge functions after env var change
- Check Supabase logs for specific errors

---

## Cost Estimate

| Service | Plan | Cost/Month | Notes |
|---------|------|------------|-------|
| Netlify | Free Tier | R0 | 100GB bandwidth, 300 build minutes |
| Vercel | Free Tier | R0 | 100GB bandwidth, unlimited builds |
| GitHub Pages | Free | R0 | Public repos only |
| Domain (.co.za) | Standard | R100-200 | Annual renewal |
| SSL Certificate | Let's Encrypt | R0 | Auto-renewing via hosting provider |

**Recommendation:** Start with Netlify or Vercel free tier. Upgrade if needed later.

---

## Production Checklist Summary

- [ ] **Choose hosting provider** (Netlify recommended)
- [ ] **Deploy website files**
- [ ] **Configure custom domain** (bitwealth.co.za)
- [ ] **Configure DNS records** (A/CNAME)
- [ ] **Enable SSL/HTTPS** (automatic via hosting)
- [ ] **Update CORS in Supabase** (add production domain)
- [ ] **Update WEBSITE_URL env var** (https://bitwealth.co.za)
- [ ] **Redeploy edge functions** (ef_confirm_strategy, ef_send_email)
- [ ] **Test all pages via HTTPS**
- [ ] **Update documentation**

**Total Time:** 1-2 hours (excluding DNS propagation)  
**Status:** Ready to proceed  
**Next Step:** Choose hosting provider and begin deployment

---

**Document Status:** Production Configuration Guide  
**Created:** 2026-01-06  
**Owner:** Davin Gaier
