# BitWealth Website

Welcome to your new BitWealth website! This is a modern, professional website for your Bitcoin DCA investment platform.

## 🎨 Design

The website uses your brand colors:
- **Primary Dark Blue**: #003F5C
- **Gold/Yellow**: #FFB400
- **Dark background with modern, clean aesthetic**
- **Similar style to ultrasound.money** with data-driven design

## 📁 File Structure

```
website/
├── index.html          # Main homepage
├── portal.html         # Client portal/dashboard
├── css/
│   ├── styles.css      # Main website styles
│   └── portal.css      # Client portal styles
├── js/
│   ├── main.js         # Main website JavaScript
│   └── portal.js       # Portal functionality
└── images/
    └── logo.svg        # BitWealth logo
```

## 🚀 How to View the Website

### Option 1: Open Directly in Browser
1. Navigate to the `website` folder
2. Double-click `index.html` to open in your browser
3. For the portal, double-click `portal.html`

### Option 2: Use Live Server (Recommended)
1. Install VS Code extension: "Live Server" by Ritwick Dey
2. Right-click on `index.html`
3. Select "Open with Live Server"
4. Your website will open at `http://localhost:5500`

### Option 3: Use Python (if installed)
1. Open terminal in the `website` folder
2. Run: `python -m http.server 8000`
3. Open browser to: `http://localhost:8000`

## 📄 Pages

### Homepage (index.html)
- **Hero Section**: Eye-catching header with animated stats
- **Strategy Section**: Overview of your investment approach
- **How It Works**: Step-by-step timeline
- **Pricing**: Three pricing tiers (Starter, Professional, Enterprise)
- **About**: Company information
- **Sign-up Form**: Email collection
- **Contact**: Contact form and information
- **Footer**: Links and legal information

### Client Portal (portal.html)
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
Replace `website/images/logo.svg` with your actual logo file.

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
