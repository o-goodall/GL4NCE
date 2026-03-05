import type { IncomingMessage, ServerResponse } from "node:http";

// ── US "Printer Score" API ─────────────────────────────────────────────────
// Fetches four FRED indicators and computes a 0–100 composite score for the
// likelihood of aggressive US monetary expansion ("money printer on").
//
// Indicators and FRED series IDs:
//   Balance sheet growth (30%) – WALCL           Fed total assets, billions USD, weekly
//   M2 growth            (35%) – M2SL            US M2, billions USD, monthly
//   HY credit spread     (25%) – BAMLH0A0HYM2    ICE BofA US HY OAS, percentage, daily
//   Yield curve          (10%) – T10Y2Y           10Y minus 2Y spread, percentage, daily
//
// Regime thresholds (DEFCON scale):
//   0–30   Normal          (DEFCON 5)
//   30–45  Watch           (DEFCON 4)
//   45–60  Caution         (DEFCON 3)
//   60–75  Printer Warming (DEFCON 2)
//   75–100 Printer Brrrr   (DEFCON 1)

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

// Observations to retrieve per series (most-recent first)
const WALCL_LIMIT = 4;   // need 2 weeks to compute WoW growth
const M2_LIMIT    = 4;   // need 2 months
const OAS_LIMIT   = 5;   // take most recent valid obs
const CURVE_LIMIT = 5;

// ── Weights ────────────────────────────────────────────────────────────────
const W_BALANCE = 0.30;
const W_M2      = 0.35;
const W_SPREADS = 0.25;
const W_CURVE   = 0.10;

// ── Scoring calibration ────────────────────────────────────────────────────
// Each indicator is mapped to a 0–100 sub-score:

// Balance sheet: score = clamp(weeklyGrowthPct * 200, 0, 100)
//   0.5 % weekly growth (QE pace) → 100; 0 % or negative (QT) → 0
const BALANCE_SCALE = 200;

// M2: score = clamp(momPct * 143, 0, 100)
//   0.7 % month-on-month growth → 100; 0 % → 0
const M2_SCALE = 143;

// HY spreads: score = clamp((oas - 300) / 7, 0, 100)
//   300 bps (tight) → 0; 1 000 bps (crisis) → 100
const HY_BASELINE   = 300;   // bps — below this = calm
const HY_CRISIS     = 1_000; // bps — above this = full crisis

// Yield curve: score = clamp((-t10y2y + 0.5) * 40, 0, 100)
//   +0.5% (steep) → 0; −2.0% (deep inversion) → 100
const CURVE_FLAT   =  0.5;
const CURVE_CRISIS = -2.0;

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
  if (!res.ok) throw new Error(`FRED HTTP ${res.status} for ${series}`);
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

// ── Response types ─────────────────────────────────────────────────────────

export interface PrinterIndicator {
  label:    string;   // Short human label
  value:    number;   // Raw value (% for growth/spread/curve, billions for balance)
  score:    number;   // 0–100 sub-score contribution
  weight:   number;   // This indicator's weight in the composite
  elevated: boolean;  // true when sub-score ≥ 40
}

export interface PrinterScoreResult {
  score:      number;                 // 0–100 composite
  regime:     string;                 // "Normal" | "Watch" | "Caution" | "Printer Warming" | "Printer Brrrr"
  indicators: PrinterIndicator[];
  updatedAt:  string;                 // ISO timestamp
}

// ── Regime helper ──────────────────────────────────────────────────────────

