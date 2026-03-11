import type { IncomingMessage, ServerResponse } from "node:http";

// ── US Money Printer / BRRR Score API ──────────────────────────────────────
//
// Computes a 0–5 BRRR level for US monetary expansion using three pillars:
//
//   1. Liquidity (40%)  — WALCL − RRPONTSYD − WTREGEN  (30-day Δ)
//   2. Rates    (30%)  — Fed Funds Rate, 2Y Treasury yield, SOFR trend
//   3. Forward  (30%)  — Polymarket rate-cut / recession probabilities
//
// BRRR Levels:
//   0  Tightening
//   1  Neutral
//   2  Liquidity rising
//   3  Active stimulus
//   4  Heavy printing
//   5  Crisis printing (2008 / COVID scale)
//
// Historic calibration:
//   2008 crisis  — ~$1T expansion
//   2020 COVID   — ~$4–5T expansion
//   30-day Δ of ~$500B+ ≈ MAX BRRR territory

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
const POLYMARKET_API = "https://gamma-api.polymarket.com";

// ── FRED fetch ─────────────────────────────────────────────────────────────

interface FredObs { date: string; value: string }

async function fetchFred(
  series: string,
  apiKey: string,
  limit: number,
): Promise<FredObs[]> {
  const url =
    `${FRED_BASE}` +
    `?series_id=${encodeURIComponent(series)}` +
    `&api_key=${apiKey}` +
    `&limit=${limit}&sort_order=desc&file_type=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${res.status} for ${series}`);
  const body = (await res.json()) as { observations?: FredObs[] };
  return body.observations ?? [];
}

function parseObs(obs: FredObs[]): { date: string; value: number }[] {
  return obs
    .map((o) => ({ date: o.date, value: parseFloat(o.value) }))
    .filter((o) => !isNaN(o.value));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Polymarket helpers ─────────────────────────────────────────────────────

interface RawPolyMarket {
  id: string;
  question: string;
  outcomes?: unknown;
  outcomePrices?: unknown;
  active?: boolean | null;
  closed?: boolean | null;
}

interface RawPolyEvent {
  id: string;
  title: string;
  slug: string;
  markets?: RawPolyMarket[] | null;
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch { return []; }
  }
  return [];
}

async function fetchFedMarkets(): Promise<{ rateCutProb: number; recessionProb: number }> {
  let rateCutProb = -1;
  let recessionProb = -1;

  const tags = ["federal-reserve", "interest-rates", "economics"];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const results = await Promise.allSettled(
      tags.map((tag) =>
        fetch(
          `${POLYMARKET_API}/events?limit=15&closed=false&tag_slug=${encodeURIComponent(tag)}`,
          { headers: { Accept: "application/json" }, signal: controller.signal },
        ).then((r) => (r.ok ? r.json() : [])) as Promise<RawPolyEvent[]>,
      ),
    );

    const RE_RATE_CUT = /rate\s*cut|lower.*rate|fed.*cut|cut.*rate|ease.*rate/i;
    const RE_RECESSION = /recession|economic\s*downturn|contraction/i;
    const RE_EMERGENCY = /emergency.*fed|emergency.*action|emergency.*lend/i;

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const event of result.value) {
        if (!event.markets) continue;
        for (const market of event.markets) {
          if (market.closed === true || market.active === false) continue;
          const q = market.question ?? "";
          const outcomes = parseJsonArray(market.outcomes);
          const prices = parseJsonArray(market.outcomePrices);
          const yesIdx = outcomes.findIndex(
            (o) => o.toLowerCase() === "yes",
          );
          if (yesIdx < 0 || !prices[yesIdx]) continue;
          const prob = Math.round(parseFloat(prices[yesIdx]) * 100);
          if (isNaN(prob)) continue;

          if (RE_RATE_CUT.test(q) || RE_EMERGENCY.test(q)) {
            rateCutProb = Math.max(rateCutProb, prob);
          }
          if (RE_RECESSION.test(q)) {
            recessionProb = Math.max(recessionProb, prob);
          }
        }
      }
    }
  } catch {
    // Polymarket unavailable — degrade gracefully
  } finally {
    clearTimeout(timeout);
  }

  return { rateCutProb, recessionProb };
}

