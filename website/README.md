# BitWealth Website

Static marketing site + client/partner portals for BitWealth, deployed on Netlify (see `QUICK_START.md`).
Backed by Supabase (anon key only in the browser; everything sensitive goes through SECURITY DEFINER RPCs and edge functions).

## 🎨 Design

Brand palette and typography follow `docs/Marketing/BitWealth_Brand_Guide.html`:
- **Primary Dark Blue** `#003F5C` · **Gold** `#FFB400` · dark backgrounds `#0A0F1E` / `#050A14` / cards `#151B2E`
- **Inter** from Google Fonts
- Nav logo = `images/bitwealth_icon_ondark_cropped.png` (icon-on-dark mark, no border) + "BitWealth" wordmark text
- Icons are **inline SVG sprites** (stroke = currentColor, brand gold) — no icon font / CDN

## 📁 File Structure

```
website/
├── index.html               # Homepage: hero (back-tested facts), approach, how it works, product pipeline, about, sign-up, contact (physical address)
├── sth-cb.html              # PRODUCT: STH Cost Basis Strategy (Hybrid v2.2) — concepts only (no thresholds), live 5-yr chart, pricing, risks
├── sth-cb-backtest.html     # PUBLIC BACK-TESTER for the STH Cost Basis Strategy (email + reCAPTCHA, 10 runs/day, USDPC toggle)
├── lth-pvr.html             # Legacy LTH PVR product page (kept, no longer linked from the site)
├── lth-pvr-backtest.html    # Legacy LTH PVR public back-tester (kept, linked only from lth-pvr.html)
├── login.html / register.html / customer-portal.html   # Client auth + portal
├── partner-login.html / partner-portal.html             # Partner (custodian) portal
├── upload-kyc.html          # KYC document upload
├── legal/                   # privacy-policy, terms-of-service, investment-disclaimer
├── css/  styles.css (site) · portal.css (portal) · landing.css (unused legacy)
├── js/   main.js (nav, counters, animations) · landing-chart.js
├── images/  bitwealth_icon_ondark_cropped.png (nav/login icon) · logo.png (old, unused)
└── favicon/
```

## 🔌 Supabase wiring (public pages)

| Page | Reads | Writes / triggers |
|---|---|---|
| `index.html` | — | `ef_prospect_submit` (sign-up form), `ef_contact_form_submit` (contact form) |
| `sth-cb.html` | `rpc/get_marketing_chart('sth_cb_5yr')` — cached trailing-5-year back-test refreshed monthly by `ef_refresh_marketing_charts` | — |
| `sth-cb-backtest.html` | polls `rpc/get_sth_cb_backtest_results(request_id)` every 2 s | `ef_submit_public_backtest` with `p_strategy: 'sth_cb'` → `create_public_sth_cb_backtest_run` → `ef_sth_cb_bt_execute` |
| `lth-pvr.html` | `rpc/get_lth_pvr_marketing_chart()` | — |
| `lth-pvr-backtest.html` | polls `rpc/get_backtest_results` | `ef_submit_public_backtest` (default strategy `lth_pvr`) |

The public STH CB back-tester always runs the **live Hybrid v2.2 configuration** — the run copies `extras` from
`sth_cb.tracker_config` (`hybrid_v2_2`), so the website, the daily tracker and the Admin UI preset share one source of truth.
Fee model on the public tool and product page: 1 % p.a. management + 10 % performance (HWM), VALR 8/18 bps, USDPC optional.

## 🚀 How to View the Website Locally

1. Double-click `index.html`, or
2. VS Code → "Live Server" extension → *Open with Live Server*, or
3. `python -m http.server 8000` inside `website/`

reCAPTCHA shows "Invalid domain for site key" on `file://` / localhost — expected; it works on the production domain.

## 📄 Pages (details)

### Homepage (index.html)
- **Hero**: "Intelligent Bitcoin Accumulation" + four **back-tested** STH CB facts (32.6× HODL in-sample · 2.1× out-of-sample · 54 % OOS max DD · 20/20 OOS fits beat holding — Binance UTC closes; v2.2 with the 4-day capitulation gate since 2026-11-06) with an explicit "research results, not live trading" note
- **Our Approach**: six SVG-icon cards (on-chain intelligence, rules not opinions, buy fear/sell greed, guard-rails, own exchange sub-account, transparency)
- **How It Works**: four-step timeline (interest → onboard & fund → automate → track)
- **Product Pipeline**: flagship STH Cost Basis Strategy card → `sth-cb.html`, plus five "coming soon" cards
- **About**: mission copy + SVG cycle illustration (no fabricated AUM/client numbers)
- **Express Your Interest** form (individual / entity) and **Contact** (info@, support@, office address: 89 Bloekom Curve, Terenure, Kempton Park, Gauteng, South Africa, 1619)

