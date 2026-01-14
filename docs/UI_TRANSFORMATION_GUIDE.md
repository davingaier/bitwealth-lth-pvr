# Customer Portal UI Transformation Guide

**Date:** January 14, 2026  
**Author:** Dav / GPT  
**Objective:** Transform customer-portal.html to use professional dashboard design from portal.html

---

## Executive Summary

**Current Status:**
- ✅ Transaction History feature COMPLETE (deployed 2026-01-05)
- ✅ Backend integration functional (Supabase, RPC functions, authentication)
- ⚠️ UI needs upgrade from basic card layout to professional dashboard

**Goal:**
Merge the **functional backend** of customer-portal.html with the **professional design** of portal.html, creating a production-ready customer dashboard.

---

## Current State Analysis

### customer-portal.html (Production, Basic UI)
**Strengths:**
- ✅ Real Supabase authentication working
- ✅ Customer data loading (balances, transactions, portfolios)
- ✅ Transaction history table fully functional
- ✅ Onboarding status tracker (unique feature)
- ✅ RPC functions: `get_customer_onboarding_status`, `list_customer_portfolios`, `list_customer_transactions`

**Weaknesses:**
- ❌ Basic card-based layout (single column)
- ❌ Blue gradient background (dated)
- ❌ No navigation structure
- ❌ Inline styles mixed with external CSS
- ❌ No visual hierarchy or modern components

**Line Count:** 593 lines

---

### portal.html (Demo, Professional UI)
**Strengths:**
- ✅ Modern dark theme dashboard
- ✅ Sidebar navigation with icons
- ✅ Professional stat boxes with icons
- ✅ Activity feed component
- ✅ Responsive design (mobile, tablet, desktop)
- ✅ CSS variables for theming
- ✅ Inter font family (professional typography)

**Weaknesses:**
- ❌ Demo data only (no backend)
- ❌ No authentication
- ❌ Static content
- ❌ Login screen never used (portal handles auth)

**Line Count:** 235 lines HTML + 513 lines CSS (portal.css)

---

## Transformation Plan

### Phase 1: Structure and Layout (2-3 hours)

#### Step 1.1: Import CSS and Fonts
```html
<!-- BEFORE (customer-portal.html head) -->
<link rel="stylesheet" href="css/styles.css">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

<!-- AFTER -->
<link rel="stylesheet" href="css/styles.css">
<link rel="stylesheet" href="css/portal.css">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

#### Step 1.2: Replace Body Structure
```html
<!-- BEFORE: Single container layout -->
<body>
    <div class="container">
        <div class="header">...</div>
        <div class="card">...</div>
    </div>
</body>

<!-- AFTER: Sidebar + Main layout -->
<body>
    <div class="dashboard-container">
        <!-- Sidebar -->
        <aside class="dashboard-sidebar">
            <div class="sidebar-header">
                <img src="images/logo.png" alt="BitWealth Logo" style="padding: 4px;">
                <span>BitWealth</span>
            </div>
            
            <nav class="sidebar-nav">
                <a href="#dashboard" class="nav-item active">
                    <span class="icon">📊</span>
                    <span>Dashboard</span>
                </a>
                <a href="#onboarding" class="nav-item">
                    <span class="icon">🎯</span>
                    <span>Onboarding</span>
                </a>
                <a href="#transactions" class="nav-item">
                    <span class="icon">📜</span>
                    <span>Transactions</span>
                </a>
                <a href="#statements" class="nav-item">
                    <span class="icon">📄</span>
                    <span>Statements</span>
                </a>
                <a href="#withdrawals" class="nav-item">
                    <span class="icon">💸</span>
                    <span>Withdrawals</span>
                </a>
                <a href="#settings" class="nav-item">
                    <span class="icon">⚙️</span>
                    <span>Settings</span>
                </a>
            </nav>
            
            <div class="sidebar-footer">
                <button class="btn-secondary btn-block" onclick="logout()">Sign Out</button>
            </div>
        </aside>

        <!-- Main Content -->
        <main class="dashboard-main">
            <!-- Header -->
            <header class="dashboard-header">
                <div>
                    <h1>Welcome, <span id="customerName">...</span>! 👋</h1>
                    <p class="text-secondary">Your BitWealth Investment Dashboard</p>
                </div>
                <div class="header-actions">
                    <button class="btn-secondary" id="downloadStatement" style="display: none;">Download Statement</button>
                    <div class="user-avatar" id="userAvatar">?</div>
                </div>
            </header>

            <div id="loading" class="loading">Loading your portfolio data...</div>

            <div id="content" style="display: none;">
                <!-- Dashboard content goes here -->
            </div>
        </main>
    </div>
