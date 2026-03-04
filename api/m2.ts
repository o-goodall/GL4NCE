import type { IncomingMessage, ServerResponse } from "node:http";

// ── M2 Money Supply API ────────────────────────────────────────────────────
// Fetches M2 money supply for 6 major economies from FRED, converts to USD,
// and returns ON/OFF printing status with amounts for each country.
//
// Sources (all via FRED, free tier – API key kept server-side):
//   US  Fed  – M2SL             (Billions USD, monthly, SA)
//   EU  ECB  – MABMM301EZM189S  (Millions EUR, monthly, SA)  ← OECD series: millions NCU
//   UK  BOE  – MABMM301GBM189S  (Millions GBP, monthly, SA)  ← OECD series: millions NCU
//   JP  BOJ  – MABMM301JPM189S  (Millions JPY, monthly, SA)  ← OECD series: millions NCU
//   CA  BOC  – MABMM301CAM189S  (Millions CAD, monthly, SA)  ← OECD series: millions NCU
//   CN  PBOC – MYAGM2CNM189N    (Millions CNY, monthly, NSA) ← millions NCU
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

// A country is considered "printing" when its most-recent monthly M2 growth
// exceeds this threshold (percentage, month-on-month).
const PRINT_THRESHOLD_PCT = 0.1;

interface CountryConfig {
  id:             string;
  name:           string;   // Short label (e.g. "Fed", "ECB")
  flag:           string;   // Emoji flag
  m2Series:       string;   // FRED series ID for M2
  localToBillions: number;  // multiply raw FRED value → billions of local currency
                            //   M2SL: 1 (already billions USD)
                            //   MABMM301* / MYAGM2CNM189N: 0.001 (millions → billions)
  fxSeries:       string | null;  // FRED FX series (null → already USD)
  fxInverted:     boolean;  // true  → rate is LCU/USD (need 1/rate)
                            // false → rate is USD/LCU (multiply directly)
}

const COUNTRIES: readonly CountryConfig[] = [
  { id: "US", name: "Fed",  flag: "🇺🇸", m2Series: "M2SL",            localToBillions: 1,     fxSeries: null,      fxInverted: false },
  { id: "EU", name: "ECB",  flag: "🇪🇺", m2Series: "MABMM301EZM189S", localToBillions: 0.001, fxSeries: "DEXUSEU", fxInverted: false },
  { id: "UK", name: "BOE",  flag: "🇬🇧", m2Series: "MABMM301GBM189S", localToBillions: 0.001, fxSeries: "DEXUSUK", fxInverted: false },
  { id: "JP", name: "BOJ",  flag: "🇯🇵", m2Series: "MABMM301JPM189S", localToBillions: 0.001, fxSeries: "DEXJPUS", fxInverted: true  },
  { id: "CA", name: "BOC",  flag: "🇨🇦", m2Series: "MABMM301CAM189S", localToBillions: 0.001, fxSeries: "DEXCAUS", fxInverted: true  },
  { id: "CN", name: "PBOC", flag: "🇨🇳", m2Series: "MYAGM2CNM189N",   localToBillions: 0.001, fxSeries: "DEXCHUS", fxInverted: true  },
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
  id:                string;
  name:              string;
  flag:              string;
  error:             boolean;
  latestUSD?:        number;        // billions USD (most recent month)
  printing?:         boolean;       // true = M2 grew ≥ PRINT_THRESHOLD_PCT last month
  // When printing === true:
  printedUSD?:       number | null; // absolute increase in billions USD this month
  printedDate?:      string | null; // ISO date (YYYY-MM-DD) of latest observation
  // When printing === false:
  lastPrintedDate?:  string | null; // ISO date of the most recent positive-growth month
  lastPrintedUSD?:   number | null; // absolute increase in billions USD of that month
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

      // Convert observations to USD billions (take up to 13, most-recent first)
      // Step 1: raw FRED value × localToBillions → billions of local currency
      // Step 2: × toUSD → billions USD
      const pts = validObs.slice(0, 13).map((o) => ({
        date:     o.date,
        valueUSD: o.value * cfg.localToBillions * toUSD,
      }));

      const latestUSD  = pts[0].valueUSD;
      const prevMonUSD = pts[1]?.valueUSD ?? null;

      const momPct = prevMonUSD !== null
        ? ((latestUSD - prevMonUSD) / prevMonUSD) * 100
        : null;

      const printing = momPct !== null && momPct >= PRINT_THRESHOLD_PCT;

      let printedUSD:      number | null = null;
      let printedDate:     string | null = null;
      let lastPrintedDate: string | null = null;
      let lastPrintedUSD:  number | null = null;

      if (printing && prevMonUSD !== null) {
        // Printer is ON — report the current month's increase
        printedUSD  = latestUSD - prevMonUSD;
        printedDate = pts[0].date;
      } else {
        // Printer is OFF — scan back to find the most recent printing month
        for (let j = 1; j < pts.length - 1; j++) {
          const v     = pts[j].valueUSD;
          const vPrev = pts[j + 1].valueUSD;
          const pct   = ((v - vPrev) / vPrev) * 100;
          if (pct >= PRINT_THRESHOLD_PCT) {
            lastPrintedDate = pts[j].date;
            lastPrintedUSD  = v - vPrev;
            break;
          }
        }
      }

      return {
        ...base,
        error: false,
        latestUSD,
        printing,
        printedUSD,
        printedDate,
        lastPrintedDate,
        lastPrintedUSD,
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

