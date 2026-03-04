import type { IncomingMessage, ServerResponse } from "node:http";

// ── M2 Money Supply API ────────────────────────────────────────────────────
// Fetches M2 money supply for 6 major economies from FRED, converts to USD,
// and returns 13 months of history for trend visualization.
//
// Sources (all via FRED, free tier – API key kept server-side):
//   US  Fed  – M2SL             (Billions USD, monthly, SA)
//   EU  ECB  – MABMM301EZM189S  (Billions EUR, monthly, SA)
//   UK  BOE  – MABMM301GBM189S  (Billions GBP, monthly, SA)
//   JP  BOJ  – MABMM301JPM189S  (Billions JPY, monthly, SA)
//   CA  BOC  – MABMM301CAM189S  (Billions CAD, monthly, SA)
//   CN  PBOC – MYAGM2CNM189N    (Billions CNY, monthly, NSA)
//
// FX conversion (FRED daily rates, most recent observation):
//   DEXUSEU – USD per EUR  (direct)
//   DEXUSUK – USD per GBP  (direct)
//   DEXJPUS – JPY per USD  (inverted: toUSD = 1/rate)
//   DEXCAUS – CAD per USD  (inverted)
//   DEXCHUS – CNY per USD  (inverted)

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

// Number of monthly observations to retrieve (15 gives the 13 valid points
// needed for the latest value + 12 prior months, with a 2-observation buffer
// for FRED's occasional "." placeholder entries)
const M2_LIMIT = 15;
// Number of daily FX observations to retrieve (take the most recent valid one)
const FX_LIMIT = 10;

// Alert thresholds
const MOM_ALERT_PCT = 1.0;   // Month-on-month growth > 1 %  → alert
const YOY_ALERT_PCT = 8.0;   // Year-on-year  growth > 8 %  → alert

interface CountryConfig {
  id:         string;
  name:       string;   // Short label (e.g. "Fed", "ECB")
  flag:       string;   // Emoji flag
  m2Series:   string;   // FRED series ID for M2
  fxSeries:   string | null;  // FRED FX series (null → already USD)
  fxInverted: boolean;  // true  → rate is LCU/USD (need 1/rate)
                        // false → rate is USD/LCU (multiply directly)
}

const COUNTRIES: readonly CountryConfig[] = [
  { id: "US", name: "Fed",  flag: "🇺🇸", m2Series: "M2SL",            fxSeries: null,      fxInverted: false },
  { id: "EU", name: "ECB",  flag: "🇪🇺", m2Series: "MABMM301EZM189S", fxSeries: "DEXUSEU", fxInverted: false },
  { id: "UK", name: "BOE",  flag: "🇬🇧", m2Series: "MABMM301GBM189S", fxSeries: "DEXUSUK", fxInverted: false },
  { id: "JP", name: "BOJ",  flag: "🇯🇵", m2Series: "MABMM301JPM189S", fxSeries: "DEXJPUS", fxInverted: true  },
  { id: "CA", name: "BOC",  flag: "🇨🇦", m2Series: "MABMM301CAM189S", fxSeries: "DEXCAUS", fxInverted: true  },
  { id: "CN", name: "PBOC", flag: "🇨🇳", m2Series: "MYAGM2CNM189N",   fxSeries: "DEXCHUS", fxInverted: true  },
];

// ── FRED helpers ──────────────────────────────────────────────────────────────

interface FredObs { date: string; value: string }

async function fetchFredObs(
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
  if (!res.ok) throw new Error(`FRED HTTP ${res.status} for series ${series}`);
  const body = (await res.json()) as { observations?: FredObs[] };
  return body.observations ?? [];
}

function parseObs(obs: FredObs[]): { date: string; value: number }[] {
  return obs
    .map((o) => ({ date: o.date, value: parseFloat(o.value) }))
    .filter((o) => !isNaN(o.value) && o.value > 0);
}

// ── Response types ────────────────────────────────────────────────────────────

export interface M2CountryResult {
  id:         string;
  name:       string;
  flag:       string;
  error:      boolean;
  latestUSD?: number;                               // billions USD
  momPct?:    number | null;                        // month-on-month %
  yoyPct?:    number | null;                        // year-on-year %
  alert?:     boolean;                              // significant increase flag
  history?:   { date: string; valueUSD: number }[]; // oldest→newest, ≤13 pts
}

// ── Handler ───────────────────────────────────────────────────────────────────

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
    // Deduplicate the FX series list
    const fxSeriesList = [
      ...new Set(
        COUNTRIES.map((c) => c.fxSeries).filter((s): s is string => s !== null),
      ),
    ];

    // Fetch all M2 series and all FX series in parallel
    const [m2Settled, fxSettled] = await Promise.all([
      Promise.allSettled(
        COUNTRIES.map((c) => fetchFredObs(c.m2Series, apiKey, M2_LIMIT)),
      ),
      Promise.allSettled(
        fxSeriesList.map((s) => fetchFredObs(s, apiKey, FX_LIMIT)),
      ),
    ]);

    // Build FX lookup: series_id → latest USD rate
    const fxMap: Record<string, number | null> = {};
    fxSeriesList.forEach((series, i) => {
      const result = fxSettled[i];
      if (result.status === "fulfilled") {
        const valid = parseObs(result.value);
        fxMap[series] = valid.length > 0 ? valid[0].value : null;
      } else {
        fxMap[series] = null;
      }
    });

    // Build per-country results
    const countries: M2CountryResult[] = COUNTRIES.map((cfg, i) => {
      const base = { id: cfg.id, name: cfg.name, flag: cfg.flag };

      const m2Result = m2Settled[i];
      if (m2Result.status === "rejected") {
        return { ...base, error: true };
      }

      const validObs = parseObs(m2Result.value);
      if (validObs.length < 2) {
        return { ...base, error: true };
      }

      // Determine USD conversion factor
      let toUSD = 1;
      if (cfg.fxSeries !== null) {
        const rate = fxMap[cfg.fxSeries];
        if (rate === null || rate === undefined) {
          return { ...base, error: true };
        }
        toUSD = cfg.fxInverted ? 1 / rate : rate;
      }

      // Convert M2 observations to USD (billions → keep as billions USD)
      // Sort: take up to 13 valid obs (most recent first), then reverse for chart
      const pts = validObs.slice(0, 13).map((o) => ({
        date:     o.date,
        valueUSD: o.value * toUSD,
      }));

      const latest   = pts[0].valueUSD;
      const prevMon  = pts[1]?.valueUSD ?? null;
      const prevYear = pts[12]?.valueUSD ?? null;

      const momPct = prevMon  !== null ? ((latest - prevMon)  / prevMon)  * 100 : null;
      const yoyPct = prevYear !== null ? ((latest - prevYear) / prevYear) * 100 : null;

      const alert =
        (momPct !== null && momPct > MOM_ALERT_PCT) ||
        (yoyPct !== null && yoyPct > YOY_ALERT_PCT);

      return {
        ...base,
        error:     false,
        latestUSD: latest,
        momPct,
        yoyPct,
        alert,
        history:   [...pts].reverse(), // oldest first for sparkline
      };
    });

    res.setHeader("Content-Type", "application/json");
    // Cache for 6 hours; M2 data is published monthly with ~2 week lag
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=3600");
    res.end(JSON.stringify({ countries }));
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