// ── Scoring constants ──────────────────────────────────────────────────────

// Weights for composite
const W_LIQUIDITY = 0.40;
const W_RATES     = 0.30;
const W_FORWARD   = 0.30;

// Liquidity 30-day Δ calibration (in billions USD):
//  -$200B or worse = 0 (QT)
//  +$0 = ~29 (neutral)
//  +$200B = ~57 (strong)
//  +$500B = 100 (MAX BRRR pace, annualized ~$6T)
const LIQ_FLOOR = -200;  // billions
const LIQ_CEIL  =  500;  // billions

// Rate trend: we compute a "dovishness" score 0–100
// Higher when rates are falling or low
// Fed Funds 0% → 100; 5.5% → 0
const RATE_CEIL  = 5.5;
const RATE_FLOOR = 0.0;

// SOFR spike detection: >50bps above Fed Funds = repo stress signal
const SOFR_SPREAD_THRESHOLD = 0.50;

// ── Response types ─────────────────────────────────────────────────────────

export interface PrinterIndicator {
  label:    string;
  value:    number;
  score:    number;
  weight:   number;
  elevated: boolean;
  arrow?:   "up" | "down" | "flat";
  detail?:  string;
}

export interface PrinterScoreResult {
  brrrLevel:     number;       // 0–5
  score:         number;       // 0–100 composite (kept for gradient/bar)
  regime:        string;       // "Tightening" | "Normal" | "Stimulus" | "Strong Printing" | "Crisis Printing" | "MAX BRRR"
  status:        string;       // Short status label
  liquidity: {
    current:     number;       // billions
    change30d:   number;       // billions change over ~30 days
    walcl:       number;       // Fed balance sheet
    rrp:         number;       // Reverse repo
    tga:         number;       // Treasury General Account
  };
  rates: {
    fedFunds:    number | null;
    yield2y:     number | null;
    sofr:        number | null;
    sofrSpread:  number | null; // SOFR − Fed Funds
    repoStress:  boolean;
  };
  forward: {
    rateCutProb:    number;   // -1 = unavailable
    recessionProb:  number;   // -1 = unavailable
  };
  indicators:   PrinterIndicator[];
  updatedAt:    string;
}

// ── Regime / Level mapping ─────────────────────────────────────────────────

function brrrLevel(score: number): number {
  if (score >= 90) return 5;
  if (score >= 70) return 4;
  if (score >= 50) return 3;
  if (score >= 30) return 2;
  if (score >= 15) return 1;
  return 0;
}

function regimeName(level: number): string {
  switch (level) {
    case 5: return "Crisis Printing";
    case 4: return "Heavy Printing";
    case 3: return "Active Stimulus";
    case 2: return "Liquidity Rising";
    case 1: return "Neutral";
    default: return "Tightening";
  }
}

function statusLabel(level: number): string {
  switch (level) {
    case 5: return "🔴 Crisis printing";
    case 4: return "🟠 Heavy printing";
    case 3: return "🟡 Active stimulus";
    case 2: return "🟢 Liquidity rising";
    case 1: return "⚪ Neutral";
    default: return "🔵 Tightening";
  }
}

// ── Handler ────────────────────────────────────────────────────────────────

