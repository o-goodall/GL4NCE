# DCA Strategy Analysis

## Bitcoin Strategy Platform (BSP) vs GL4NCE DCA Signal

### Overview

This document compares the Dollar-Cost Averaging strategy presented on
[bitcoinstrategyplatform.com/dca](https://www.bitcoinstrategyplatform.com/dca)
with the current GL4NCE DCA Signal and outlines which elements of the BSP
approach could improve our signal.

---

## 1. How Each Approach Works

### BSP — Cycle-Sensitive Time-Based DCA

| Aspect | Detail |
|--------|--------|
| **Core idea** | Spread a lump sum evenly over an *optimal number of days* determined by where Bitcoin sits in its 4-year halving cycle. |
| **Current recommendation** | ~427-day DCA window (as of early 2026). |
| **Allocation model** | Equal daily purchases — no price-based weighting. |
| **Cycle awareness** | Full 4-year cycle: accumulation (post-halving), markup, distribution, markdown. The recommended DCA duration shifts daily as the cycle progresses. |
| **Signals used** | Cycle position only (days since / until halving). |

### GL4NCE — Price-Position + Multi-Signal Boost DCA

| Aspect | Detail |
|--------|--------|
| **Core idea** | Calculate a *per-period buy amount* (AUD 0 – 1 000) based on current price relative to the 200-week Moving Average (floor) and All-Time High (ceiling), boosted by macro/on-chain signals. |
| **Allocation model** | Inversely proportional to price position in the ATH↔200WMA range, multiplied by signal boosts. |
| **Cycle awareness** | Full: pre-halving window, post-halving accumulation, cycle peak dampening, cycle trough boosting. |
| **Signals (5)** | Fear & Greed Index, Mining Difficulty Drop, Halving Cycle Phase, Cycle Peak/Trough Proximity, Price Below 200WMA. |

---

## 2. Comparison

| Dimension | BSP | GL4NCE | Verdict |
|-----------|-----|--------|---------|
| **What it answers** | *"How long should I DCA?"* | *"How much should I buy this period?"* | Complementary; GL4NCE is more actionable for recurring buyers. |
| **Price sensitivity** | None — equal buys every day. | High — buys more when price is low relative to range. | GL4NCE is better: buying more at lower prices improves cost basis. |
| **Cycle coverage** | Full 4-year cycle. | Full — halving phases + peak/trough proximity cover the entire cycle. | Both have strong cycle awareness. GL4NCE is now on par. |
| **Signal diversity** | Single dimension (time). | Five independent signals (sentiment, mining, halving, peak/trough, price vs 200WMA). | GL4NCE is richer and more responsive to real-time conditions. |
| **Adaptability** | Static equal amounts. | Dynamic amounts that respond to changing conditions. | GL4NCE is superior for active DCA strategies. |
| **Simplicity** | Very simple — one number (days). | More complex — requires multiple API feeds. | BSP is easier to understand; GL4NCE provides better guidance. |

---

## 3. Bitcoin Market Cycle Data

### Key Dates

| Event | Date | Type |
|-------|------|------|
| Halving | 28 Nov 2012 | Supply reduction |
| **Peak** | **04 Dec 2013** | Cycle high |
| **Trough** | **14 Jan 2015** | Cycle low |
| Halving | 09 Jul 2016 | Supply reduction |
| **Peak** | **16 Dec 2017** | Cycle high |
| **Trough** | **15 Dec 2018** | Cycle low |
| Halving | 11 May 2020 | Supply reduction |
| **Peak** | **18 Nov 2021** | Cycle high |
| **Trough** | **21 Nov 2022** | Cycle low |
| Halving | 20 Apr 2024 | Supply reduction |
| **Peak** | **06 Dec 2025** *(projected)* | Cycle high |
| **Trough** | **15 Dec 2028** *(projected)* | Cycle low |

### Cycle Pattern (approx. timing from halving)

```
Phase            │ Approx. timing          │ Market behaviour
─────────────────┼─────────────────────────┼──────────────────────────────
Post-Halving     │ 0 – 18 months after     │ Supply shock building;
Accumulation     │ halving                 │ prices consolidate then
                 │                         │ begin trending up.
─────────────────┼─────────────────────────┼──────────────────────────────
Cycle Peak       │ ~18 months after        │ Euphoria / blow-off top.
                 │ halving                 │ Historically ±90 days of
                 │                         │ the projected peak date.
─────────────────┼─────────────────────────┼──────────────────────────────
Post-Peak        │ 18 – 36 months after    │ Correction / bear market;
Markdown         │ halving                 │ prices decline.
─────────────────┼─────────────────────────┼──────────────────────────────
Cycle Trough     │ ~30 months after        │ Capitulation / bottom.
                 │ halving                 │ Historically ±90 days of
                 │                         │ the projected trough date.
─────────────────┼─────────────────────────┼──────────────────────────────
Pre-Halving      │ ≤ 12 months before      │ Recovery / anticipation;
Window           │ next halving            │ market starts repricing.
```

---

## 4. Key Insights That Improve GL4NCE

### Insight 1: Post-halving accumulation (implemented)

> **The post-halving accumulation phase (0 – 18 months after a halving) is
> historically one of the best windows to accumulate Bitcoin.**

This was the first enhancement: a +10 % boost during the 547-day window
after a halving.

### Insight 2: Cycle peak dampening (NEW)

> **Near projected cycle peaks, the DCA strategy should reduce allocation
> to avoid over-buying at inflated prices.**

While the existing "PASS" signal (price > ATH) covers the extreme case, the
cycle peak zone catches the broader distribution phase. A −10 % dampen
within ±90 days of a projected peak reduces exposure during the most
dangerous part of the cycle.

### Insight 3: Cycle trough boosting (NEW)

> **Near projected cycle troughs, the DCA strategy should increase allocation
> to capture historically discounted prices.**

A +15 % boost within ±90 days of a projected trough complements the
200WMA signal by adding time-based context. Troughs are the single best
accumulation windows in Bitcoin's history.

---

## 5. Signal Architecture

### Signals (5 total)

| # | Signal | Threshold | Boost | Purpose |
|---|--------|-----------|-------|---------|
| 1 | **Fear / Greed** | ≤ 40 (active), ≤ 20 (extreme) | +10 % / +20 % | Sentiment-based accumulation |
| 2 | **Diff Drop** | < −5 % | +10 % | Mining difficulty drop → miner capitulation |
| 3 | **Halving Phase** | Post-halving (≤ 547 d) / Pre-halving (≤ 365 d) | +10 % | Supply-shock cycle timing |
| 4 | **Peak / Trough** | ±90 d of projected date | −10 % (peak) / +15 % (trough) | Cycle peak/trough proximity |
| 5 | **Below 200WMA** | Price < 200-week MA | +25 % | Historically rare extreme buy zone |

### Boost Ranges

| Scenario | Total Boost |
|----------|-------------|
| Best case (trough + fear extreme + below WMA + post-halving + diff drop) | +80 % |
| Neutral (no signals active) | 0 % |
| Worst case (near peak only) | −10 % |

---

## 6. Implementation

Changes in `src/components/ecommerce/MonthlyTarget.tsx`:

1. Added historical + projected cycle **peak dates** (Dec 2013, Dec 2017,
   Nov 2021, Dec 2025) and **trough dates** (Jan 2015, Dec 2018, Nov 2022,
   Dec 2028) as `CYCLE_PEAKS_MS` and `CYCLE_TROUGHS_MS`.
2. Added `getCyclePhase()` helper that finds the nearest peak/trough and
   returns `"near-peak"`, `"near-trough"`, or `"mid-cycle"` with days away.
3. Added `BOOST_NEAR_TROUGH = 15` and `DAMPEN_NEAR_PEAK = -10` constants.
4. Integrated cycle phase into the boost calculation.
5. Added 5th signal to footer: shows "Near Peak" / "Near Trough" /
   "Mid-Cycle" with days to/from nearest event.
6. Expanded signal grid from `grid-cols-4` to `grid-cols-5`.

### What NOT to adopt from BSP

- **Equal daily purchases:** GL4NCE's price-weighted allocation is superior
  because buying more when price is low mechanically improves cost basis.
- **Single-dimension model:** GL4NCE's multi-signal approach (fear, difficulty,
  WMA, halving, peak/trough) captures real-time conditions that a pure
  time-based model cannot.
- **Fixed DCA duration:** A "427-day window" is useful for lump-sum deployment
  but not relevant for GL4NCE's recurring-buy model.