</body>
```

#### Step 1.3: Transform Stats Display
```html
<!-- BEFORE: Card with stats grid -->
<div class="card">
    <h2>📊 Portfolio Dashboard</h2>
    <div id="dashboardData" style="display: none;">
        <div class="stats-grid">
            <div class="stat-box">...</div>
        </div>
    </div>
</div>

<!-- AFTER: Direct dashboard-stats grid -->
<div class="dashboard-stats" id="dashboardStats" style="display: none;">
    <div class="stat-box">
        <div class="stat-header">
            <span>Net Asset Value</span>
            <span class="stat-icon">💰</span>
        </div>
        <div class="stat-value" id="navValue">$0.00</div>
        <div class="stat-change positive" id="navChange">--</div>
    </div>

    <div class="stat-box">
        <div class="stat-header">
            <span>BTC Holdings</span>
            <span class="stat-icon">₿</span>
        </div>
        <div class="stat-value" id="btcValue">0.00000000</div>
        <div class="stat-change neutral" id="btcUsd">--</div>
    </div>

    <div class="stat-box">
        <div class="stat-header">
            <span>USDT Balance</span>
            <span class="stat-icon">💵</span>
        </div>
        <div class="stat-value" id="usdtValue">$0.00</div>
        <div class="stat-change neutral">Cash reserves</div>
    </div>

    <div class="stat-box">
        <div class="stat-header">
            <span>Total Returns</span>
            <span class="stat-icon">📈</span>
        </div>
        <div class="stat-value" id="roiValue">--</div>
        <div class="stat-change positive" id="roiProfit">--</div>
    </div>
