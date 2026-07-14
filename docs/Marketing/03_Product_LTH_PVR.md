# Product One-Pager — LTH PVR Bitcoin DCA

**Status: Available now** · Pair: BTC/USDT · Version 1.0

---

## Headline

**LTH PVR Bitcoin DCA Strategy**
*Smart Bitcoin accumulation using on-chain intelligence.*

A rules-based strategy that capitalises on Bitcoin market cycles by monitoring Long-Term
Holder behaviour and the profit-to-volatility ratio. Automated, transparent, and fully
auditable.

---

## How it works — three pillars, plus an optional fourth

### 1 · On-Chain Signal — *the LTH PVR metric*
The **Long-Term Holder Profit-to-Volatility Ratio** measures the spot BTC price against
the average cost basis of investors who have held for more than 155 days — the “smart
money” cohort representing the large majority of circulating supply. The deviation is
normalised by the cohort's rolling volatility and expressed in **standard deviations (σ)**
from its mean.

Because it's computed directly from blockchain data, the signal reflects the actual
conviction of capital — not derivatives positioning, sentiment, or chart patterns — and
cannot be manipulated by short-term flows.

- Cycle-aware: historically a strong leading indicator of BTC macro turning points
- Manipulation-resistant — on-chain accumulation cannot be faked
- Low frequency, low noise: one decision per day

### 2 · Disciplined Accumulation — *dollar-cost averaging*
**DCA** commits a fixed contribution at a regular cadence regardless of market conditions.
By spreading entries through time it removes the single largest risk in a volatile asset:
mistiming the lump sum. Average cost converges to the mean over the contribution window.

- Eliminates entry-point risk
- Removes emotion — contributions execute on schedule
- Fully automated; no need to watch the market

### 3 · Adaptive Execution — *dynamic grid logic*
A traditional grid bot places orders at fixed price levels that quickly fall out of
alignment with a trending market. LTH PVR replaces those static lines with **dynamic
sigma bands** drawn around the daily on-chain mean. As the mean drifts, the whole grid
drifts with it — so orders are always sized relative to where the market is *now*.

- Grid lines self-recalibrate daily — never stale, never stranded
- Order size scales to statistical conviction (largest near ±2σ)
- Aggressive buys when oversold, trims when overheated
- Bear-market pause + momentum filter guard against trending-market wipe-outs

### 4 · Idle-Cash Yield with USDPC — *optional capital-efficiency layer*
Between Bitcoin positions, idle USD can be **automatically swept into USDPC** — an
on-chain USD private-credit token targeting roughly **8–10% APR** with low volatility and
low correlation to Bitcoin. The sweep never delays a trade: the instant a buy signal
fires, any USDPC is converted back to USD first so the Bitcoin order executes on time.

- Idle cash earns yield instead of sitting dormant
- Fully automatic; converted back the moment a buy fires
- Optional — enable or disable per portfolio

---

## Why it matters

LTH PVR is engineered for the best **risk-adjusted** outcome: accumulating patiently when
on-chain data says Bitcoin is cheap and trimming when it says Bitcoin is expensive. The
goal is a strategy investors can stay invested in through full market cycles — month
after month, drawdown after drawdown.

---

## Transparent pricing

| Fee | Rate | Detail |
|-----|------|--------|
| Performance fee | **10%** | On new profits only, above previous peak NAV (high-water-mark protection). Calculated monthly. |
| Platform fee | **0.75%** | One-time, charged on contributions only (e.g. $1,000 deposit → $7.50). |
| Everything else | **None** | No management fees, no withdrawal fees (beyond exchange costs), no inactivity fees. |

**High-water mark:** you never pay a performance fee twice for reaching the same value. If
the portfolio dips and recovers, no fee is charged on the recovery.

---

## Suggested calls-to-action

- **Primary:** *Try the interactive back-tester →*
- **Secondary:** *Learn more* · *Get started*

---

## Disclaimer

> ⚠️ Past performance does not guarantee future results. Cryptocurrency investments are
> volatile and carry risk, including the risk of loss. This material is for information
> only and is not financial advice.