export default async function handler(
  _req: IncomingMessage,
  res:  ServerResponse,
): Promise<void> {
  const apiKey = process.env.FRED_API_KEY ?? "";

  if (!apiKey) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "FRED_API_KEY not configured" }));
    return;
  }

  try {
    // ── Fetch all data in parallel ───────────────────────────────────────
    // WALCL: weekly, need ~12 observations for 30-day window
    // RRPONTSYD: daily, need ~45 for 30 days
    // WTREGEN: weekly, need ~12 for 30-day comparison
    // DFF: daily Fed Funds rate
    // DGS2: daily 2-year Treasury yield
    // SOFR: daily SOFR rate
    const [walclRes, rrpRes, tgaRes, dffRes, dgs2Res, sofrRes, polyRes] =
      await Promise.allSettled([
        fetchFred("WALCL",      apiKey, 12),
        fetchFred("RRPONTSYD",  apiKey, 45),
        fetchFred("WTREGEN",    apiKey, 12),
        fetchFred("DFF",        apiKey, 10),
        fetchFred("DGS2",       apiKey, 10),
        fetchFred("SOFR",       apiKey, 10),
        fetchFedMarkets(),
      ]);

    // ── 1. LIQUIDITY ─────────────────────────────────────────────────────
    // Liquidity = WALCL − RRPONTSYD − WTREGEN
    // Compute current value and ~30-day change

    const walclPts = walclRes.status === "fulfilled" ? parseObs(walclRes.value) : [];
    const rrpPts   = rrpRes.status   === "fulfilled" ? parseObs(rrpRes.value)   : [];
    const tgaPts   = tgaRes.status   === "fulfilled" ? parseObs(tgaRes.value)   : [];

    // Most recent values
    const walclNow = walclPts.length > 0 ? walclPts[0].value : 0;
    const rrpNow   = rrpPts.length   > 0 ? rrpPts[0].value   : 0;
    const tgaNow   = tgaPts.length   > 0 ? tgaPts[0].value   : 0;

    // ~30 days ago (WALCL is weekly so index ~4 is about 1 month)
    const walclPrev = walclPts.length >= 5 ? walclPts[4].value : walclPts[walclPts.length - 1]?.value ?? walclNow;
    const rrpPrev   = rrpPts.length  >= 22 ? rrpPts[21].value  : rrpPts[rrpPts.length - 1]?.value     ?? rrpNow;
    const tgaPrev   = tgaPts.length  >= 5  ? tgaPts[4].value   : tgaPts[tgaPts.length - 1]?.value     ?? tgaNow;

    const liqNow  = walclNow  - rrpNow  - tgaNow;
    const liqPrev = walclPrev - rrpPrev  - tgaPrev;
    const liqChange30d = liqNow - liqPrev;

    // Map 30-day change to 0–100 sub-score
    const liqScore = clamp(
      ((liqChange30d - LIQ_FLOOR) / (LIQ_CEIL - LIQ_FLOOR)) * 100,
      0,
      100,
    );

    const liqArrow: "up" | "down" | "flat" =
      liqChange30d > 20 ? "up" : liqChange30d < -20 ? "down" : "flat";

    // ── 2. RATE PRESSURE ─────────────────────────────────────────────────
    const dffPts  = dffRes.status  === "fulfilled" ? parseObs(dffRes.value)  : [];
    const dgs2Pts = dgs2Res.status === "fulfilled" ? parseObs(dgs2Res.value) : [];
    const sofrPts = sofrRes.status === "fulfilled" ? parseObs(sofrRes.value) : [];

    const fedFunds = dffPts.length  > 0 ? dffPts[0].value  : null;
    const yield2y  = dgs2Pts.length > 0 ? dgs2Pts[0].value : null;
    const sofr     = sofrPts.length > 0 ? sofrPts[0].value : null;

    // Dovishness: lower rates = more printing likely
    // Use average of available rates, map inversely
    const rateValues: number[] = [];
    if (fedFunds !== null) rateValues.push(fedFunds);
    if (yield2y !== null) rateValues.push(yield2y);
    if (sofr !== null) rateValues.push(sofr);

    let rateScore = 50; // default neutral if no rate data
    if (rateValues.length > 0) {
      const avgRate = rateValues.reduce((a, b) => a + b, 0) / rateValues.length;
      // High rates → low score (tightening); low rates → high score (easy money)
      rateScore = clamp(((RATE_CEIL - avgRate) / (RATE_CEIL - RATE_FLOOR)) * 100, 0, 100);
    }

    // Rate direction: compare current vs ~1 week ago
    let rateArrow: "up" | "down" | "flat" = "flat";
    if (dffPts.length >= 5) {
      const diff = dffPts[0].value - dffPts[4].value;
      rateArrow = diff < -0.05 ? "down" : diff > 0.05 ? "up" : "flat";
    }

    // SOFR spread (repo stress detection)
    const sofrSpread = sofr !== null && fedFunds !== null ? sofr - fedFunds : null;
    const repoStress = sofrSpread !== null && sofrSpread > SOFR_SPREAD_THRESHOLD;

    // Boost rate score if repo stress detected (precursor to emergency printing)
    if (repoStress) {
      rateScore = Math.min(100, rateScore + 20);
    }

    // ── 3. FORWARD SIGNAL (Polymarket) ───────────────────────────────────
    const polyData = polyRes.status === "fulfilled"
      ? polyRes.value
      : { rateCutProb: -1, recessionProb: -1 };

    let forwardScore = 50; // neutral default
    const validProbs: number[] = [];
    if (polyData.rateCutProb >= 0) validProbs.push(polyData.rateCutProb);
    if (polyData.recessionProb >= 0) validProbs.push(polyData.recessionProb);

    if (validProbs.length > 0) {
      // Higher probability of rate cuts / recession → higher BRRR risk
      forwardScore = Math.round(
        validProbs.reduce((a, b) => a + b, 0) / validProbs.length,
      );
    }

    // ── COMPOSITE ────────────────────────────────────────────────────────
    const composite = Math.round(
      liqScore     * W_LIQUIDITY +
      rateScore    * W_RATES     +
      forwardScore * W_FORWARD,
    );

    const level  = brrrLevel(composite);
    const regime = regimeName(level);
    const status = statusLabel(level);

    // ── Build indicators ─────────────────────────────────────────────────
    const indicators: PrinterIndicator[] = [
      {
        label:    "Liquidity Δ30d",
        value:    Math.round(liqChange30d),
        score:    Math.round(liqScore),
        weight:   W_LIQUIDITY,
        elevated: liqScore >= 50,
        arrow:    liqArrow,
        detail:   `${liqChange30d >= 0 ? "+" : ""}$${Math.abs(Math.round(liqChange30d))}B`,
      },
      {
        label:    "Rate Pressure",
        value:    fedFunds ?? 0,
        score:    Math.round(rateScore),
        weight:   W_RATES,
        elevated: rateScore >= 50,
        arrow:    rateArrow,
        detail:   rateArrow === "down" ? "↓ expected" : rateArrow === "up" ? "↑ rising" : "→ flat",
      },
      {
        label:    "Market Odds",
        value:    polyData.rateCutProb >= 0 ? polyData.rateCutProb : 0,
        score:    Math.round(forwardScore),
        weight:   W_FORWARD,
        elevated: forwardScore >= 60,
        arrow:    forwardScore >= 60 ? "up" : forwardScore <= 30 ? "down" : "flat",
        detail:   polyData.rateCutProb >= 0 ? `${polyData.rateCutProb}% rate cut` : "unavailable",
      },
    ];

    if (repoStress) {
      indicators.push({
        label:    "Repo Stress",
        value:    sofrSpread ?? 0,
        score:    100,
        weight:   0,
        elevated: true,
        arrow:    "up",
        detail:   `SOFR +${((sofrSpread ?? 0) * 100).toFixed(0)}bps above FFR`,
      });
    }

    const result: PrinterScoreResult = {
      brrrLevel:  level,
      score:      composite,
      regime,
      status,
      liquidity: {
        current:   Math.round(liqNow),
        change30d: Math.round(liqChange30d),
        walcl:     Math.round(walclNow),
        rrp:       Math.round(rrpNow),
        tga:       Math.round(tgaNow),
      },
      rates: {
        fedFunds,
        yield2y,
        sofr,
        sofrSpread: sofrSpread !== null ? Math.round(sofrSpread * 10000) / 10000 : null,
        repoStress,
      },
      forward: {
        rateCutProb:   polyData.rateCutProb,
        recessionProb: polyData.recessionProb,
      },
      indicators,
      updatedAt: new Date().toISOString(),
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
    res.end(JSON.stringify(result));
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
