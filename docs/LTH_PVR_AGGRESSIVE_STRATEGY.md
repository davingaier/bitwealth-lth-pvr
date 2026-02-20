# LTH PVR BTC DCA Aggressive Strategy

**Version:** 1.1 (Rule 2: Momentum-Filtered)  

**Last Updated:** February 20, 2026  

**Status:** Production

---

## Overview

The **LTH PVR Aggressive Strategy** is a systematic Bitcoin Dollar-Cost Averaging (DCA) approach that automatically adjusts buy and sell decisions based on on-chain market data. Instead of buying a fixed amount every day, this strategy buys more aggressively when Bitcoin is undervalued and sells strategically when it's overvalued—all determined by the behavior of long-term Bitcoin holders.

### What is LTH PVR?

**LTH PVR** stands for **Long-Term Holder Profit-to-Volatility Ratio**, an on-chain metric that compares Bitcoin's current price to the cost basis of long-term holders (coins held 155+ days). When this ratio is analyzed statistically, it reveals market cycles:

- **Below the mean:** Bitcoin is undervalued relative to long-term holder behavior → **BUY zone**
- **Above the mean:** Bitcoin is overvalued relative to long-term holder behavior → **SELL zone**

The strategy uses **confidence interval bands** (sigma levels) to determine how aggressively to buy or sell.

---

## Core Trading Rules

### The 11 Trading Tiers

The strategy divides the market into **11 distinct zones** based on how far price is from the LTH PVR mean:

```
                    SELL ZONES (Above Mean)
┌─────────────────────────────────────────────────┐
│ Base 11: > +2.5σ          SELL 9.572%          │ ← Most aggressive sell
│ Base 10: +2.0σ ... +2.5σ  SELL 3.300%          │
│ Base 9:  +1.5σ ... +2.0σ  SELL 1.287%          │
│ Base 8:  +1.0σ ... +1.5σ  SELL 0.441%          │
│ Base 7:  +0.5σ ... +1.0σ  SELL 0.200%          │
│ Base 6:  Mean ... +0.5σ   SELL 0.157%          │
├─────────────────────────────────────────────────┤
│              MEAN (Equilibrium)                 │
├─────────────────────────────────────────────────┤
│ Base 5:  -0.25σ ... Mean  BUY 12.229%          │
│ Base 4:  -0.50σ ... -0.25σ BUY 18.088%         │
│ Base 3:  -0.75σ ... -0.50σ BUY 19.943%         │
│ Base 2:  -1.00σ ... -0.75σ BUY 21.397%         │
│ Base 1:  < -1.0σ           BUY 22.796%         │ ← Most aggressive buy
└─────────────────────────────────────────────────┘
                    BUY ZONES (Below Mean)
```

### How Sizing Works

The percentages represent **how much of your available capital** to deploy:

- **BUY percentages:** Applied to your **USDT balance**
    - Example: If you have $10,000 USDT and price is at -1.0σ (Base 1), you buy: $10,000 × 22.796% = $2,279.60 worth of BTC
- **SELL percentages:** Applied to your **BTC balance**
    - Example: If you have 1.0 BTC and price is at +2.0σ (Base 9), you sell: 1.0 × 1.287% = 0.01287 BTC

### Daily Execution

Every day at **03:00 UTC**, the system:

1. Fetches the latest LTH PVR confidence interval bands from ChartInspect
2. Compares current BTC price to the bands
3. Determines which tier you're in
4. Executes the appropriate buy/sell action
5. Monitors and reconciles the order throughout the day

---

## Special Rules & Mechanisms

### 1. Bear Market Pause (Cycle Protection)

**Purpose:** Prevent buying during unsustainable rallies that precede major corrections.

#### How It Works

```
Normal Trading → Price crosses ABOVE +2.0σ → BEAR PAUSE ACTIVATED
                 ↓
         ALL BUYING DISABLED
                 ↓
         Continue selling normally
                 ↓
         Price drops BELOW -1.0σ → RESUME NORMAL TRADING
```

**What Happens During Pause:**

- ✅ **Selling continues** according to the tier rules
- ❌ **Buying is completely disabled**—even if price drops below mean
- 🔄 **Pause persists** until price closes below -1.0σ (full reset required)

**Real-World Example:**

- **2021 Bull Peak:** Price reached +2.5σ in March-April 2021 at $60K+
    - Pause would activate → Stop buying
    - Bear market begins → Price crashes to $30K (but still above -1.0σ)
    - Pause continues → No buying during "dead cat bounce"
    - Late 2021: Price finally drops below -1.0σ → Resume buying at lower prices

**Why This Matters:**  

Without this pause, the strategy would keep buying during a bull market blow-off top, leaving no capital for the inevitable bear market accumulation phase.

---

