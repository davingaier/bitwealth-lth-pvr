# Public Back-Testing Tool - Build Plan

**Author:** Dav / GPT  
**Created:** 2026-01-08  
**Status:** Architecture design complete, awaiting implementation  
**Target Completion:** 2026-01-17 (9 working days)

---

## Executive Summary

**Objective:** Build public-facing marketing website with interactive back-testing tool to convert prospects into customers.

**Business Case:**
- Current website is basic landing page with prospect form
- Prospects have no way to experience the strategy before committing
- Interactive back-tester provides "try before you buy" experience
- Email gating captures qualified leads with demonstrated interest
- Analytics track prospect behavior to optimize conversion funnel

**Success Metrics:**
- Prospect conversion rate: Track email submissions → prospect form completions
- Back-tester engagement: Average parameters used, completion rate
- Lead quality: Track which back-test results correlate with customer sign-ups

---

## Phase 2A: Landing Page Redesign (Days 1-2)

### Objective
Transform basic landing page into professional multi-product showcase with compelling value proposition and performance preview.

### Components

#### 1. Hero Section (website/index.html)
**Layout:**
```
+---------------------------------------------------------------+
| [BitWealth Logo]                                     [Login]  |
+---------------------------------------------------------------+
|                                                               |
|    Smart Bitcoin Accumulation Using On-Chain Intelligence    |
|                                                               |
|    [Performance Chart: LTH PVR vs Standard DCA]              |
|    [2020-2025 ROI Statistics Side-by-Side]                   |
|                                                               |
|    [ Try Our Interactive Back-Tester → ]                     |
|                                                               |
+---------------------------------------------------------------+
```

