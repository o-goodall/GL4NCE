import type { IncomingMessage, ServerResponse } from "node:http";

// ── FRLI — Fed Reserve Liquidity Index ──────────────────────────────────────
//
// Computes a 0–5 FRLI level using weighted Z-scores of 4 monetary metrics:
//
//   1. M1 & M2 Growth YoY   (35%)  — Money supply expansion
//   2. Fed Balance Sheet ΔYoY (30%) — QE / liquidity injections
//   3. Total Reserves at Fed  (20%) — Fastest banking liquidity indicator
//   4. Reverse Repo Net       (15%) — Fed draining or adding short-term liquidity
//
// FRLI Levels (statistically grounded Z-score bands):
//   0  Strong tightening / liquidity drained
//   1  Mild tightening / near neutral
//   2  Neutral / normal liquidity
//   3  Mild expansion / early QE
//   4  Active QE / emergency liquidity
//   5  Extreme intervention / systemic backstop
//
// Z-scores are computed relative to ~3-year historical norms.
// Positive composite → expansion (money printing)
// Negative composite → contraction

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

// ── FRLI Metric Weights (Z-score composite) ───────────────────────────────
//
//  Metric                        Weight   Why
//  M1 & M2 Growth (YoY)          0.35    Captures money supply expansion
//  Fed Balance Sheet Δ (YoY)     0.30    Reflects QE / liquidity injections
//  Total Reserves at Fed          0.20    Fastest indicator of banking liquidity
//  Reverse Repo Net               0.15    Shows Fed draining or adding short-term liquidity

const W_M1M2     = 0.35;
const W_BALANCE  = 0.30;
const W_RESERVES = 0.20;
const W_REPO     = 0.15;

// SOFR spike detection (display only — not in composite)
const SOFR_SPREAD_THRESHOLD = 0.50;

// ── Z-score helper ─────────────────────────────────────────────────────────
// Returns the Z-score of the first (most recent) value relative to the series.

function zScoreOf(series: number[]): { z: number; mean: number; stddev: number } {
  if (series.length < 2) return { z: 0, mean: series[0] ?? 0, stddev: 1 };
  const n    = series.length;
  const mean = series.reduce((s, v) => s + v, 0) / n;
  const vari = series.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const sd   = Math.sqrt(vari);
  if (sd < 1e-10) return { z: 0, mean, stddev: 1 };
  return { z: (series[0] - mean) / sd, mean, stddev: sd };
}

// ── Response types ─────────────────────────────────────────────────────────

export interface FrliMetric {
  label:    string;
  raw:      number;       // raw value (growth %, $ change, level)
  zScore:   number;       // individual Z-score
  weight:   number;
  arrow:    "up" | "down" | "flat";
  detail:   string;
}

export interface PrinterScoreResult {
  frliLevel:     number;       // 0–5
  frliScore:     number;       // raw composite weighted Z-score
  regime:        string;       // descriptive label
  status:        string;       // short status copy
  metrics:       FrliMetric[]; // 4 core FRLI metrics
  balanceSheetYoY: number;     // Fed BS YoY change in billions (for historical comparison)
  rates: {
    fedFunds:    number | null;
    yield2y:     number | null;
    sofr:        number | null;
    sofrSpread:  number | null;
    repoStress:  boolean;
  };
  forward: {
    rateCutProb:    number;    // -1 = unavailable
    recessionProb:  number;    // -1 = unavailable
  };
  updatedAt:    string;
}

// ── FRLI Level mapping (statistically grounded Z-score bands) ──────────────

function toFrliLevel(z: number): number {
  if (z >  2.0) return 5;   // Extreme intervention / systemic backstop
  if (z >  1.0) return 4;   // Active QE / emergency liquidity
  if (z >  0.3) return 3;   // Mild expansion / early QE
  if (z > -0.3) return 2;   // Neutral / normal liquidity
  if (z > -1.0) return 1;   // Mild tightening / near neutral
  return 0;                  // Strong tightening / liquidity drained
}

function regimeName(level: number): string {
  switch (level) {
    case 5: return "Extreme Intervention";
    case 4: return "Active QE";
    case 3: return "Mild Expansion";
    case 2: return "Neutral";
    case 1: return "Mild Tightening";
    default: return "Strong Tightening";
  }
}