</div>
```

---

### Phase 2: Preserve Functionality (1-2 hours)

#### Step 2.1: Keep Authentication Logic
```javascript
// NO CHANGES NEEDED - Keep existing initPortal() function
async function initPortal() {
    const { data: { session }, error } = await sb.auth.getSession();
    if (error || !session) {
        window.location.href = 'login.html';
        return;
    }
    currentUser = session.user;
    await loadCustomerData();
}
```

#### Step 2.2: Update loadCustomerData() for User Avatar
```javascript
async function loadCustomerData() {
    try {
        const { data: customers, error: customerError } = await sb
            .from('customer_details')
            .select('*')
            .eq('email', currentUser.email)
            .order('customer_id', { ascending: false })
            .limit(1);

        if (customerError || !customers || customers.length === 0) throw customerError;
        
        customerData = customers[0];
        
        // Update header
        document.getElementById('customerName').textContent = 
            `${customerData.first_names} ${customerData.last_name}`;
        
        // NEW: Set user avatar initials
        const initials = (customerData.first_names?.[0] || '') + (customerData.last_name?.[0] || '');
        document.getElementById('userAvatar').textContent = initials.toUpperCase();
        
        // Load data...
        await loadOnboardingStatus(customerData.customer_id);
        await loadPortfolios(customerData.customer_id);
        await loadDashboard(customerData.customer_id);
        await loadTransactionHistory(customerData.customer_id);
        
        // Show content
        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';
    } catch (error) {
        console.error('Error loading customer data:', error);
        alert('Error loading your data. Please try again or contact support.');
    }
}
```

#### Step 2.3: Update loadDashboard() for New Stat Boxes
```javascript
async function loadDashboard(customerId) {
    try {
        const { data: balances, error } = await sb
            .from('balances_daily')
            .select('*')
            .eq('customer_id', customerId)
            .order('date', { ascending: false })
            .limit(1);

        if (error) throw error;

        if (!balances || balances.length === 0) {
            // Show "Trading starts tomorrow" message
            document.getElementById('noDataMessage').style.display = 'block';
            return;
        }

        const latest = balances[0];
        
        // Calculate values
        const nav = parseFloat(latest.nav_usd);
        const btc = parseFloat(latest.btc_bal);
        const usdt = parseFloat(latest.usdt_bal);
        const btcPrice = parseFloat(latest.btc_price);
        const totalContrib = parseFloat(latest.total_contributions);
        const profit = nav - totalContrib;
        const roi = totalContrib > 0 ? ((profit / totalContrib) * 100) : 0;
        
        // Update stat boxes
        document.getElementById('navValue').textContent = `$${nav.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        document.getElementById('btcValue').textContent = `${btc.toFixed(8)} BTC`;
        document.getElementById('btcUsd').textContent = `@ $${btcPrice.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;
        document.getElementById('usdtValue').textContent = `$${usdt.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        document.getElementById('roiValue').textContent = `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`;
        document.getElementById('roiProfit').textContent = `${profit >= 0 ? '+' : ''}$${Math.abs(profit).toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})} profit`;
        
        // Update change indicator colors
        const roiChangeEl = document.getElementById('roiProfit').parentElement.querySelector('.stat-change');
        if (roiChangeEl) {
            roiChangeEl.className = roi >= 0 ? 'stat-change positive' : 'stat-change negative';
        }
        
        // Show stats
        document.getElementById('dashboardStats').style.display = 'grid';
        document.getElementById('noDataMessage').style.display = 'none';
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
        document.getElementById('noDataMessage').innerHTML = 
            '<strong>⚠️ Unable to Load Dashboard</strong><br>' +
            'There was an error loading your portfolio data. Please refresh the page or contact support if the problem persists.';
        document.getElementById('noDataMessage').style.display = 'block';
    }
}
```

#### Step 2.4: Keep Transaction History Unchanged
```javascript
// NO CHANGES NEEDED - Keep existing loadTransactionHistory() function
// Already uses modern table styling with color coding
```

---

### Phase 3: Add New Features (1-2 hours)

#### Step 3.1: Recent Activity Card (from Transactions)
```html
<!-- Add after dashboard-stats -->
<div class="dashboard-grid">
    <!-- Recent Activity -->
    <div class="dashboard-card">
        <div class="card-header">
            <h2>Recent Activity</h2>
            <a href="#transactions" class="link-primary">View all</a>
        </div>
        <div class="activity-list" id="recentActivity">
            <!-- Populated by JavaScript -->
        </div>
    </div>

    <!-- Strategy Metrics -->
    <div class="dashboard-card">
        <div class="card-header">
            <h2>Strategy Metrics</h2>
        </div>
        <div class="metrics-list" id="strategyMetrics">
            <!-- Populated by JavaScript -->
        </div>
    </div>
</div>
```

#### Step 3.2: Populate Recent Activity
```javascript
async function loadRecentActivity(customerId) {
    try {
        const { data: transactions, error } = await sb.rpc('list_customer_transactions', {
            p_customer_id: customerId,
            p_limit: 5
        });

        if (error) throw error;

        if (!transactions || transactions.length === 0) {
            document.getElementById('recentActivity').innerHTML = 
                '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No recent activity</p>';
            return;
        }

        document.getElementById('recentActivity').innerHTML = transactions.map(tx => {
            const date = new Date(tx.trade_date);
            const timeAgo = getTimeAgo(date);
            
            let icon = '📊';
            let iconClass = 'buy';
            if (tx.kind === 'buy') { icon = '📈'; iconClass = 'buy'; }
            else if (tx.kind === 'sell') { icon = '📉'; iconClass = 'sell'; }
            else if (tx.kind === 'topup' || tx.kind === 'deposit') { icon = '💳'; iconClass = 'deposit'; }
            
            const amount = parseFloat(tx.amount_btc) !== 0 
                ? `${Math.abs(parseFloat(tx.amount_btc)).toFixed(8)} BTC`
                : `$${Math.abs(parseFloat(tx.amount_usdt)).toFixed(2)}`;
            
            return `
                <div class="activity-item">
                    <div class="activity-icon ${iconClass}">${icon}</div>
                    <div class="activity-details">
                        <div class="activity-title">${tx.kind === 'topup' ? 'Deposit' : tx.kind.charAt(0).toUpperCase() + tx.kind.slice(1)}</div>
                        <div class="activity-date">${timeAgo}</div>
                    </div>
                    <div class="activity-amount">${amount}</div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading recent activity:', error);
    }
}