**Content:**
- **H1 Headline:** "Smart Bitcoin Accumulation Using On-Chain Intelligence"
- **Subheadline:** "Automated BTC accumulation that buys more when cheap and sells risk when euphoric — auditable, transparent, rules-based"
- **Performance Chart:** 
  - Line chart showing NAV growth 2020-01-01 to 2025-12-31
  - LTH PVR strategy: Navy blue (#003B73)
  - Standard DCA: Gray (#CCCCCC)
  - X-axis: Years (2020, 2021, 2022, 2023, 2024, 2025)
  - Y-axis: NAV in USD (logarithmic scale recommended)
- **ROI Statistics Cards:**
  ```
  +-------------------------+  +-------------------------+
  | LTH PVR Strategy        |  | Standard DCA            |
  | ROI: +XXX%              |  | ROI: +XXX%              |
  | Period: 2020-2025       |  | Period: 2020-2025       |
  +-------------------------+  +-------------------------+
  ```
- **CTA Button:** "Try Our Interactive Back-Tester" (gold #F39C12, links to #product-catalog section)

**Technical Requirements:**
- Chart library: Chart.js (lightweight, responsive)
- Data source: Query `lth_pvr_bt.bt_results_daily` + calculate Standard DCA equivalent
- Responsive: Stack cards vertically on mobile, reduce chart height
- Performance: Lazy load chart data after page render

**Data Calculation (one-time):**
- Run back-test for LTH PVR from 2020-01-01 to 2025-12-31 (upfront: $10,000, monthly: $5,000)
- Calculate Standard DCA for same parameters
- Extract final NAV and ROI % for both strategies
- Hardcode values in HTML (no dynamic queries for landing page performance)

#### 2. Product Catalog Section
**Content:**
```
+---------------------------------------------------------------+
|                     Our Product Pipeline                      |
+---------------------------------------------------------------+
|                                                               |
|  +----------------------------------------------------------+ |
|  | LTH PVR: Medium-Risk Bitcoin-Altcoin Pairing Growth      | |
|  |                                                          | |
|  | Leverages Long-Term Holder on-chain metrics to           | |
|  | capitalize when BTC is undervalued (buy more) or         | |
|  | overvalued (reduce exposure). Automated daily            | |
|  | rebalancing, transparent rules, full audit trail.        | |
|  |                                                          | |
|  | [ Learn More & Try Back-Tester → ]                      | |
|  +----------------------------------------------------------+ |
|                                                               |
|  +----------------------------------------------------------+ |
|  | Coming Soon: Wealth Multiplier Strategies                | |
|  |                                                          | |
|  | Strategic debt leveraging to multiply wealth across      | |
|  | crypto and non-crypto assets. Various strategies for     | |
|  | different risk appetites and investment horizons.        | |
|  |                                                          | |
|  | [ Join Waitlist → ]                                      | |
|  +----------------------------------------------------------+ |
|                                                               |
|  +----------------------------------------------------------+ |
|  | Coming Soon: Bitcoin Lending Retirement Annuity          | |
|  |                                                          | |
|  | Loan capital against BTC holdings to fund retirement     | |
|  | lifestyle while BTC continues appreciating. Precision    | |
|  | lending with institutional-grade risk management.        | |
|  |                                                          | |
|  | [ Join Waitlist → ]                                      | |
|  +----------------------------------------------------------+ |
|                                                               |
|  +----------------------------------------------------------+ |
|  | Coming Soon: Low-Risk Bitcoin Income Strategy            | |
|  |                                                          | |
|  | Combine lending, staking, and covered call strategies    | |
|  | to generate predictable income from BTC holdings.        | |
|  | Conservative approach for income-focused investors.      | |
|  |                                                          | |
|  | [ Join Waitlist → ]                                      | |
|  +----------------------------------------------------------+ |
|                                                               |
+---------------------------------------------------------------+
```

**Design:**
- Card-based layout with consistent spacing
- Active product (LTH PVR): Full color, detailed description, prominent CTA
- Future products: Muted colors, shorter descriptions, "Coming Soon" badge, "Join Waitlist" CTA
- Responsive: Single column on mobile, 2-column on tablet, 2x2 grid on desktop

**Copy Enhancement (from Lean Canvas):**
- LTH PVR card: Emphasize "transparent, rules-based BTC accumulation that buys more when cheap and sells risk when euphoric"
- Highlight: "Built around long-term holder behaviour if LTH PVR valuation bands"
- Value prop: "Managed service model (portfolio managers + annual reviews as you scale)"

#### 3. Trust Section
**Content:**
```
+---------------------------------------------------------------+
|                  Why Choose BitWealth?                        |
+---------------------------------------------------------------+
|                                                               |
|  ✓ Founder Experience: Battle-tested by founder who learned  |
|    from real BTC cycle mistakes over multiple years          |
|                                                               |
|  ✓ Transparent Rules: Every trade based on auditable         |
|    on-chain data — no black-box algorithms                   |
|                                                               |
|  ✓ End-to-End System: Data → rules → orders → reporting      |
|    fully integrated and automated                            |
|                                                               |
|  ✓ Built for Discipline: Removes emotional buying/selling    |
|    — automation enforces strategy adherence                  |
|                                                               |
+---------------------------------------------------------------+
```

**Files to Create/Modify:**
- `website/index.html` - Complete redesign
- `website/css/landing.css` - New stylesheet for landing page
- `website/js/landing-chart.js` - Chart.js implementation for performance preview

**Deliverables:**
- [ ] Redesigned landing page with hero section, performance chart, ROI statistics
- [ ] Product catalog section with 4 product cards (1 active, 3 coming soon)
- [ ] Trust/value proposition section
- [ ] Responsive CSS for mobile/tablet/desktop
- [ ] Performance chart with hardcoded 2020-2025 data

---

## Phase 2B: LTH PVR Product Page (Days 3-4)

### Objective
Dedicated product page explaining LTH PVR strategy in depth, showing historical performance, and driving prospects to back-tester.

### Components

#### 1. Product Page Header (website/lth-pvr.html)
```
+---------------------------------------------------------------+
| [BitWealth Logo]  LTH PVR Strategy               [Login]     |
+---------------------------------------------------------------+
|                                                               |
|   Medium-Risk Bitcoin Accumulation Using On-Chain Intelligence|
|                                                               |
|   Rule-based strategy that capitalizes on BTC market cycles  |
|   by monitoring Long-Term Holder behavior and price variance |
|                                                               |
|   [ Try the Interactive Back-Tester → ]                      |
|                                                               |
+---------------------------------------------------------------+
```

#### 2. How It Works Section
**Content Structure:**
```
+---------------------------------------------------------------+
|                      How LTH PVR Works                        |
+---------------------------------------------------------------+
|                                                               |
| 1. On-Chain Intelligence                                      |
|    We monitor Long-Term Holder Profit to Volatility Ratio (LTH PVR) |
|    — a metric showing when long-term BTC holders are          |
|    historically overextended (sell signal) or risk-averse     |
|    (buy signal).                                              |
|                                                               |
| 2. Confidence Interval Bands                                  |
|    LTH PVR data is analyzed using statistical confidence      |
|    intervals. When BTC trades above upper band (euphoria),    |
|    we reduce exposure. When below lower band (fear), we       |
|    accumulate more aggressively.                              |
|                                                               |
| 3. Automated Daily Decisions                                  |
|    Every trading day at 03:00 UTC, our system:               |
|    • Fetches latest LTH PVR bands from CryptoQuant           |
|    • Compares current BTC price to bands                     |
|    • Generates buy/sell/hold decision                        |
|    • Calculates optimal position size                        |
|    • Places orders on VALR exchange                          |
|    • Records full audit trail                                |
|                                                               |
| 4. Transparent Execution                                      |
|    All trades executed on VALR (South African exchange).      |
|    Your customer portal shows:                                |
|    • Daily decisions and reasoning                           |
|    • Order execution details                                 |
|    • Portfolio balances (BTC + USDT)                         |
|    • Performance vs benchmarks                               |
|    • Fee calculations                                        |
|                                                               |
+---------------------------------------------------------------+
```

**Visual Enhancement:**
- Consider adding flow diagram: LTH PVR Data → CI Bands → Decision Logic → Order Placement → Portfolio Update
- Icons for each step (can be simple SVG icons)

#### 3. Historical Performance Section
**Charts Required:**

**Chart 1: ROI Comparison (2020-2025)**
```
+---------------------------------------------------------------+
|              ROI % Comparison: LTH PVR vs Standard DCA        |
+---------------------------------------------------------------+
|                                                               |
|   [Line Chart]                                                |
|   - X-axis: Time (years 2020-2025)                           |
|   - Y-axis: ROI % (cumulative)                               |
|   - LTH PVR line: Navy blue (#003B73)                        |
|   - Standard DCA line: Gray (#CCCCCC)                        |
|                                                               |
|   Final Results:                                              |
|   LTH PVR: +XXX%                                             |
|   Standard DCA: +XXX%                                        |
|   Outperformance: +XXX percentage points                     |
|                                                               |
+---------------------------------------------------------------+
```

**Chart 2: NAV Comparison (2020-2025)**
```
+---------------------------------------------------------------+
|              NAV (USD) Comparison: LTH PVR vs Standard DCA    |
+---------------------------------------------------------------+
|                                                               |
|   [Line Chart]                                                |
|   - X-axis: Time (years 2020-2025)                           |
|   - Y-axis: Portfolio Value (USD)                            |
|   - LTH PVR line: Navy blue (#003B73)                        |
|   - Standard DCA line: Gray (#CCCCCC)                        |
|                                                               |
|   Final NAV:                                                  |
|   LTH PVR: $XXX,XXX                                          |
|   Standard DCA: $XXX,XXX                                     |
|   Absolute Gain: $XXX,XXX more                               |
|                                                               |
+---------------------------------------------------------------+
```

**Data Source:**
- Use `lth_pvr_bt` schema for historical back-test results
- Query `bt_results_daily` for specific back-test run (2020-01-01 to 2025-12-31)
- Calculate Standard DCA benchmark (same contribution schedule)
- Aggregate: Daily NAV → Monthly NAV for chart smoothness

**Assumptions Displayed:**
```
Back-test Parameters:
• Start Date: 2020-01-01
• End Date: 2025-12-31
• Upfront Investment: $10,000
• Monthly Contribution: $5,000
• Performance Fee: 10% (high-water mark)
• Platform Fee: 0.75% on contributions
• Exchange: VALR (BTC/USDT)
```

#### 4. Pricing Section
**Content:**
```
+---------------------------------------------------------------+
|                      Pricing Structure                        |
+---------------------------------------------------------------+
|                                                               |
|  Performance Fee: 10% (High-Water Mark)                       |
|  • Charged only on NEW profits above previous peak NAV        |
|  • If portfolio drops and recovers, no fee on recovery        |
|  • Calculated monthly, charged quarterly                      |
|  • Example: NAV peaks at $100k, drops to $80k, recovers to    |
|    $110k → fee charged on $10k profit only (not $30k)        |
|                                                               |
|  Platform Fee: 0.75% on Contributions                         |
|  • Charged when funds deposited to your portfolio             |
|  • One-time fee per contribution                              |
|  • Covers infrastructure, data feeds, exchange fees, support  |
|  • Example: Deposit $10,000 → $75 platform fee               |
|                                                               |
|  No Hidden Fees:                                              |
|  ✓ No monthly management fees                                 |
|  ✓ No withdrawal fees (beyond exchange costs)                 |
|  ✓ No inactivity fees                                         |
|  ✓ Full fee transparency in customer portal                   |
|                                                               |
+---------------------------------------------------------------+
```

**High-Water Mark Explanation Box:**
```
┌─────────────────────────────────────────────────────────────┐
│ 💡 What is a High-Water Mark?                               │
│                                                              │
│ A high-water mark protects you from paying performance fees │
│ twice on the same profits. We only charge fees on NEW       │
│ profits that exceed your portfolio's previous highest value. │
│                                                              │
│ This means:                                                  │
│ • If your portfolio grows, we share in the success          │
│ • If it drops and recovers, we don't charge on recovery     │
│ • You never pay twice for reaching the same value           │
│                                                              │
│ Example Timeline:                                            │
│ Jan: NAV $100k (peak) → Fee charged on profits              │
│ Mar: NAV drops to $80k → No fee (below peak)                │
│ Jun: NAV recovers to $100k → No fee (same as peak)          │
│ Sep: NAV grows to $120k → Fee charged on $20k NEW profit    │
└─────────────────────────────────────────────────────────────┘
```

#### 5. Call-to-Action Section
```
+---------------------------------------------------------------+
|                                                               |
|   Ready to See How LTH PVR Would Perform for You?           |
|                                                               |
|   Try our interactive back-tester with your own investment   |
|   parameters. See exactly how LTH PVR would have performed   |
|   during your chosen time period vs Standard DCA.            |
|                                                               |
|   [ Launch Interactive Back-Tester → ]                       |
|                                                               |
|   Past performance doesn't guarantee future results          |
|                                                               |
+---------------------------------------------------------------+
```

**Files to Create:**
- `website/lth-pvr.html` - Product page
- `website/css/product.css` - Product page styling
- `website/js/product-charts.js` - Chart.js implementation for ROI and NAV charts

**Deliverables:**
- [ ] Complete LTH PVR product page with how-it-works explanation
- [ ] Historical performance section with 2 charts (ROI and NAV)
- [ ] Pricing section with high-water mark explanation
- [ ] Call-to-action section linking to back-tester
- [ ] Responsive design for all sections
- [ ] Risk disclaimer footer

---

## Phase 2C: Interactive Back-Testing Tool (Days 5-7)

### Objective
Build email-gated back-testing tool that lets prospects run custom simulations and captures qualified leads.

### Components

#### 1. Back-Tester Page Layout (website/lth-pvr-backtest.html)
```
+---------------------------------------------------------------+
| [BitWealth Logo]  LTH PVR Back-Tester            [Login]     |
+---------------------------------------------------------------+
|                                                               |
|   Test LTH PVR with Your Investment Parameters                |
|                                                               |
+---------------------------------------------------------------+
|  PARAMETERS                           | RESULTS               |
|                                       |                       |
|  Email Address: [_______________]    | [Locked until         |
|  (Required to see results)            |  parameters          |
|                                       |  submitted]           |
|  Date Range:                          |                       |
|  From: [2010-07-17 ▼]                |                       |
|  To:   [2025-12-31 ▼]                |                       |
|                                       |                       |
|  Upfront Investment:                  |                       |
|  $ [__________] ($ 0 - $ 1,000,000)  |                       |
|                                       |                       |
|  Monthly Investment:                  |                       |
|  $ [__________] ($ 100 - $ 100,000)  |                      |
|                                       |                       |
|  [ Run Back-Test ]                    |                       |
|                                       |                       |
+---------------------------------------------------------------+
```

#### 2. Email Gating Logic
**Flow:**
1. User lands on back-tester page
2. Parameters section visible, Results section shows "Enter email to see results"
3. User fills email + parameters, clicks "Run Back-Test"
4. Frontend validates email format (basic regex)
5. Frontend calls `public.run_public_backtest()` RPC function
6. Backend checks rate limit (max 10 per day per email)
7. If within limit:
   - Execute back-test simulation
   - Insert record into `public.backtest_requests`
   - Return results
8. If exceeded limit:
   - Return error: "You've reached the daily limit of 10 back-tests. Please try again tomorrow."
9. Frontend displays results in right panel

**Rate Limiting Implementation:**
```sql
-- RPC function checks this before running simulation
SELECT COUNT(*) 
FROM public.backtest_requests 
WHERE email = p_email 
  AND requested_at >= CURRENT_DATE;

-- If count >= 10, reject request
-- Otherwise, proceed with simulation
```

#### 3. Back-Test Execution Logic

**New RPC Function: `public.run_public_backtest()`**
```sql
CREATE OR REPLACE FUNCTION public.run_public_backtest(
  p_email TEXT,
  p_from_date DATE,
  p_to_date DATE,
  p_upfront_amount NUMERIC,
  p_monthly_amount NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request_count INT;
  v_lth_pvr_result JSON;
  v_std_dca_result JSON;
  v_request_id BIGINT;
BEGIN
  -- 1. Validate email format
  IF p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;

  -- 2. Check rate limit (10 per day)
  SELECT COUNT(*) INTO v_request_count
  FROM public.backtest_requests
  WHERE email = p_email
    AND requested_at >= CURRENT_DATE;
  
  IF v_request_count >= 10 THEN
    RAISE EXCEPTION 'Daily back-test limit reached (10 per day). Please try again tomorrow.';
  END IF;

  -- 3. Validate date range
  IF p_from_date < '2010-07-17' THEN
    RAISE EXCEPTION 'Start date cannot be before 2010-07-17 (Bitcoin exchange trading began)';
  END IF;
  
  IF p_to_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'End date cannot be in the future';
  END IF;
  
  IF p_from_date >= p_to_date THEN
    RAISE EXCEPTION 'End date must be after start date';
  END IF;

  -- 4. Validate investment amounts
  IF p_upfront_amount < 0 OR p_upfront_amount > 1000000 THEN
    RAISE EXCEPTION 'Upfront investment must be between $ 0 and $ 1,000,000';
  END IF;
  
  IF p_monthly_amount < 100 OR p_monthly_amount > 100000 THEN
    RAISE EXCEPTION 'Monthly investment must be between $ 100 and $ 100,000';
  END IF;

  -- 5. Run LTH PVR simulation (reuse back-testing logic)
  -- TODO: Call existing back-test simulation function
  -- v_lth_pvr_result := lth_pvr_bt.run_backtest(...);
  
  -- 6. Calculate Standard DCA benchmark
  -- TODO: Implement standard DCA calculation
  -- v_std_dca_result := calculate_standard_dca(...);

  -- 7. Insert tracking record
  INSERT INTO public.backtest_requests (
    email, from_date, to_date, upfront_amount, monthly_amount,
    lth_pvr_final_nav, lth_pvr_roi_pct, std_dca_final_nav, std_dca_roi_pct,
    requested_at
  ) VALUES (
    p_email, p_from_date, p_to_date, p_upfront_amount, p_monthly_amount,
    (v_lth_pvr_result->>'final_nav')::NUMERIC,
    (v_lth_pvr_result->>'roi_pct')::NUMERIC,
    (v_std_dca_result->>'final_nav')::NUMERIC,
    (v_std_dca_result->>'roi_pct')::NUMERIC,
    NOW()
  )
  RETURNING id INTO v_request_id;

  -- 8. Return results
  RETURN json_build_object(
    'request_id', v_request_id,
    'lth_pvr', v_lth_pvr_result,
    'std_dca', v_std_dca_result,
    'parameters', json_build_object(
      'from_date', p_from_date,
      'to_date', p_to_date,
      'upfront_amount', p_upfront_amount,
      'monthly_amount', p_monthly_amount
    )
  );
END;
$$;
```

**Standard DCA Calculation Logic:**
```sql
-- Simplified Standard DCA algorithm
-- 1. Buy fixed amount of BTC every month at month's average price
-- 2. Track cumulative BTC holdings
-- 3. Calculate NAV at end date using final BTC price
-- 4. Calculate ROI: ((final_nav - total_invested) / total_invested) * 100

WITH monthly_prices AS (
  -- Aggregate daily BTC prices to monthly averages
  SELECT 
    DATE_TRUNC('month', date) AS month,
    AVG(close_price) AS avg_btc_price
  FROM public.btc_price_history
  WHERE date BETWEEN p_from_date AND p_to_date
  GROUP BY DATE_TRUNC('month', date)
),
monthly_contributions AS (
  -- Generate monthly contribution schedule
  SELECT 
    month,
    p_monthly_amount AS contribution_amount
  FROM monthly_prices
),
dca_buys AS (
  -- Calculate BTC bought each month
  SELECT 
    mc.month,
    mc.contribution_amount,
    mp.avg_btc_price,
    mc.contribution_amount / mp.avg_btc_price AS btc_bought
  FROM monthly_contributions mc
  JOIN monthly_prices mp ON mc.month = mp.month
),
final_stats AS (
  SELECT 
    SUM(contribution_amount) + p_upfront_amount AS total_invested,
    SUM(btc_bought) + (p_upfront_amount / (SELECT avg_btc_price FROM monthly_prices ORDER BY month LIMIT 1)) AS total_btc,
    (SELECT avg_btc_price FROM monthly_prices ORDER BY month DESC LIMIT 1) AS final_btc_price
  FROM dca_buys
)
SELECT 
  total_btc * final_btc_price AS final_nav,
  ((total_btc * final_btc_price - total_invested) / total_invested) * 100 AS roi_pct,
  total_btc,
  total_invested
FROM final_stats;
```

#### 4. Results Display Panel
```
+---------------------------------------------------------------+
|                      BACK-TEST RESULTS                        |
+---------------------------------------------------------------+
|                                                               |
|  Parameters Used:                                             |
|  • Date Range: [from] to [to]                                |
|  • Upfront Investment: R [upfront]                           |
|  • Monthly Investment: R [monthly]                           |
|                                                               |
+---------------------------------------------------------------+
|  LTH PVR Strategy              |  Standard DCA                |
|                                |                              |
|  Final NAV: $XXX,XXX           |  Final NAV: $XXX,XXX         |
|  Total Invested: $XXX,XXX      |  Total Invested: $XXX,XXX    |
|  Total Return: $XXX,XXX        |  Total Return: $XXX,XXX      |
|  ROI: +XXX%                    |  ROI: +XXX%                  |
|  Annualized: +XX%              |  Annualized: +XX%            |
|                                |                              |
+---------------------------------------------------------------+
|                                                               |
|  [Chart 1: ROI % Over Time - LTH PVR vs Standard DCA]       |
|                                                               |
+---------------------------------------------------------------+
|                                                               |
|  [Chart 2: NAV (USD) Over Time - LTH PVR vs Standard DCA]   |
|                                                               |
+---------------------------------------------------------------+
|                                                               |
|  ⚠️  Past performance doesn't guarantee future results       |
|                                                               |
|  Ready to get started?                                        |
|  [ Create Your Account → ]                                    |
|                                                               |
+---------------------------------------------------------------+
```

**Chart Details:**
- **Chart 1 (ROI %):**
  - X-axis: Time (monthly intervals)
  - Y-axis: Cumulative ROI %
  - Two lines: LTH PVR (navy blue), Standard DCA (gray)
  
- **Chart 2 (NAV):**
  - X-axis: Time (monthly intervals)
  - Y-axis: Portfolio value (USD)
  - Two lines: LTH PVR (navy blue), Standard DCA (gray)
  - Area fill under lines for visual impact

**CTA Button:**
- Links to prospect submission form
- URL includes UTM parameter: `?utm_source=backtester&utm_campaign=product_page`
- Enables conversion tracking in analytics

#### 5. Database Schema

**New Table: `public.backtest_requests`**
```sql
CREATE TABLE public.backtest_requests (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  upfront_amount NUMERIC NOT NULL,
  monthly_amount NUMERIC NOT NULL,
  lth_pvr_final_nav NUMERIC,
  lth_pvr_roi_pct NUMERIC,
  lth_pvr_annualized_roi_pct NUMERIC,
  std_dca_final_nav NUMERIC,
  std_dca_roi_pct NUMERIC,
  std_dca_annualized_roi_pct NUMERIC,
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,
  
  -- Indexes for analytics queries
  CONSTRAINT backtest_requests_date_check CHECK (to_date > from_date),
  CONSTRAINT backtest_requests_from_date_check CHECK (from_date >= '2010-07-17'),
  CONSTRAINT backtest_requests_amounts_check CHECK (
    upfront_amount >= 0 AND upfront_amount <= 1000000 AND
    monthly_amount >= 100 AND monthly_amount <= 100000
  )
);

CREATE INDEX idx_backtest_requests_email ON public.backtest_requests(email);
CREATE INDEX idx_backtest_requests_requested_at ON public.backtest_requests(requested_at);
CREATE INDEX idx_backtest_requests_email_date ON public.backtest_requests(email, requested_at);

-- RLS Policy: Admin read-only
ALTER TABLE public.backtest_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY backtest_requests_admin_read ON public.backtest_requests
  FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM public.org_members WHERE role = 'admin'));

-- No public read access (prevents scraping)
```

**New Table: `public.btc_price_history` (if not exists)**
```sql
-- Required for Standard DCA calculation
-- Stores daily BTC/USDT prices for back-testing
CREATE TABLE public.btc_price_history (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  open_price NUMERIC NOT NULL,
  high_price NUMERIC NOT NULL,
  low_price NUMERIC NOT NULL,
  close_price NUMERIC NOT NULL,
  volume NUMERIC,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_btc_price_history_date ON public.btc_price_history(date);

-- Populate from existing CI bands data or external API
```

**Files to Create:**
- `website/lth-pvr-backtest.html` - Back-tester page
- `website/css/backtester.css` - Styling
- `website/js/backtester.js` - Form handling, API calls, results display, chart rendering
- Migration: `supabase/migrations/YYYYMMDD_add_backtest_requests_table.sql`
- RPC function: `supabase/migrations/YYYYMMDD_add_run_public_backtest_function.sql`

**Deliverables:**
- [ ] Back-tester page with parameter form and results panel
- [ ] Email validation and rate limiting (10 per day)
- [ ] `run_public_backtest()` RPC function with Standard DCA calculation
- [ ] Results display with 2 comparison charts
- [ ] `backtest_requests` analytics table
- [ ] CTA button with UTM tracking to prospect form
- [ ] Error handling for rate limits, invalid inputs, simulation failures

---

## Phase 2D: Analytics Tracking & Pricing Model Update (Days 8-9)

### Objective
Implement conversion funnel analytics and update pricing model to include 0.75% platform fee on contributions.

### Components

#### 1. Conversion Funnel Analytics

**Tracking Points:**
```
Landing Page Views
    ↓
Product Page Views (from landing page CTA)
    ↓
Back-Tester Page Views (from product page CTA)
    ↓
Back-Test Submissions (email captured)
    ↓
Prospect Form Views (from back-tester CTA)
    ↓
Prospect Submissions (conversion)
```

**Analytics Table: `public.page_views`**
```sql
CREATE TABLE public.page_views (
  id BIGSERIAL PRIMARY KEY,
  page_name TEXT NOT NULL, -- 'landing', 'product_lth_pvr', 'backtester', 'prospect_form'
  session_id TEXT NOT NULL, -- Client-side generated UUID
  referrer_page TEXT, -- Previous page in funnel
  utm_source TEXT,
  utm_campaign TEXT,
  utm_medium TEXT,
  viewed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX idx_page_views_page_name ON public.page_views(page_name);
CREATE INDEX idx_page_views_session_id ON public.page_views(session_id);
CREATE INDEX idx_page_views_viewed_at ON public.page_views(viewed_at);
```

**Client-Side Tracking (JavaScript):**
```javascript
// website/js/analytics.js
function trackPageView(pageName, referrerPage = null) {
  const sessionId = getOrCreateSessionId(); // localStorage UUID
  const urlParams = new URLSearchParams(window.location.search);
  
  fetch('https://[project-ref].supabase.co/rest/v1/page_views', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      page_name: pageName,
      session_id: sessionId,
      referrer_page: referrerPage || document.referrer,
      utm_source: urlParams.get('utm_source'),
      utm_campaign: urlParams.get('utm_campaign'),
      utm_medium: urlParams.get('utm_medium'),
      viewed_at: new Date().toISOString()
    })
  });
}

// Call on page load
trackPageView('landing');
```

**Analytics Dashboard (Admin UI):**
- Add new "Marketing Analytics" section to Administration module
- Display funnel metrics:
  - Landing page views
  - Product page CTR (click-through rate)
  - Back-tester conversion rate (views → submissions)
  - Prospect form conversion rate (back-tester CTA → submissions)
  - Email-to-customer conversion rate

**SQL Queries for Metrics:**
```sql
-- Funnel drop-off analysis
WITH funnel AS (
  SELECT 
    SUM(CASE WHEN page_name = 'landing' THEN 1 ELSE 0 END) AS landing_views,
    SUM(CASE WHEN page_name = 'product_lth_pvr' THEN 1 ELSE 0 END) AS product_views,
    SUM(CASE WHEN page_name = 'backtester' THEN 1 ELSE 0 END) AS backtester_views,
    SUM(CASE WHEN page_name = 'prospect_form' THEN 1 ELSE 0 END) AS form_views
  FROM public.page_views
  WHERE viewed_at >= CURRENT_DATE - INTERVAL '30 days'
)
SELECT 
  landing_views,
  product_views,
  ROUND((product_views::NUMERIC / landing_views) * 100, 2) AS landing_to_product_ctr,
  backtester_views,
  ROUND((backtester_views::NUMERIC / product_views) * 100, 2) AS product_to_backtester_ctr,
  form_views,
  ROUND((form_views::NUMERIC / backtester_views) * 100, 2) AS backtester_to_form_ctr
FROM funnel;

-- Back-test parameter analysis (identify high-intent leads)
SELECT 
  CASE 
    WHEN upfront_amount >= 100000 THEN 'High Value ($100k+)'
    WHEN upfront_amount >= 50000 THEN 'Medium Value ($50k-$100k)'
    WHEN upfront_amount >= 10000 THEN 'Low Value ($10k-$50k)'
    ELSE 'Very Low Value (<$10k)'
  END AS upfront_segment,
  COUNT(*) AS request_count,
  AVG(lth_pvr_roi_pct) AS avg_roi_shown,
  COUNT(DISTINCT email) AS unique_prospects
FROM public.backtest_requests
WHERE requested_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;

-- Email-to-customer conversion tracking
SELECT 
  br.email,
  COUNT(br.id) AS backtest_count,
  MAX(br.requested_at) AS last_backtest,
  cd.id AS customer_id,
  cd.registration_status,
  CASE 
    WHEN cd.id IS NOT NULL THEN 'Converted'
    ELSE 'Prospect'
  END AS status
FROM public.backtest_requests br
LEFT JOIN public.customer_details cd ON br.email = cd.email
WHERE br.requested_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY br.email, cd.id, cd.registration_status
ORDER BY backtest_count DESC;
```

#### 2. Pricing Model Update

**Current System:**
- Only 10% performance fee (high-water mark)
- Calculated monthly in `lth_pvr.fees_monthly`
- No platform fee on contributions

**New System:**
- 10% performance fee (unchanged)
- 0.75% platform fee on ALL contributions (deposits)
- Both fees displayed separately in customer portal

**Database Schema Changes:**

**Add Column: `public.customer_details.platform_fee_rate`**
```sql
ALTER TABLE public.customer_details
ADD COLUMN platform_fee_rate NUMERIC DEFAULT 0.0075 CHECK (platform_fee_rate >= 0 AND platform_fee_rate <= 1);

COMMENT ON COLUMN public.customer_details.platform_fee_rate IS 'Platform fee charged on contributions (default 0.75% = 0.0075)';
```

**New Table: `lth_pvr.platform_fees`**
```sql
CREATE TABLE lth_pvr.platform_fees (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id),
  customer_id BIGINT NOT NULL REFERENCES public.customer_details(id),
  fee_date DATE NOT NULL,
  contribution_amount NUMERIC NOT NULL,
  fee_amount NUMERIC NOT NULL,
  fee_rate NUMERIC NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  UNIQUE(customer_id, fee_date)
);

CREATE INDEX idx_platform_fees_customer_id ON lth_pvr.platform_fees(customer_id);
CREATE INDEX idx_platform_fees_fee_date ON lth_pvr.platform_fees(fee_date);

COMMENT ON TABLE lth_pvr.platform_fees IS 'Tracks 0.75% platform fees charged on customer contributions';
```

**Edge Function Update: `ef_post_ledger_and_balances`**
```typescript
// After processing funding events (deposits), calculate platform fee
for (const deposit of depositEvents) {
  // Get customer's platform fee rate (default 0.0075 = 0.75%)
  const { data: customer } = await sb
    .from('customer_details')
    .select('platform_fee_rate')
    .eq('id', deposit.customer_id)
    .single();
  
  const platformFeeRate = customer?.platform_fee_rate || 0.0075;
  const contributionAmount = deposit.amount; // USDT deposited
  const feeAmount = contributionAmount * platformFeeRate;
  
  // Insert platform fee record
  await sb.from('platform_fees').insert({
    org_id: deposit.org_id,
    customer_id: deposit.customer_id,
    fee_date: deposit.trade_date,
    contribution_amount: contributionAmount,
    fee_amount: feeAmount,
    fee_rate: platformFeeRate
  });
  
  // Deduct fee from available balance (reduce USDT before BTC purchase)
  // This ensures fee is charged immediately on deposit
  await sb.from('ledger_lines').insert({
    org_id: deposit.org_id,
    customer_id: deposit.customer_id,
    trade_date: deposit.trade_date,
    kind: 'platform_fee',
    amount_usdt: -feeAmount, // Negative = deduction
    note: `Platform fee (${(platformFeeRate * 100).toFixed(2)}%) on contribution of ${contributionAmount.toFixed(2)} USDT`
  });
}
```

**Customer Portal Update: Display Platform Fees**
```javascript
// Add "Platform Fees" section to Finance/Fees tab
async function loadPlatformFees() {
  const { data, error } = await supabase
    .schema('lth_pvr')
    .from('platform_fees')
    .select('*')
    .eq('customer_id', customerId)
    .order('fee_date', { ascending: false });
  
  // Render table showing:
  // Date | Contribution Amount | Fee Rate | Fee Amount
  // 2026-01-05 | $10,000.00 | 0.75% | $75.00
}
```

**Admin UI Update: Platform Fee Rate Management**
```javascript
// Add platform_fee_rate field to Customer Maintenance form
// Allow admins to customize rate per customer (default 0.75%)
async function updatePlatformFeeRate(customerId, newRate) {
  const { data, error } = await supabase
    .from('customer_details')
    .update({ platform_fee_rate: newRate / 100 }) // Convert % to decimal
    .eq('id', customerId);
  
  if (error) {
    alert('Error updating platform fee rate: ' + error.message);
  } else {
    alert(`Platform fee rate updated to ${newRate}%`);
  }
}
```

**Migration File:**
```sql
-- supabase/migrations/YYYYMMDD_add_platform_fees.sql

-- 1. Add platform_fee_rate column to customer_details
ALTER TABLE public.customer_details
ADD COLUMN platform_fee_rate NUMERIC DEFAULT 0.0075 CHECK (platform_fee_rate >= 0 AND platform_fee_rate <= 1);

-- 2. Create platform_fees table
CREATE TABLE lth_pvr.platform_fees (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id),
  customer_id BIGINT NOT NULL REFERENCES public.customer_details(id),
  fee_date DATE NOT NULL,
  contribution_amount NUMERIC NOT NULL,
  fee_amount NUMERIC NOT NULL,
  fee_rate NUMERIC NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  UNIQUE(customer_id, fee_date)
);

CREATE INDEX idx_platform_fees_customer_id ON lth_pvr.platform_fees(customer_id);
CREATE INDEX idx_platform_fees_fee_date ON lth_pvr.platform_fees(fee_date);

-- 3. Add RLS policies
ALTER TABLE lth_pvr.platform_fees ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_fees_admin_all ON lth_pvr.platform_fees
  FOR ALL
  USING (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY platform_fees_customer_read ON lth_pvr.platform_fees
  FOR SELECT
  USING (customer_id IN (SELECT id FROM public.customer_details WHERE user_id = auth.uid()));
```

**Files to Modify:**
- `supabase/functions/ef_post_ledger_and_balances/index.ts` - Add platform fee calculation
- `website/customer-portal.html` - Add platform fees display section
- `ui/Advanced BTC DCA Strategy.html` - Add platform fee rate field to Customer Maintenance form

**Deliverables:**
- [ ] Analytics tracking with `page_views` table and client-side JavaScript
- [ ] Marketing Analytics dashboard in admin UI (funnel metrics)
- [ ] Back-test parameter analysis queries (high-intent lead identification)
- [ ] Platform fee system: `platform_fee_rate` column + `platform_fees` table
- [ ] Edge function update to calculate and deduct platform fees on deposits
- [ ] Customer portal section displaying platform fees
- [ ] Admin UI field for customizing platform fee rate per customer

---

## Technical Dependencies

### Required Data
1. **LTH PVR Back-Test Results (2020-2025):**
   - Run full back-test using existing `lth_pvr_bt` schema
   - Parameters: Upfront $10,000, Monthly $5,000
   - Extract: Daily NAV, Final ROI %, Annualized ROI %
   - Save results for use in landing page and product page charts

2. **Standard DCA Benchmark Calculation:**
   - Implement Standard DCA algorithm in SQL
   - Same parameters as LTH PVR back-test
   - Buy fixed amount of BTC every month at average price
   - Calculate NAV and ROI at end date

3. **BTC Price History:**
   - Populate `public.btc_price_history` table with daily BTC/USDT prices
   - Date range: 2010-07-17 to present
   - Source: CryptoQuant API or historical CSV import
   - Required for Standard DCA calculation in back-tester

### External Libraries
- **Chart.js:** Lightweight charting library for performance charts
  - CDN: `https://cdn.jsdelivr.net/npm/chart.js`
  - Used for: Landing page preview chart, product page charts, back-tester results charts
  - License: MIT (free for commercial use)

- **Tailwind CSS:** Utility-first CSS framework (if not already using)
  - CDN: `https://cdn.tailwindcss.com`
  - Used for: Responsive layouts, consistent styling
  - Alternative: Continue with custom CSS if preferred

### Environment Variables
- **WEBSITE_URL:** Already set to `https://bitwealth.co.za`
- **SUPABASE_URL:** Already set
- **SUPABASE_ANON_KEY:** Already set (public-facing APIs)
- No new environment variables required

---

## Testing Strategy

### Test Categories

#### 1. Landing Page Tests
- [ ] Hero section displays correctly on desktop/tablet/mobile
- [ ] Performance chart loads with correct data (2020-2025)
- [ ] ROI statistics show LTH PVR vs Standard DCA comparison
- [ ] CTA button links to product catalog section
- [ ] Product catalog displays 4 cards (1 active, 3 coming soon)
- [ ] "Learn More" button links to lth-pvr.html
- [ ] Responsive design: Layout adapts correctly to different screen sizes

#### 2. Product Page Tests
- [ ] Product page loads at website/lth-pvr.html
- [ ] "How It Works" section explains LTH PVR clearly
- [ ] ROI comparison chart shows correct data
- [ ] NAV comparison chart shows correct data
- [ ] Pricing section displays performance fee and platform fee
- [ ] High-water mark explanation box renders correctly
- [ ] CTA button links to lth-pvr-backtest.html
- [ ] Risk disclaimer displays at bottom of page

#### 3. Back-Tester Functional Tests
- [ ] Back-tester page loads at website/lth-pvr-backtest.html
- [ ] Email field validates format (accepts valid, rejects invalid)
- [ ] Date range picker enforces minimum date (2010-07-17)
- [ ] Investment amount fields enforce min/max limits
- [ ] "Run Back-Test" button disabled until email entered
- [ ] First submission: Results display correctly
- [ ] 10th submission: Results display correctly
- [ ] 11th submission (same day): Error message about rate limit
- [ ] Results panel shows LTH PVR and Standard DCA side-by-side
- [ ] ROI chart renders correctly with two lines
- [ ] NAV chart renders correctly with two lines
- [ ] "Create Your Account" CTA links to prospect form with UTM parameters

#### 4. Rate Limiting Tests
- [ ] Same email, same day: 10 submissions succeed, 11th fails
- [ ] Same email, next day: Rate limit resets, can submit again
- [ ] Different email: No rate limit conflict
- [ ] Rate limit error message is user-friendly

#### 5. Analytics Tests
- [ ] Page view tracking fires on landing page load
- [ ] Page view tracking fires on product page load
- [ ] Page view tracking fires on back-tester page load
- [ ] Back-test submission creates record in `backtest_requests` table
- [ ] UTM parameters captured correctly in page views
- [ ] Session ID persists across pages (localStorage)
- [ ] Admin UI displays funnel metrics correctly

#### 6. Pricing Model Tests
- [ ] Customer deposits $10,000 → Platform fee of $75 deducted
- [ ] Platform fee recorded in `lth_pvr.platform_fees` table
- [ ] Ledger line created for platform fee (kind='platform_fee', negative USDT)
- [ ] Customer portal displays platform fees in separate section
- [ ] Admin can update customer's platform_fee_rate
- [ ] Updated rate applies to next deposit (not retroactive)

#### 7. Integration Tests
- [ ] Landing page → Product page → Back-tester → Prospect form (full funnel)
- [ ] Email captured in back-tester appears in analytics dashboard
- [ ] Prospect submission with email from back-tester links correctly
- [ ] Mobile experience: All pages render correctly on iPhone/Android
- [ ] Performance: Landing page loads in < 2 seconds
- [ ] SEO: Meta tags, Open Graph tags present on all pages

---

## Deployment Checklist

### Pre-Deployment
- [ ] Run full back-test for 2020-2025 (LTH PVR + Standard DCA)
- [ ] Populate `public.btc_price_history` table (2010-07-17 to present)
- [ ] Create migration: `add_backtest_requests_table.sql`
- [ ] Create migration: `add_run_public_backtest_function.sql`
- [ ] Create migration: `add_platform_fees.sql`
- [ ] Create migration: `add_page_views_table.sql`
- [ ] Deploy edge function update: `ef_post_ledger_and_balances` (platform fee logic)

### Website Files
- [ ] Create: `website/index.html` (redesigned landing page)
- [ ] Create: `website/lth-pvr.html` (product page)
- [ ] Create: `website/lth-pvr-backtest.html` (back-tester)
- [ ] Create: `website/css/landing.css`
- [ ] Create: `website/css/product.css`
- [ ] Create: `website/css/backtester.css`
- [ ] Create: `website/js/landing-chart.js`
- [ ] Create: `website/js/product-charts.js`
- [ ] Create: `website/js/backtester.js`
- [ ] Create: `website/js/analytics.js`

### Admin UI Updates
- [ ] Modify: `ui/Advanced BTC DCA Strategy.html` (add platform_fee_rate field)
- [ ] Add: Marketing Analytics section (funnel metrics dashboard)

### Customer Portal Updates
- [ ] Modify: `website/customer-portal.html` (add platform fees section)

### Database Migrations
```powershell
# Apply migrations via Supabase dashboard or CLI
supabase db push

# Or apply via MCP if preferred
# (Use mcp_supabase_apply_migration for each SQL file)
```

### Edge Function Deployment
```powershell
supabase functions deploy ef_post_ledger_and_balances --project-ref wqnmxpooabmedvtackji --no-verify-jwt
```

### Netlify Deployment
- [ ] Commit all website files to Git
- [ ] Push to main branch
- [ ] Netlify auto-deploys (already configured to build on website/ changes)
- [ ] Verify deployment: https://bitwealth.co.za

### Post-Deployment Verification
- [ ] Visit landing page: Hero section, charts, product catalog
- [ ] Visit product page: Charts load, pricing displays, CTA works
- [ ] Visit back-tester: Submit test back-test, verify results
- [ ] Check analytics: Confirm page views tracked in database
- [ ] Test rate limiting: Submit 11 back-tests from same email (verify 11th fails)
- [ ] Test mobile: All pages render correctly on phone
- [ ] Test conversion funnel: Click through landing → product → back-tester → prospect form

---

## Risk Mitigation

### Performance Risks
**Risk:** Back-test simulations take too long (slow page load)  
**Mitigation:**
- Optimize SQL queries (use indexes on date columns)
- Aggregate data to monthly intervals (not daily) for charts
- Consider caching common back-test results (e.g., 2020-2025)
- Set 30-second timeout on RPC function

### Data Risks
**Risk:** BTC price history data incomplete or inaccurate  
**Mitigation:**
- Validate data import (check for gaps in date range)
- Compare multiple data sources (CryptoQuant, CoinGecko)
- Add data quality checks in RPC function (reject if missing prices)

### Security Risks
**Risk:** Email scraping from public back-tester API  
**Mitigation:**
- No public read access to `backtest_requests` table (RLS enforced)
- Admin-only access to analytics dashboard
- Rate limiting prevents bulk scraping (10 per day)
- Consider adding CAPTCHA if abuse detected

### Conversion Risks
**Risk:** Prospects submit back-tests but don't convert  
**Mitigation:**
- Track email addresses, follow up with marketing emails
- Show compelling results (highlight LTH PVR outperformance)
- Strong CTA placement after results
- Consider offering free consultation for high-value back-tests ($100k+ upfront)

---

## Success Metrics (30-Day Review)

### Traffic Metrics
- Landing page views: Target 500+
- Product page CTR: Target 40% (landing → product)
- Back-tester CTR: Target 30% (product → back-tester)

### Engagement Metrics
- Back-test submissions: Target 100+
- Average upfront amount tested: Track distribution
- Average monthly amount tested: Track distribution
- Repeat back-tests: Track emails with 2+ submissions

### Conversion Metrics
- Back-tester to prospect form: Target 20% CTR
- Prospect form submissions: Target 20+ (from back-tester)
- Email-to-customer conversion: Track over 90 days

### Revenue Impact
- Platform fees collected: Track total from new deposits
- Performance fees: Compare pre/post Phase 2 (long-term metric)

---

## Next Steps

1. **Review Build Plan** (You)
   - Confirm scope, timeline, approach
   - Provide any additional requirements or changes

2. **Data Preparation** (Day 0)
   - Run 2020-2025 back-test for landing page charts
   - Import BTC price history for back-tester

3. **Phase 2A: Landing Page** (Days 1-2)
   - Redesign index.html with hero section and product catalog
   - Implement performance chart with Chart.js

4. **Phase 2B: Product Page** (Days 3-4)
   - Create lth-pvr.html with strategy explanation and charts
   - Add pricing section with high-water mark explanation

5. **Phase 2C: Back-Tester** (Days 5-7)
   - Build lth-pvr-backtest.html with parameter form
   - Implement `run_public_backtest()` RPC function
   - Add email gating and rate limiting

6. **Phase 2D: Analytics & Pricing** (Days 8-9)
   - Implement page view tracking and funnel metrics
   - Update pricing model with 0.75% platform fee

7. **Testing & Launch** (Day 10)
   - Execute full test suite (50+ test cases)
   - Deploy to production
   - Monitor analytics for first 7 days

---

## Implementation Decisions (Confirmed 2026-01-08)

1. **Back-Test Data:** ✅ Run 2020-2025 back-test using existing back-testing system (upfront $10,000, monthly $5,000)

2. **BTC Price History:** ✅ Reuse existing back-test infrastructure - analyze current logic using `lth_pvr.ci_bands_daily` and existing BTC price data. DO NOT create new tables or functions.

3. **Chart Granularity:** ✅ Monthly data points for all 5-year charts

4. **Email Follow-Up:** ✅ Yes, build automated email sequences for prospects who submit back-tests but don't convert (Phase 3 scope)

5. **CAPTCHA:** ✅ Yes, add CAPTCHA to back-tester form immediately (prevent bot abuse)

6. **Pricing Examples:** ✅ Yes, display example fee calculations on product page

7. **Mobile Experience:** ✅ Full back-tester with charts (responsive design, no degraded mobile UX)

---

## Critical Implementation Notes

### Back-Testing Infrastructure Reuse

**IMPORTANT:** Do NOT create new back-testing functions. Reuse existing system:

1. **Existing Schema:** `lth_pvr_bt` with tables:
   - `bt_runs` - Back-test configuration and metadata
   - `bt_results_daily` - Daily NAV, BTC/USDT balances, decisions
   - `bt_std_dca_balances` - Standard DCA benchmark results

2. **Existing Data Sources:**
   - `lth_pvr.ci_bands_daily` - On-chain LTH PVR bands (already populated)
   - BTC price history embedded in CI bands data (no separate table needed)

3. **Analysis Required:**
   - Study existing back-test logic (Admin UI back-tester module, lines ~4000-5000)
   - Identify RPC functions or edge functions used for simulations
   - Understand how Standard DCA calculation works
   - Determine if simulations run on-demand or use pre-computed results

4. **Public Back-Tester Approach:**
   - Option A: Wrap existing back-test RPC in public-facing function with rate limiting
   - Option B: Call existing edge function from new `run_public_backtest()` wrapper
   - Option C: Query pre-computed results from `bt_results_daily` if matching parameters exist

**Next Step:** Before implementing Phase 2C (back-tester), analyze existing back-test code to determine best integration approach.

---

## Ready to Proceed

All design decisions confirmed. Implementation will proceed in sequence:

- **Phase 2A:** Landing page redesign (Days 1-2)
- **Phase 2B:** LTH PVR product page (Days 3-4)
- **Phase 2C:** Interactive back-tester with CAPTCHA (Days 5-7) - MUST analyze existing back-test infrastructure first
- **Phase 2D:** Analytics + pricing model (Days 8-9)

Starting with Phase 2A: Landing page hero section, performance chart, and product catalog...
