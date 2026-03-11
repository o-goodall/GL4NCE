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

### Signals (3-phase psychological confirmation model)

Validated across all cycles 2015–2025. Core indicators: MVRV Z-Score, NUPL, Fear & Greed Index.

#### 🟢 Deploy Phase — Trough Confirmation

3 of 4 signals active within the predicted trough window → high-confidence trough.
Historical cluster: ±~14–21 days of confirmed bottoms.

| # | Signal | Threshold | Behaviour Across Cycles |
|---|--------|-----------|-------------------------|
| 1 | **MVRV Z-Score** | < 1 | Bottoms in 2015, 2018, 2020, 2022 |
| 2 | **Price near/below 200W MA** | Near/Below 200-week MA | Bottom behaviour in 2015, 2018, 2022 |
| 3 | **Weekly RSI** | ≤ 35 | Capitulation lows in 2015, 2018, 2022 |
| 4 | **Fear & Greed Index** | ≤ 20 | Extreme fear in 2018, 2020, 2022 |

#### 🟡 Hold Phase — Bull Expansion

| # | Signal | Threshold | Behaviour Across Cycles |
|---|--------|-----------|-------------------------|
| 1 | **NUPL** | 0.25–0.60 | Bull regime in 2016–17, 2020–21, 2023–25 |
| 2 | **50W > 200W MA** | 50-week SMA above 200-week SMA | Classic bull structure every expansion |
| 3 | **Fear & Greed** | 60–85 | Greed range common in historical bulls, 2024–25 sentiment peaks |

#### 🔴 Reserve Phase — Peak / Late-Cycle

| # | Signal | Threshold | Historical Confirm |
|---|--------|-----------|--------------------|
| 1 | **MVRV Z-Score** | > 5–6 | Peaks in 2013, 2017, 2021 |
| 2 | **NUPL (Euphoria)** | > 0.70–0.75 | Past cycle peaks |
| 3 | **Weekly RSI** | ≥ 80 | Consistent with previous blow-offs |
| 4 | **Fear & Greed** | ≥ 90 | Psychological mania at tops |

---

## 6. Implementation

Changes in `src/components/ecommerce/MonthlyTarget.tsx`:

1. Replaced 5-signal boost architecture with 3-phase psychological
   confirmation model validated across 2015–2025 cycles.
2. **Deploy phase** (🟢): MVRV Z < 1, Below 200W MA, Weekly RSI ≤ 35,
   Fear & Greed ≤ 20. 3 of 4 active → trough confirmed.
3. **Hold phase** (🟡): NUPL 0.25–0.60, 50W > 200W MA, Fear & Greed 60–85.
4. **Reserve phase** (🔴): MVRV Z > 5–6, NUPL > 0.70, Weekly RSI ≥ 80,
   Fear & Greed ≥ 90.
5. Added 50-week SMA derivation from Binance weekly klines.
6. Removed Mining Difficulty Drop and Halving Phase signals (not
   universally reliable across all cycles).
7. MVRV Z-Score and NUPL shown as manual-check placeholders
   (require specialised on-chain APIs not freely available).

### What NOT to adopt from BSP

- **Equal daily purchases:** GL4NCE's price-weighted allocation is superior
  because buying more when price is low mechanically improves cost basis.
- **Single-dimension model:** GL4NCE's multi-signal approach (fear, difficulty,
  WMA, halving, peak/trough) captures real-time conditions that a pure
  time-based model cannot.
- **Fixed DCA duration:** A "427-day window" is useful for lump-sum deployment
  but not relevant for GL4NCE's recurring-buy model.
