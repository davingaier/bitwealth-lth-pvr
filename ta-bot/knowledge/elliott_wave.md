# Elliott Wave Theory + Fibonacci — Knowledge Base (tool `elliott_fib`)

This document is the single source of truth for BitWealth TA_BOT's Elliott Wave / Fibonacci tool.
It serves two consumers:

1. The **deterministic tool** (`worker/tools/elliott_fib/`) — every rule marked **[HARD]** is enforced in code;
   every guideline marked **[GUIDE]** contributes to the wave-count score.
2. The **Analyst agent** (LLM) — this file is injected verbatim as domain context so the agent reasons with
   the same vocabulary, rules and level definitions as the code, and refines (never overrides) the code's count.

---

## 1. Core principle

Markets move in repeating fractal patterns of **five waves in the direction of the trend of one larger
degree** (motive), followed by **three waves against it** (corrective). A complete cycle is 5-3 = 8 waves.
Every wave subdivides into waves of the next lower degree; every wave is itself a sub-wave of a higher degree.

```
        5
      3   \  B
    1  \ 4  \ A   C
  /  \ 2     \  /
0     \       ∨
```

Notation: motive waves are numbered **1-2-3-4-5**; corrective waves are lettered **A-B-C** (and D-E for triangles,
W-X-Y-Z for combinations).

### 1.1 Degrees and timeframes (how the tool maps them)

| Degree (Elliott) | Typical duration | Tool timeframe | ZigZag reversal threshold |
| --- | --- | --- | --- |
| Primary | months–years | 1d | 6 × ATR(14) |
| Intermediate | weeks–months | 4h / 1d | 4 × ATR |
| Minor | days–weeks | 1h / 4h | 3 × ATR |
| Minute | hours–days | 15m / 1h | 3 × ATR |
| Minuette | minutes–hours | 1m / 5m / 15m | 2.5 × ATR |

The tool runs a **two-degree count** per timeframe (a "higher" and a "lower" ZigZag threshold) so a wave 4 of the
higher degree can be seen subdividing into a-b-c of the lower degree.

---

## 2. Motive waves

### 2.1 Impulse (most common motive wave)

Five sub-waves; waves 1, 3, 5 are themselves motive; 2 and 4 are corrective.

**Rules (inviolable — a count that breaks one is NOT an impulse):**

- **[HARD-1]** Wave 2 never retraces more than 100 % of wave 1 (in a bull impulse the wave-2 low stays above the wave-0 origin).
- **[HARD-2]** Wave 3 is never the shortest of waves 1, 3 and 5 (measured in price).
- **[HARD-3]** Wave 4 never enters the price territory of wave 1 (in a bull impulse the wave-4 low stays above the wave-1 high). *Exception: diagonals (§2.2).*
- **[HARD-4]** Waves 1, 3, 5 must each move in the trend direction; 2 and 4 against it (pivots must alternate high/low).

**Guidelines (probabilistic — used for scoring):**

- **[GUIDE-EXT]** Exactly one of 1, 3 or 5 is usually **extended** (≈ 1.618× or more of the others). Wave 3 is the most frequent extension in crypto/stocks; wave 5 extensions are common in commodities.
- **[GUIDE-EQ]** When wave 3 is extended, waves 1 and 5 tend toward **equality** (W5 ≈ W1) or W5 ≈ 0.618 × W1.
- **[GUIDE-ALT]** **Alternation**: waves 2 and 4 differ in form — if 2 is a sharp, deep zigzag (50–78.6 % retrace), 4 is usually a shallow, sideways flat/triangle (23.6–38.2 %), and vice-versa. Alternation also applies to duration.
- **[GUIDE-CH]** **Channelling**: a line from the wave-2 end to the wave-4 end, with a parallel through the wave-3 end, projects the wave-5 termination zone.
- **[GUIDE-W2]** Wave 2 most often retraces **50 %, 61.8 % or 78.6 %** of wave 1.
- **[GUIDE-W4]** Wave 4 most often retraces **23.6 % or 38.2 %** of wave 3 (rarely 50 %). Its low often coincides with the wave-4 of one lesser degree inside wave 3.
- **[GUIDE-W3]** Wave 3 commonly ends at **1.618 ×**, less often 2.618 × or 4.236 × the length of wave 1, projected from the wave-2 end.
- **[GUIDE-W5]** Wave 5 commonly ends at **0.618 ×, 1.0 ×** or 1.618 × wave 1 projected from the wave-4 end, OR at **0.618 × (net distance 0→3)** projected from wave-4 end, OR at **1.618 × wave 4**. Truncated fifth: 5 fails to exceed the end of 3 (occurs after an exceptionally strong 3).
- **[GUIDE-VOL]** Volume is typically highest in wave 3, lower in wave 5 (momentum divergence).

