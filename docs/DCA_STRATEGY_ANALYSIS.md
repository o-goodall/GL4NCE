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
| **Cycle awareness** | Pre-halving window only (≤ 365 days before the next halving → +10 % boost). |
| **Signals (4)** | Fear & Greed Index, Mining Difficulty Drop, Pre-Halving Window, Price Below 200WMA. |

---

## 2. Comparison

| Dimension | BSP | GL4NCE | Verdict |
|-----------|-----|--------|---------|
| **What it answers** | *"How long should I DCA?"* | *"How much should I buy this period?"* | Complementary; GL4NCE is more actionable for recurring buyers. |
| **Price sensitivity** | None — equal buys every day. | High — buys more when price is low relative to range. | GL4NCE is better: buying more at lower prices improves cost basis. |
| **Cycle coverage** | Full 4-year cycle. | Partial — only the pre-halving window (25 % of the cycle). | **BSP is stronger here.** GL4NCE misses the post-halving accumulation phase, which historically offers the best risk/reward. |
| **Signal diversity** | Single dimension (time). | Four independent signals (sentiment, mining, halving, price vs 200WMA). | GL4NCE is richer and more responsive to real-time conditions. |
| **Adaptability** | Static equal amounts. | Dynamic amounts that respond to changing conditions. | GL4NCE is superior for active DCA strategies. |
| **Simplicity** | Very simple — one number (days). | More complex — requires multiple API feeds. | BSP is easier to understand; GL4NCE provides better guidance. |

---

## 3. Key Insight from BSP That Improves GL4NCE

> **The post-halving accumulation phase (0 – 18 months after a halving) is
> historically one of the best windows to accumulate Bitcoin, yet the current
> GL4NCE signal has no coverage for this period.**

The 4-year halving cycle can be split roughly into four phases:

```
Phase            │ Approx. timing          │ Market behaviour
─────────────────┼─────────────────────────┼──────────────────────────────
Post-Halving     │ 0 – 18 months after     │ Supply shock building;
Accumulation     │ halving                 │ prices consolidate then
                 │                         │ begin trending up.
─────────────────┼─────────────────────────┼──────────────────────────────
Mid-Cycle        │ 18 – 36 months after    │ Price discovery / markup;
Markup           │ halving                 │ volatility increases.
─────────────────┼─────────────────────────┼──────────────────────────────
Late-Cycle       │ 36 – 48 months after    │ Distribution / euphoria;
Distribution     │ halving                 │ risk of cycle top.
─────────────────┼─────────────────────────┼──────────────────────────────
Pre-Halving      │ ≤ 12 months before      │ Correction / accumulation;
Window           │ next halving            │ anticipation builds.
```

The current GL4NCE signal only activates the halving boost during the
**Pre-Halving Window** — the last 12 months of the cycle. This means the
first ~18 months after a halving (often the most favourable accumulation
period) receive **no cycle-based boost**.

BSP's cycle-position model inherently accounts for the post-halving
accumulation phase by recommending aggressive DCA during this period.

---

## 4. Recommendation

### What to adopt from BSP

**Add a Post-Halving Accumulation signal** to the GL4NCE DCA widget.

- **Trigger:** Activate when the current date is within 547 days (≈ 18 months)
  of the most recent halving.
- **Boost:** +10 % (same weight as the existing pre-halving boost).
- **Display:** Show as "Post-Halv" in the signal footer with days since
  halving.
- **Rationale:** Historically, this phase coincides with a supply shock and
  an emerging uptrend — an ideal accumulation window that the current signal
  ignores.

This converts the existing single-event "Halving" signal into a **full
cycle-phase indicator** covering both ends of the halving:

| Period | Signal label | Status |
|--------|-------------|--------|
| 0 – 547 d after halving | **Post-Halv** (NEW) | 🟢 Active |
| 547 d after halving → 365 d before next | **Cycle** | ⚪ Inactive |
| ≤ 365 d before next halving | **Pre-Halving** (existing) | 🟢 Active |

This extends cycle-aware boost coverage from **25 %** to roughly **63 %** of
the full halving cycle.

### What NOT to adopt from BSP

- **Equal daily purchases:** GL4NCE's price-weighted allocation is superior
  because buying more when price is low mechanically improves cost basis.
- **Single-dimension model:** GL4NCE's multi-signal approach (fear, difficulty,
  WMA) captures real-time conditions that a pure time-based model cannot.
- **Fixed DCA duration:** A "427-day window" is useful for lump-sum deployment
  but not relevant for GL4NCE's recurring-buy model.

---

## 5. Implementation

The post-halving accumulation signal has been implemented in
`src/components/ecommerce/MonthlyTarget.tsx`. Changes:

1. Added `PREV_HALVING_MS` (20 Apr 2024) and `POST_HALVING_WINDOW` (547 days)
   constants.
2. Added `BOOST_POST_HALVING = 10` boost constant.
3. Derived `postHalvingActive` signal state and `daysSinceHalving` counter.
4. Integrated the boost into the existing allocation calculation.
5. Updated the Halving signal item to display "Post-Halv" / "Pre-Halving" /
   "Cycle" depending on the current phase.