### 2. Momentum Filter (Sell Protection)

**Purpose:** Avoid selling during strong uptrends when price has more room to run.

#### How It Works

The system calculates **5-day price momentum (ROC)**:

- **ROC > 0%:** Price is trending UP over the last 5 days
- **ROC ≤ 0%:** Price is flat or trending DOWN

**Application:**

- **Base 6 (Mean to +0.5σ):** Always sells (no filter)
- **Base 7-9 (+0.5σ to +2.0σ):** Only sells if ROC > 0%
- **Base 10-11 (Above +2.0σ):** Always sells (no filter—extreme zone)

**Example Scenario:**

```
Day 1: Price at +1.2σ (Base 8), ROC = +5%  → SELL 0.441% ✅
Day 2: Price at +1.2σ (Base 8), ROC = -2%  → HOLD ⏸️ (momentum turned negative)
Day 3: Price at +1.3σ (Base 8), ROC = +3%  → SELL 0.441% ✅ (momentum back up)
```

**Bear Pause Override (v1.1 Change):**  

When bear pause is active, the momentum filter is **DISABLED**. All sells proceed regardless of ROC. This prevents holding positions during a collapsing market.

---

### 3. Retrace Exceptions (Opportunity Buying)

**Purpose:** Capture additional accumulation opportunities when price falls from extreme levels.

#### The Two Retrace Cases

**Case A: The +1.0σ to +1.5σ Retrace**

```
1. Price CLOSES inside [+1.0σ, +1.5σ) → Eligibility ARMED
2. Price continues rising above +1.5σ (optional)
3. Price RETRACES and closes inside [Mean, +0.5σ) → TRIGGER
4. Action: BUY Base 3 (19.943%) that day, skip any sell
5. Repeat daily while inside the retrace zone
```

**Case B: The +1.5σ to +2.0σ Retrace**

```
1. Price CLOSES inside [+1.5σ, +2.0σ) → Eligibility ARMED
2. Price continues rising above +2.0σ (triggers bear pause)
3. Price RETRACES and closes inside [+0.5σ, +1.0σ) → TRIGGER
4. Action: BUY Base 3 (19.943%) that day, skip any sell
5. Repeat daily while inside the retrace zone
```

#### Visual Example

```
Price Journey:
+2.5σ ──────────────────────────────────────
+2.0σ ────────┐    Bear pause starts here
+1.5σ ──────┐ │ ← Case B eligibility armed
+1.0σ ────┐ │ │ ← Case A eligibility armed
+0.5σ ──│ │ │ │
Mean ───┼─┼─┼─┼─────┐│← Case A retrace: BUY Base 3!
-0.5σ ──┼─┼─┼─┼─────┼┼─────────────────
-1.0σ ──START────────└┘ ← Case B retrace: BUY Base 3!
        
Timeline: Day 1→Day 20→Day 35→Day 50→Day 80
```

**Key Rules:**

- Retrace buys **suppress** any tier-based sells that day
- Retrace eligibility **persists** until bear pause activates or price drops below -1.0σ
- Can retrigger multiple days in a row (buy Base 3 daily while in retrace zone)
- During bear pause, retrace exceptions are **disabled** (unless exiting pause via < -1.0σ)

**Why This Matters:**  

Retraces from extreme highs often represent the last chance to accumulate before the next leg up. These exceptions ensure you don't miss those opportunities.

---

## Fee Structure

### Trading Fees

- **Rate:** 8 basis points (0.08%)
- **Applied to:** Base currency (BTC) on all trades
- **Example:** 
    - Buying $1,000 USDT worth of BTC → Receive 99.92% of BTC (0.08% fee deducted in BTC)
    - Selling 0.01 BTC → Sell proceeds reduced by 0.08% (fee deducted in BTC before conversion)

### Contribution Fees

- **Rate:** 18 basis points (0.18%)
- **Applied to:** Every USDT deposit/contribution
- **Example:** $5,000 monthly contribution → $4,991 net after $9 fee

### Monthly Contributions

- **Default:** $5,000 USDT on the 1st of each month
- **First day:** Optional starting capital (default: $0)
- All contributions are **gross** amounts (fees deducted automatically)

---

## Technical Details (Optional)

### Confidence Interval (CI) Bands

The strategy uses **static CI bands** from ChartInspect, calculated as:

```
price_at_sigma = lth_realized_price × (1 + pvr_mean + sigma × cumulative_std_dev)
```

Where:

- **lth_realized_price:** Average cost basis of long-term holders
- **pvr_mean:** Historical mean of the LTH PVR ratio
- **cumulative_std_dev:** Standard deviation of the ratio
- **sigma:** The confidence level (-1.0, -0.75, -0.5, -0.25, 0, +0.5, +1.0, +1.5, +2.0, +2.5)