function getTimeAgo(date) {
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    return date.toLocaleDateString();
}
```

#### Step 3.3: Populate Strategy Metrics
```javascript
async function loadStrategyMetrics(customerId) {
    try {
        const { data: portfolios, error } = await sb.rpc('list_customer_portfolios', {
            p_customer_id: customerId
        });

        if (error) throw error;

        const portfolio = portfolios && portfolios.length > 0 ? portfolios[0] : null;
        
        if (!portfolio) {
            document.getElementById('strategyMetrics').innerHTML = 
                '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No portfolio data</p>';
            return;
        }

        const { data: txCount, error: txError } = await sb.rpc('list_customer_transactions', {
            p_customer_id: customerId,
            p_limit: 1000
        });

        const totalTrades = txCount ? txCount.filter(tx => tx.kind === 'buy' || tx.kind === 'sell').length : 0;
        const createdDate = new Date(portfolio.created_at);
        const activeSince = createdDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

        document.getElementById('strategyMetrics').innerHTML = `
            <div class="metric-item">
                <span>Strategy</span>
                <span class="metric-value">${portfolio.strategy_code || 'LTH_PVR'}</span>
            </div>
            <div class="metric-item">
                <span>Status</span>
                <span class="metric-value">${portfolio.status || 'ACTIVE'}</span>
            </div>
            <div class="metric-item">
                <span>Total Trades</span>
                <span class="metric-value">${totalTrades}</span>
            </div>
            <div class="metric-item">
                <span>Active Since</span>
                <span class="metric-value">${activeSince}</span>
            </div>
        `;
    } catch (error) {
        console.error('Error loading strategy metrics:', error);
    }
}
```

#### Step 3.4: Update initPortal() to Call New Functions
```javascript
async function loadCustomerData() {
    // ... existing code ...
    
    await loadOnboardingStatus(customerData.customer_id);
    await loadPortfolios(customerData.customer_id);
    await loadDashboard(customerData.customer_id);
    await loadRecentActivity(customerData.customer_id); // NEW
    await loadStrategyMetrics(customerData.customer_id); // NEW
    await loadTransactionHistory(customerData.customer_id);
    
    // Show content
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
}
```

---

### Phase 4: Testing & Cleanup (30 min)

#### Step 4.1: Test Checklist
- [ ] Login works (redirect from login.html)
- [ ] User avatar shows correct initials
- [ ] Dashboard stats display correctly
- [ ] Recent Activity shows last 5 transactions
- [ ] Strategy Metrics displays portfolio info
- [ ] Transaction history table still works
- [ ] Onboarding status tracker preserved
- [ ] Sidebar navigation responds to hover
- [ ] Logout button works
- [ ] Responsive design works on mobile (sidebar collapses)
- [ ] No console errors
- [ ] All RPC functions return data successfully

#### Step 4.2: Files to Delete
```
website/portal.html (demo file)
website/js/portal.js (demo script)
```

#### Step 4.3: Files to Update
```
website/login.html - Confirm redirect points to customer-portal.html (already does)
```

---

## Implementation Order

### Session 1 (2-3 hours): Core Structure
1. Add CSS imports and Inter font to customer-portal.html
2. Replace body structure with sidebar + main layout
3. Transform stats display from cards to dashboard-stats grid
4. Update JavaScript to populate new stat boxes
5. Test: Login, stats display, logout

### Session 2 (1-2 hours): Preserve Features
6. Keep all existing RPC calls unchanged
7. Add user avatar initials logic
8. Verify transaction history still works
9. Verify onboarding status tracker preserved
10. Test: All existing features functional

### Session 3 (1-2 hours): New Features
11. Add Recent Activity card + populate function
12. Add Strategy Metrics card + populate function
13. Make sidebar navigation items clickable (scroll to sections)
14. Add Download Statement button (placeholder)
15. Test: New features working

### Session 4 (30 min): Cleanup
16. Delete portal.html and portal.js
17. Test full user journey (login → dashboard → logout)
18. Test responsive design (mobile, tablet, desktop)
19. Deploy to production

---

## Expected Outcome

**Before:**
- Basic card-based UI
- Blue gradient background
- No navigation
- Functional but dated appearance

**After:**
- Professional dark theme dashboard
- Sidebar navigation with icons
- Modern stat boxes with real data
- Recent Activity and Strategy Metrics cards
- User avatar with initials
- Responsive design
- Production-ready appearance

**Total Effort:** 4-6 hours  
**Risk:** Low (preserving all existing functionality)  
**Value:** High (professional appearance, better UX, future-ready structure)

---

**Document Status:** Implementation Ready  
**Last Updated:** January 14, 2026  
**Next Step:** Begin Session 1 (Core Structure)