### 2.2 Diagonals (leading / ending)

Five waves in a wedge where **wave 4 overlaps wave 1** and sub-waves are threes (3-3-3-3-3, ending) or 5-3-5-3-5
(leading). Wave 3 still cannot be shortest. Contracting diagonals: 1 > 3 > 5 and 2 > 4. Expanding: reverse.
Appear as wave 5 (ending) or wave 1 / A (leading). **Ending diagonals reverse violently** — a completed ending
diagonal is a high-probability reversal zone.

The deterministic tool flags a five-wave sequence that fails HARD-3 but satisfies the wedge geometry as
`diagonal_candidate` with reduced confidence; it does not attempt sub-wave verification.

---

## 3. Corrective waves

Corrections are **never fives** (a five against the trend is wave 1 or A of a new larger move). They are harder to
count and usually completed only in hindsight. Three families:

### 3.1 Zigzag (5-3-5)

Sharp correction. A and C are fives, B is a three. **B retraces 38.2–78.6 % of A** (never beyond A's origin).
**C ≈ A** (equality) most often; else **C = 0.618 × A** or **1.618 × A**. C usually exceeds the end of A.
Double / triple zigzags (W-X-Y / W-X-Y-X-Z) occur when one zigzag is insufficient.

### 3.2 Flat (3-3-5)

Sideways correction. B retraces **≥ 90 %** of A.
- *Regular*: B ≈ 100 % of A, C slightly beyond A.
- *Expanded* (most common): B ends **beyond the origin of A** (105–138 %), C ends beyond A (C = 1.618 × A typical).
- *Running*: B beyond origin of A and C fails to exceed the end of A — signals very strong larger trend.

### 3.3 Triangle (3-3-3-3-3)

Five waves A-B-C-D-E, each a three, contained by converging (contracting) or diverging (expanding) trendlines.
Appears **only** in wave 4, wave B, or the final X / Y of a combination — never wave 2. A triangle precedes the
**final** wave of the larger pattern ("thrust"). Thrust distance ≈ widest part of the triangle.

### 3.4 Combinations (W-X-Y, W-X-Y-X-Z)

Two or three corrective patterns joined by X waves. Usually sideways, extending time rather than price.

### 3.5 Corrective guidelines used for scoring

- **[GUIDE-CORR-DEPTH]** A correction most often ends within the **span of the previous wave 4 of one lesser degree**, most commonly near its terminal point; its **fib retrace of the whole impulse is typically 38.2–61.8 %** (deeper 78.6 % after a fifth-wave extension).
- **[GUIDE-CORR-TIME]** Corrections usually last longer than the motive wave they correct, often 1.0×, 1.618× or 2.618× its bar-count.

---

## 4. Fibonacci toolkit

All ratios derive from 0.618 (φ⁻¹) and its powers/complements.

### 4.1 Retracements (2-point tool: swing start → swing end)

Ratios: **0.236, 0.382, 0.5, 0.618, 0.786** (also 0.886 for deep-B flats). Applied to:
- Wave 1 → to locate wave 2 (favour 0.5 / 0.618 / 0.786).
- Wave 3 → to locate wave 4 (favour 0.236 / 0.382).
- Whole impulse 0→5 → to locate end of the ABC correction (favour 0.382 / 0.5 / 0.618).
- Wave A → to locate wave B (0.382–0.786 zigzag; ≥ 0.9 flat).

### 4.2 Trend-based Fibonacci extensions (3-point tool: A → B → C, projected from C)

Ratios: **0.618, 1.0, 1.272, 1.618, 2.0, 2.618** (4.236 for runaway thirds). Applied to:
- (0, 1, 2) → wave 3 targets (1.618 primary, 2.618 secondary).
- (0, 3, 4) using net 0→3 → wave 5 target at 0.618 × (0→3) from 4.
- (4, 5 projection using W1): W5 = 0.618 / 1.0 / 1.618 × W1 from the wave-4 end.
- (A, B, C): C = 1.0 / 0.618 / 1.618 × A from B.

### 4.3 Time-based Fibonacci extensions (bars, not price)

Time is a *supporting* dimension — a level that coincides with a fib time window gains strength; time alone is
never a trade trigger.
- **Time projection of a wave:** given bars(W1) = n, wave 3 tends to complete at 1.0 n, 1.618 n or 2.618 n bars
  after the wave-2 end; wave 5 at 0.618 n / 1.0 n / 1.618 n after the wave-4 end; C at 1.0 / 1.618 × bars(A) after B.
- **Fib time zones** from the impulse origin (0): vertical lines at 1, 2, 3, 5, 8, 13, 21, 34, 55 bars — turns cluster
  near these; only zones ≥ 8 bars out are considered meaningful.
- **Time windows** are emitted as `[from, to]` ranges (±10 % of the projected distance, min 1 bar) rather than
  single timestamps.

### 4.4 Confluence rules for fib levels

A single fib level is weak evidence. Strength rises when several independent projections land within a
small band (the confluence engine clusters levels within `k × ATR` of the analysis timeframe):
- Retracement of a wave **and** extension from a prior wave agreeing → strong.
- Level agreeing across **two degrees** (e.g., 0.382 of W3 higher-degree ≈ 0.618 of wave c lower-degree) → strong.
- Level inside the **previous wave-4-of-lesser-degree** span → strong.
- Level near a **fib time window** → bonus.

---

## 5. Directional bias — how the tool decides

The tool always emits `bias ∈ {bullish, bearish, neutral}` with `confidence ∈ [0,1]` and a one-line rationale.

| Structural state (best count) | Bias | Base confidence | Key levels emitted |
| --- | --- | --- | --- |
| Wave 1 confirmed, **wave 2 in progress** | with impulse, wait | 0.45 | Support (bull) at 0.5/0.618/0.786 of W1; invalidation = origin of W1 |
| Wave 2 confirmed, **wave 3 in progress** | with impulse, strongest | 0.70 | Targets 1.618/2.618 × W1 from W2; time window 1.0–1.618 × bars(W1) |
| Wave 3 confirmed, **wave 4 in progress** | with impulse, wait | 0.55 | Support at 0.236/0.382 of W3, and W4-of-lesser-degree span; invalidation = end of W1 |
| Wave 4 confirmed, **wave 5 in progress** | with impulse, weakening | 0.55 | Targets W5 = W1, 0.618 × W1, 0.618 × (0→3); channel line; time 0.618–1.0 × bars(W1) |
| **Impulse complete** (5 done, no reversal confirmation yet) | counter-trend (expect A-B-C) | 0.50 | Retrace of 0→5 at 0.382/0.5/0.618; prior W4 span |
| **Wave A complete, B in progress** | counter-trend | 0.45 | Resistance (bear corr.) at 0.382–0.786 of A |
| **Wave B complete, C in progress** | counter-trend | 0.60 | C targets 1.0/1.618 × A from B; whole-move 0.382/0.618 retrace |
| **A-B-C complete** at fib confluence | with prior trend (new impulse) | 0.60 | Reversal zone = C terminus; invalidation below C |
| No valid count (`neutral`) | neutral | 0.20 | Only raw swing highs/lows as pivots |

Confidence modifiers (additive, clamped 0.05–0.95):
- +0.10 wave-count score ≥ 0.75 (guidelines strongly satisfied)
- +0.05 higher-degree count agrees in direction; −0.15 if it conflicts
- −0.10 if the current wave has already exceeded its 1.618 × time projection (structure "late")
- −0.20 if price is within 0.5 × ATR of the invalidation level

**Invalidation is mandatory.** Every bias must carry the price that proves the count wrong. The Executor will place
stops beyond invalidation, never inside the pattern.

---

## 6. Wave-count scoring (deterministic)

For each candidate 6-pivot sequence (0,1,2,3,4,5) that passes HARD-1..4, score in [0,1]:

| Component | Weight | Full credit when |
| --- | --- | --- |
| W2 retrace | 0.20 | within 0.382–0.786 of W1 (peak at 0.5–0.618) |
| W3 extension | 0.25 | W3/W1 ∈ [1.382, 2.8] (peak 1.618) |
| W4 retrace | 0.15 | within 0.236–0.5 of W3 (peak 0.382) |
| W5 relation | 0.15 | W5/W1 ∈ [0.55, 1.1] or W5 ≈ 0.618 × (0→3) |
| Alternation | 0.10 | \|retrace(W2) − retrace(W4)\| ≥ 0.15 |
| Time proportion | 0.10 | bars(W3) ≥ bars(W1) and bars(W2)+bars(W4) ≥ 0.5 × (bars(W1)+bars(W3)+bars(W5)) |
| Extension present | 0.05 | max(W1,W3,W5) ≥ 1.618 × median of the three |

Candidates with score < `minWaveScore` (default 0.35) are discarded. In-progress structures (fewer than 6 pivots
since a plausible origin) are scored on the completed sub-waves only and tagged `in_progress: true`.

---

## 7. What this tool does NOT claim

- It does not verify sub-wave structure (a "three" vs a "five") inside each wave — that is the Analyst agent's job
  using the lower-degree count and this document.
- It does not detect triangles or combinations; those are surfaced by the Analyst from pivot geometry.
- Counts are **hypotheses with invalidation levels**, not predictions. Trading decisions require confluence with other
  tools and a calibrated probability (see confluence engine + calibration model).