### Momentum Calculation

**5-Day Rate of Change (ROC):**

```
ROC = (Price_today / Price_5_days_ago) - 1
```

- ROC = +0.05 → Price up 5% over 5 days
- ROC = -0.03 → Price down 3% over 5 days
- ROC = 0.00 → Price unchanged

### Base Size Percentages (Exact Values)

| Tier           | Zone              | Percentage | Fraction |
| -------------- | ----------------- | ---------- | -------- |
| **BUY TIERS**  |                   |            |          |
| Base 1         | < -1.0σ           | 22.796%    | 0.22796  |
| Base 2         | -1.0σ ... -0.75σ  | 21.397%    | 0.21397  |
| Base 3         | -0.75σ ... -0.50σ | 19.943%    | 0.19943  |
| Base 4         | -0.50σ ... -0.25σ | 18.088%    | 0.18088  |
| Base 5         | -0.25σ ... Mean   | 12.229%    | 0.12229  |
| **SELL TIERS** |                   |            |          |
| Base 6         | Mean ... +0.5σ    | 0.157%     | 0.00157  |
| Base 7         | +0.5σ ... +1.0σ   | 0.200%     | 0.00200  |
| Base 8         | +1.0σ ... +1.5σ   | 0.441%     | 0.00441  |
| Base 9         | +1.5σ ... +2.0σ   | 1.287%     | 0.01287  |
| Base 10        | +2.0σ ... +2.5σ   | 3.300%     | 0.03300  |
| Base 11        | > +2.5σ           | 9.572%     | 0.09572  |

**Design Philosophy:**

- Buy tiers are **monotonically decreasing** (buy less as price rises toward mean)
- Sell tiers are **monotonically increasing** (sell more as price extends higher)
- Buy sizes are **much larger** than sell sizes (accumulation > distribution)

---

## Strategy Philosophy

### Why This Works

1. **Follows Smart Money:** Long-term holders have historically been the most profitable cohort. Their cost basis acts as a reliable value anchor.
1. **Counter-Cyclical:** Buy when others panic (below mean), sell when others are euphoric (above mean).
1. **Pyramiding:** Position sizes increase as price moves further from equilibrium, maximizing the advantage of extremes.
1. **Cycle Protection:** Bear pause prevents buying bubble tops; momentum filter prevents selling too early.
1. **Adaptive Execution:** Retrace exceptions catch secondary opportunities that pure tier-based systems would miss.

### Expected Behavior Over Time

**Bull Market:**

- Accumulate steadily as price climbs from -1.0σ to mean
- Begin selling small amounts above mean
- Increase sell size at each tier
- If price > +2.0σ → Bear pause activates, stop buying entirely
- Continue selling on the way down until bear pause exits

**Bear Market:**

- Resume buying as price drops below mean
- Buy most aggressively below -1.0σ (Base 1-2)
- Retrace exceptions may trigger if price briefly recovers

**Sideways Market:**

- Trade in and out of Base 5-6 range (near mean)
- Smaller position sizes maintain capital efficiency
- Momentum filter prevents overtrading in Base 7-9

---

## Risk Considerations

### What This Strategy Does Well

✅ **Maximizes bear market accumulation** (buys 20%+ of capital at extreme lows)  

✅ **Protects against blow-off tops** (bear pause prevents buying euphoria)  

✅ **Captures retrace opportunities** (buys dips that others miss)  

✅ **Avoids premature selling** (momentum filter lets winners run)

### What This Strategy Doesn't Do

❌ **Time exact tops/bottoms** (systematic, not predictive)  

❌ **Guarantee profits** (BTC can remain undervalued or overvalued longer than expected)  

❌ **Work in all market conditions** (optimized for cyclical assets like Bitcoin)  

❌ **Eliminate drawdowns** (will experience paper losses during bear markets)

### Key Assumptions

1. **Bitcoin follows LTH PVR cycles** — Historical correlation continues
2. **Long-term holders remain rational** — Their cost basis stays meaningful
3. **Mean reversion occurs** — Deviations from mean eventually correct
4. **Liquidity exists** — Can execute trades at published prices (VALR exchange)
5. **Monthly contributions continue** — Cash flow supports accumulation phases

---

## Backtesting Framework

The strategy includes a Python backtesting engine (`live_lth_pvr_rule2_momo_filter_v1.1.py`) with:

- **Walk-forward optimization** using Optuna (120 trials, 4 time splits)
- **Robust scoring:** `median(NAV / (1 + λ*DD + μ*drag))`
    - NAV: Net Asset Value (terminal portfolio value)
    - DD: Maximum drawdown (peak-to-trough decline)
    - drag: Average USDT/NAV (cash drag penalty)