### Client Portal (customer-portal.html)
- **Login Screen**: Secure client authentication
- **Dashboard**: 
  - Portfolio overview with key metrics
  - Performance charts (placeholder for Chart.js integration)
  - Recent activity feed
  - Strategy metrics
- **Navigation**: Sidebar with multiple sections (Portfolio, Performance, Statements, Withdrawals, Settings)

## 🎯 Features

### Interactive Elements
- ✅ Smooth scrolling navigation
- ✅ Animated statistics counters
- ✅ Hover effects on cards and buttons
- ✅ Responsive mobile menu
- ✅ Parallax background effects
- ✅ Form validation
- ✅ Login/logout functionality (demo mode)

### Responsive Design
- Desktop (1200px+)
- Tablet (768px - 1199px)
- Mobile (< 768px)

## 🔧 Customization

### Update Logo
The nav/login mark is `website/images/bitwealth_icon_ondark_cropped.png` (copied from `/logos`). Keep the wordmark as text next to it.

### Update Content
Edit `index.html` to change:
- Company description
- Pricing plans
- Contact information
- Social media links

### Update Colors
Edit `website/css/styles.css` - look for the `:root` section at the top:
```css
:root {
    --primary-dark: #003F5C;
    --gold: #FFB400;
    /* ... more colors */
}
```

### Add Real Charts
The portal has a placeholder for charts. To add real charts:
1. Install Chart.js: `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>`
2. Replace the `.chart-placeholder` div with a canvas element
3. Initialize charts in `js/portal.js`

## 🔐 Client Portal

The portal is currently in **demo mode**:
- Enter any email/password to login
- Click "Sign Out" to return to login screen
- Session is stored in browser sessionStorage

### To Make It Production-Ready:
1. Connect login form to your authentication backend
2. Add JWT token management
3. Implement real API calls for portfolio data
4. Add proper error handling
5. Add 2FA authentication
6. Connect to your Supabase backend

## 📱 Mobile Responsive

The website is fully responsive and works on:
- Large desktops (1920px+)
- Standard desktops (1200px+)
- Tablets (768px - 1199px)
- Mobile phones (< 768px)

## 🎨 Typography

The website uses **Inter** font family from Google Fonts, which is:
- Modern and professional
- Highly readable
- Used by many fintech companies

## 🚀 Next Steps

### For Launch:
1. **Domain & Hosting**: 
   - Get a domain name (e.g., bitwealth.com)
   - Host on Netlify, Vercel, or AWS

2. **Backend Integration**:
   - Connect forms to your email service
   - Set up user authentication
   - Connect to your Supabase database

3. **Analytics**:
   - Add Google Analytics
   - Add conversion tracking

4. **SEO**:
   - Add meta descriptions
   - Add Open Graph tags for social sharing
   - Create sitemap.xml
   - Submit to Google Search Console

5. **Legal**:
   - Add Privacy Policy
   - Add Terms of Service
   - Add Cookie Consent banner
   - Add necessary financial disclaimers

6. **Content**:
   - Professional photography
   - Real company information
   - Client testimonials
   - Blog/educational content

### For Enhancement:
- Add blog section for Bitcoin education
- Add FAQ accordion
- Add live chat support
- Add email newsletter signup
- Add crypto price widgets
- Add comparison calculators
- Add testimonials slider
- Add team member profiles

## 💡 Tips

1. **Images**: Replace placeholder emojis with professional icons or images
2. **Copy**: Update all text to match your brand voice
3. **Links**: Update all `href="#"` links to real destinations
4. **Forms**: Connect forms to your backend API or email service
5. **Testing**: Test on multiple devices and browsers

## 🐛 Known Limitations

- Charts are placeholders (need Chart.js integration)
- Forms show alerts instead of real submission
- Portal login accepts any credentials (demo mode)
- No backend connection yet
- Images are SVG placeholders

## 📞 Support

For questions about this website template, you can:
1. Review the code comments in each file
2. Check the browser console for any errors
3. Use browser DevTools to inspect elements

## 📄 License

This website is created for BitWealth. All rights reserved.

---

**Enjoy your new website! 🎉**