function regime(score: number): string {
  if (score >= 75) return "Printer Brrrr";
  if (score >= 60) return "Printer Warming";
  if (score >= 45) return "Caution";
  if (score >= 30) return "Watch";
  return "Normal";
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
    res.end(JSON.stringify({ error: "FRED_API_KEY environment variable is not configured" }));
    return;
  }

  try {
    // Fetch all four series in parallel; tolerate individual failures
    const [walclRes, m2Res, hyRes, curveRes] = await Promise.allSettled([
      fetchFred("WALCL",          apiKey, WALCL_LIMIT),
      fetchFred("M2SL",           apiKey, M2_LIMIT),
      fetchFred("BAMLH0A0HYM2",   apiKey, OAS_LIMIT),
      fetchFred("T10Y2Y",         apiKey, CURVE_LIMIT),
    ]);

    // ── Balance sheet WoW growth ─────────────────────────────────────────
    let balanceScore = 0;
    let balanceValue = 0;

    if (walclRes.status === "fulfilled") {
      const pts = parseObs(walclRes.value);
      if (pts.length >= 2) {
        const latest = pts[0].value;
        const prev   = pts[1].value;
        balanceValue = ((latest - prev) / prev) * 100;
        balanceScore = clamp(balanceValue * BALANCE_SCALE, 0, 100);
      }
    }

    // ── M2 MoM growth ────────────────────────────────────────────────────
    let m2Score = 0;
    let m2Value = 0;

    if (m2Res.status === "fulfilled") {
      const pts = parseObs(m2Res.value);
      if (pts.length >= 2) {
        const latest = pts[0].value;
        const prev   = pts[1].value;
        m2Value = ((latest - prev) / prev) * 100;
        m2Score = clamp(m2Value * M2_SCALE, 0, 100);
      }
    }

    // ── HY credit spread ─────────────────────────────────────────────────
    let hyScore = 0;
    let hyValue = 0;

    if (hyRes.status === "fulfilled") {
      const pts = parseObs(hyRes.value);
      if (pts.length > 0) {
        // FRED BAMLH0A0HYM2 is in Percent (e.g. 3.50 = 3.50% = 350 bps).
        // Multiply by 100 to express in basis points for comparison against
        // the bps-denominated HY_BASELINE and HY_CRISIS thresholds.
        hyValue = pts[0].value * 100;
        hyScore = clamp((hyValue - HY_BASELINE) / (HY_CRISIS - HY_BASELINE) * 100, 0, 100);
      }
    }

    // ── Yield curve (T10Y2Y) ─────────────────────────────────────────────
    let curveScore = 0;
    let curveValue = 0;

    if (curveRes.status === "fulfilled") {
      const pts = parseObs(curveRes.value);
      if (pts.length > 0) {
        curveValue = pts[0].value;
        // Steep positive curve → 0; deep inversion → 100
        curveScore = clamp(
          (CURVE_FLAT - curveValue) / (CURVE_FLAT - CURVE_CRISIS) * 100,
          0,
          100,
        );
      }
    }

    // ── Composite score ───────────────────────────────────────────────────
    const composite = Math.round(
      balanceScore * W_BALANCE +
      m2Score      * W_M2      +
      hyScore      * W_SPREADS +
      curveScore   * W_CURVE,
    );

    const indicators: PrinterIndicator[] = [
      {
        label:    "Balance Sheet",
        value:    balanceValue,
        score:    Math.round(balanceScore),
        weight:   W_BALANCE,
        elevated: balanceScore >= 40,
      },
      {
        label:    "M2 Growth",
        value:    m2Value,
        score:    Math.round(m2Score),
        weight:   W_M2,
        elevated: m2Score >= 40,
      },
      {
        label:    "HY Spreads",
        value:    hyValue,
        score:    Math.round(hyScore),
        weight:   W_SPREADS,
        elevated: hyScore >= 40,
      },
      {
        label:    "Yield Curve",
        value:    curveValue,
        score:    Math.round(curveScore),
        weight:   W_CURVE,
        elevated: curveScore >= 40,
      },
    ];

    const result: PrinterScoreResult = {
      score:      composite,
      regime:     regime(composite),
      indicators,
      updatedAt:  new Date().toISOString(),
    };

    res.setHeader("Content-Type", "application/json");
    // Cache 6 hours — FRED weekly/monthly data does not change intraday
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=3600");
    res.end(JSON.stringify(result));
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