- **Parameter constraints:** Buy tiers monotonically decrease, sell tiers monotonically increase
- **Lookback window:** 2010-01-01 to present (precomputes bear pause state)

### Running a Backtest

```bash
python live_lth_pvr_rule2_momo_filter_v1.1.py \
  --ci-price-key YOUR_API_KEY \
  --start 2015-10-06 \
  --end today \
  --out lth_pvr_results.csv \
  --debug
```

### Optimization Example

```bash
python live_lth_pvr_rule2_momo_filter_v1.1.py \
  --ci-price-key YOUR_API_KEY \
  --start 2015-10-06 \
  --end today \
  --optuna \
  --trials 120 \
  --splits 4 \
  --lambda-dd 0.25 \
  --mu-drag 0.10 \
  --out optimized_results.csv
```

This will search for the best Base sizes across 4 time periods and output the optimal configuration.

---

## Monitoring & Performance

### Key Metrics

| Metric           | Description                               | Target Range                           |
| ---------------- | ----------------------------------------- | -------------------------------------- |
| **NAV**          | Total portfolio value (USDT + BTC in USD) | Growing over time                      |
| **Total ROI**    | `(NAV / Invested) - 1`                    | > 100% over cycle                      |
| **CAGR**         | Compound annual growth rate               | 15-50%+                                |
| **Max Drawdown** | Largest peak-to-trough decline            | < 50%                                  |
| **Cash Drag**    | Average USDT / NAV ratio                  | 10-30%                                 |
| **BTC Balance**  | Accumulated BTC over time                 | Increasing in bear, decreasing in bull |

### Daily Alerts

The system generates alerts for:

- **Pipeline failures** (CI bands unavailable, order execution issues)
- **Order fills** (confirmation of buy/sell execution)
- **Bear pause transitions** (entering/exiting pause state)
- **Retrace triggers** (Cases A or B activated)
- **Balance reconciliation warnings** (mismatch between expected vs actual)

See [ADMIN_OPERATIONS_GUIDE.md](ADMIN_OPERATIONS_GUIDE.md) for monitoring procedures.

---

## Version History

### v1.1 (Current)

- **Rule 2:** Momentum filter for sells (ROC > 0% required in Base 7-9)
- **Bear pause override:** Momentum filter disabled during pause (all sells proceed)
- **Fee refinement:** Trade fees in BTC (base), contribution fees in USDT
- **8 decimal precision:** USDT amounts use 8dp (not 2dp) for accuracy

### v1.0

- **Initial release:** 11-tier system with bear pause
- **Retrace exceptions:** Cases A and B implemented
- **ChartInspect integration:** Static CI bands from API

---

## Related Documentation

- **[SDD_v0.6.md](SDD_v0.6.md)** — Complete system design and architecture
- **[ADMIN_OPERATIONS_GUIDE.md](ADMIN_OPERATIONS_GUIDE.md)** — Daily operations and monitoring
- **[DEPLOYMENT_COMPLETE.md](DEPLOYMENT_COMPLETE.md)** — Deployment procedures
- **Back-testing Script:** `docs/live_lth_pvr_rule2_momo_filter_v1.1.py`

---

## Quick Reference

### Decision Flowchart

```
START: Fetch today's CI bands and BTC price
  │
  ├─ Is bear_pause active?
  │   ├─ YES: Is price < -1.0σ?
  │   │   ├─ YES → Exit pause, proceed to rules
  │   │   └─ NO → Sell-only mode (no buys, ignore momentum filter)
  │   └─ NO → Proceed to rules
  │
  ├─ Is price > +2.0σ?
  │   └─ YES → Activate bear pause
  │
  ├─ Check retrace eligibility (was price in +1.0-1.5σ or +1.5-2.0σ?)
  │   └─ If retrace zone detected → BUY Base 3, skip tier logic
  │
  ├─ Is price < mean?
  │   ├─ YES → BUY (Base 1-5 by distance below mean)
  │   └─ NO → Continue
  │
  └─ Is price ≥ mean?
      └─ YES → SELL (Base 6-11 by distance above mean)
          └─ If Base 7-9 AND ROC ≤ 0% → HOLD (momentum filter)
```

### State Machine

```
NORMAL → [price > +2.0σ] → BEAR_PAUSE → [price < -1.0σ] → NORMAL
   │                            │
   ├─ Buy: Base 1-5           ├─ Buy: DISABLED
   ├─ Sell: Base 6-11         ├─ Sell: Base 6-11 (no momentum filter)
   └─ Retrace: Active         └─ Retrace: DISABLED
```

---

**Document Version:** 1.0  

**Strategy Version:** 1.1  

**Created:** February 20, 2026  

**Author:** BitWealth LTH PVR System

For questions or clarifications, refer to the backtesting script source code or consult the SDD.