function statusLabel(level: number): string {
  switch (level) {
    case 5: return "Systemic backstop";
    case 4: return "Emergency liquidity";
    case 3: return "Early QE / expansion";
    case 2: return "Normal liquidity";
    case 1: return "Near neutral";
    default: return "Liquidity drained";
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
    //
    // Core FRLI metrics:
    //   M1SL       – monthly M1 money supply       (36 obs ≈ 3 yr → 24 YoY points)
    //   M2SL       – monthly M2 money supply       (36 obs ≈ 3 yr → 24 YoY points)
    //   WALCL      – weekly Fed balance sheet       (120 obs ≈ 2.3 yr → ~68 YoY points)
    //   TOTRESNS   – monthly total reserves         (36 obs ≈ 3 yr)
    //   RRPONTSYD  – daily overnight reverse repo   (500 obs ≈ 2 yr)
    //
    // Display-only (rates + Polymarket):
    //   DFF, DGS2, SOFR – latest 10 daily observations each
    //   Polymarket       – rate-cut & recession probabilities

    const [
      m1Res, m2Res, walclRes, resRes, rrpRes,
      dffRes, dgs2Res, sofrRes, polyRes,
    ] = await Promise.allSettled([
      fetchFred("M1SL",       apiKey, 36),
      fetchFred("M2SL",       apiKey, 36),
      fetchFred("WALCL",      apiKey, 120),
      fetchFred("TOTRESNS",   apiKey, 36),
      fetchFred("RRPONTSYD",  apiKey, 500),
      fetchFred("DFF",        apiKey, 10),
      fetchFred("DGS2",       apiKey, 10),
      fetchFred("SOFR",       apiKey, 10),
      fetchFedMarkets(),
    ]);

    // ── 1. M1 & M2 YoY Growth (weight 0.35) ─────────────────────────────
    const m1Pts = m1Res.status === "fulfilled" ? parseObs(m1Res.value) : [];
    const m2Pts = m2Res.status === "fulfilled" ? parseObs(m2Res.value) : [];

    // Build series of averaged M1+M2 YoY growth rates (%)
    const minMonths = Math.min(m1Pts.length, m2Pts.length);
    const m1m2GrowthSeries: number[] = [];
    for (let i = 0; i + 12 < minMonths; i++) {
      const g1 = ((m1Pts[i].value / m1Pts[i + 12].value) - 1) * 100;
      const g2 = ((m2Pts[i].value / m2Pts[i + 12].value) - 1) * 100;
      m1m2GrowthSeries.push((g1 + g2) / 2);
    }
    const m1m2Z = zScoreOf(m1m2GrowthSeries);
    const latestM1M2 = m1m2GrowthSeries[0] ?? 0;

    const m1m2Arrow: "up" | "down" | "flat" =
      m1m2GrowthSeries.length >= 2
        ? m1m2GrowthSeries[0] > m1m2GrowthSeries[1] + 0.3 ? "up"
        : m1m2GrowthSeries[0] < m1m2GrowthSeries[1] - 0.3 ? "down"
        : "flat"
        : "flat";

    // ── 2. Fed Balance Sheet YoY Change (weight 0.30) ────────────────────
    const walclPts = walclRes.status === "fulfilled" ? parseObs(walclRes.value) : [];

    // Build series of 52-week (YoY) changes
    const bsChangeSeries: number[] = [];
    for (let i = 0; i + 52 < walclPts.length; i++) {
      bsChangeSeries.push(walclPts[i].value - walclPts[i + 52].value);
    }
    const bsZ = zScoreOf(bsChangeSeries);
    const latestBsChange = bsChangeSeries[0] ?? 0;

    const bsArrow: "up" | "down" | "flat" =
      bsChangeSeries.length >= 2
        ? bsChangeSeries[0] > bsChangeSeries[1] * 1.02 ? "up"
        : bsChangeSeries[0] < bsChangeSeries[1] * 0.98 ? "down"
        : "flat"
        : "flat";

    // ── 3. Total Reserves at Fed (weight 0.20) ──────────────────────────
    const resPts = resRes.status === "fulfilled" ? parseObs(resRes.value) : [];
    const reserveLevels = resPts.map((p) => p.value);
    const resZ = zScoreOf(reserveLevels);
    const latestReserves = reserveLevels[0] ?? 0;

    const resArrow: "up" | "down" | "flat" =
      reserveLevels.length >= 2
        ? reserveLevels[0] > reserveLevels[1] * 1.01 ? "up"
        : reserveLevels[0] < reserveLevels[1] * 0.99 ? "down"
        : "flat"
        : "flat";

    // ── 4. Overnight Reverse Repo (weight 0.15, inverted) ────────────────
    // Higher RRP = Fed draining liquidity → negative FRLI contribution
    const rrpPts = rrpRes.status === "fulfilled" ? parseObs(rrpRes.value) : [];
    const rrpLevels = rrpPts.map((p) => p.value);
    const rrpRaw = zScoreOf(rrpLevels);
    const repoNetZ = -rrpRaw.z;   // invert: lower RRP = more liquidity
    const latestRrp = rrpLevels[0] ?? 0;

    const rrpArrow: "up" | "down" | "flat" =
      rrpLevels.length >= 2
        ? rrpLevels[0] < rrpLevels[1] * 0.98 ? "up"   // RRP falling → more liquidity → up arrow
        : rrpLevels[0] > rrpLevels[1] * 1.02 ? "down"  // RRP rising → draining → down arrow
        : "flat"
        : "flat";

    // ── FRLI Composite ───────────────────────────────────────────────────
    const frliComposite =
      W_M1M2     * m1m2Z.z +
      W_BALANCE  * bsZ.z   +
      W_RESERVES * resZ.z  +
      W_REPO     * repoNetZ;

    const level  = toFrliLevel(frliComposite);
    const regime = regimeName(level);
    const status = statusLabel(level);

    // ── Build FRLI metrics array ─────────────────────────────────────────
    const metrics: FrliMetric[] = [
      {
        label:  "M1/M2 YoY",
        raw:    Math.round(latestM1M2 * 100) / 100,
        zScore: Math.round(m1m2Z.z * 100) / 100,
        weight: W_M1M2,
        arrow:  m1m2Arrow,
        detail: `${latestM1M2 >= 0 ? "+" : ""}${latestM1M2.toFixed(1)}%`,
      },
      {
        label:  "Fed BS ΔYoY",
        raw:    Math.round(latestBsChange),
        zScore: Math.round(bsZ.z * 100) / 100,
        weight: W_BALANCE,
        arrow:  bsArrow,
        detail: `${latestBsChange >= 0 ? "+" : ""}${Math.abs(Math.round(latestBsChange))}`,
      },
      {
        label:  "Reserves",
        raw:    Math.round(latestReserves),
        zScore: Math.round(resZ.z * 100) / 100,
        weight: W_RESERVES,
        arrow:  resArrow,
        detail: `${Math.round(latestReserves)}`,
      },
      {
        label:  "Repo Net",
        raw:    Math.round(latestRrp),
        zScore: Math.round(repoNetZ * 100) / 100,
        weight: W_REPO,
        arrow:  rrpArrow,
        detail: `${Math.round(latestRrp)}`,
      },
    ];

    // ── Rates (display only) ─────────────────────────────────────────────
    const dffPts  = dffRes.status  === "fulfilled" ? parseObs(dffRes.value)  : [];
    const dgs2Pts = dgs2Res.status === "fulfilled" ? parseObs(dgs2Res.value) : [];
    const sofrPts = sofrRes.status === "fulfilled" ? parseObs(sofrRes.value) : [];

    const fedFunds = dffPts.length  > 0 ? dffPts[0].value  : null;
    const yield2y  = dgs2Pts.length > 0 ? dgs2Pts[0].value : null;
    const sofr     = sofrPts.length > 0 ? sofrPts[0].value : null;

    const sofrSpread = sofr !== null && fedFunds !== null ? sofr - fedFunds : null;
    const repoStress = sofrSpread !== null && sofrSpread > SOFR_SPREAD_THRESHOLD;

    // ── Forward signal (Polymarket, display only) ────────────────────────
    const polyData = polyRes.status === "fulfilled"
      ? polyRes.value
      : { rateCutProb: -1, recessionProb: -1 };

    // ── Respond ──────────────────────────────────────────────────────────
    const result: PrinterScoreResult = {
      frliLevel:  level,
      frliScore:  Math.round(frliComposite * 100) / 100,
      regime,
      status,
      metrics,
      balanceSheetYoY: Math.round(latestBsChange),
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
