import type { IncomingMessage, ServerResponse } from "node:http";

// ── M1 + M2 Money Supply API ───────────────────────────────────────────────
// Fetches M1 and M2 money supply for 6 major economies from FRED, converts
// to USD billions, and returns monthly changes plus ON/OFF printing status.
//
// IMPORTANT – unit scale:
//   All OECD MEI series (MABMM*) and the China MYAGM* series return raw
//   observations in INDIVIDUAL national currency units (not millions).
//   The localToBillions factor 1e-9 converts individual NCU → billions NCU.
//   US series (M1SL, M2SL) are already in billions USD, so factor = 1.
//
// Sources (all via FRED, free tier – API key kept server-side):
//   US  Fed  – M1: M1SL            (Billions USD, monthly, SA)
//              M2: M2SL            (Billions USD, monthly, SA)
//   EU  ECB  – M1: MABMM101EZM189S (individual EUR, monthly, SA) ← 1e-9
//              M2: MABMM301EZM189S (individual EUR, monthly, SA) ← 1e-9
//   UK  BOE  – M1: MABMM101GBM189S (individual GBP, monthly, SA) ← 1e-9
//              M2: MABMM301GBM189S (individual GBP, monthly, SA) ← 1e-9
//   JP  BOJ  – M1: MABMM101JPM189S (individual JPY, monthly, SA) ← 1e-9
//              M2: MABMM301JPM189S (individual JPY, monthly, SA) ← 1e-9
//   CA  BOC  – M1: MABMM101CAM189S (individual CAD, monthly, SA) ← 1e-9
//              M2: MABMM301CAM189S (individual CAD, monthly, SA) ← 1e-9
//   CN  PBOC – M1: MYAGM1CNM189N   (individual CNY, monthly, NSA) ← 1e-9
//              M2: MYAGM2CNM189N   (individual CNY, monthly, NSA) ← 1e-9
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
const OBS_LIMIT = 15;
// Number of daily FX observations to retrieve (take the most recent valid one)
const FX_LIMIT = 10;

// A country is considered "printing" when its most-recent monthly M2 growth
// exceeds this threshold (percentage, month-on-month).
const PRINT_THRESHOLD_PCT = 0.1;

interface CountryConfig {
  id:              string;
  name:            string;   // Short label (e.g. "Fed", "ECB")
  flag:            string;   // Emoji flag
  m1Series:        string;   // FRED series ID for M1
  m2Series:        string;   // FRED series ID for M2 / broad money
  localToBillions: number;   // multiply raw FRED value → billions of local currency
                             //   M1SL / M2SL (US): 1     (already billions USD)
                             //   MABMM* / MYAGM*:  1e-9  (individual NCU → billions)
  fxSeries:        string | null;  // FRED FX series (null → already USD)
  fxInverted:      boolean;  // true  → rate is LCU/USD (need 1/rate)
                             // false → rate is USD/LCU (multiply directly)
}

const COUNTRIES: readonly CountryConfig[] = [
  { id: "US", name: "Fed",  flag: "🇺🇸", m1Series: "M1SL",            m2Series: "M2SL",            localToBillions: 1,    fxSeries: null,      fxInverted: false },
  { id: "EU", name: "ECB",  flag: "🇪🇺", m1Series: "MABMM101EZM189S", m2Series: "MABMM301EZM189S", localToBillions: 1e-9, fxSeries: "DEXUSEU", fxInverted: false },
  { id: "UK", name: "BOE",  flag: "🇬🇧", m1Series: "MABMM101GBM189S", m2Series: "MABMM301GBM189S", localToBillions: 1e-9, fxSeries: "DEXUSUK", fxInverted: false },
  { id: "JP", name: "BOJ",  flag: "🇯🇵", m1Series: "MABMM101JPM189S", m2Series: "MABMM301JPM189S", localToBillions: 1e-9, fxSeries: "DEXJPUS", fxInverted: true  },
  { id: "CA", name: "BOC",  flag: "🇨🇦", m1Series: "MABMM101CAM189S", m2Series: "MABMM301CAM189S", localToBillions: 1e-9, fxSeries: "DEXCAUS", fxInverted: true  },
  { id: "CN", name: "PBOC", flag: "🇨🇳", m1Series: "MYAGM1CNM189N",   m2Series: "MYAGM2CNM189N",   localToBillions: 1e-9, fxSeries: "DEXCHUS", fxInverted: true  },
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
  id:               string;
  name:             string;
  flag:             string;
  error:            boolean;
  // M1
  m1USD?:           number | null;   // billions USD (most recent month)
  m1ChangeUSD?:     number | null;   // MoM absolute change in billions USD
  m1Date?:          string | null;   // ISO date of latest M1 observation
  // M2 / broad money
  m2USD?:           number | null;   // billions USD (most recent month)
  m2ChangeUSD?:     number | null;   // MoM absolute change in billions USD
  m2Date?:          string | null;   // ISO date of latest M2 observation
  printing?:        boolean;         // true = M2 grew ≥ PRINT_THRESHOLD_PCT last month
  // legacy fields kept for backward compatibility
  latestUSD?:       number;
  printedUSD?:      number | null;
  printedDate?:     string | null;
  lastPrintedDate?: string | null;
  lastPrintedUSD?:  number | null;
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

    // Fetch all M1, M2, and FX series in parallel
    const [m1Settled, m2Settled, fxSettled] = await Promise.all([
      Promise.allSettled(
        COUNTRIES.map((c) => fetchFredObs(c.m1Series, apiKey, OBS_LIMIT)),
      ),
      Promise.allSettled(
        COUNTRIES.map((c) => fetchFredObs(c.m2Series, apiKey, OBS_LIMIT)),
      ),
      Promise.allSettled(
        fxSeriesList.map((s) => fetchFredObs(s, apiKey, FX_LIMIT)),
      ),
    ]);

    // Build FX lookup: series_id → latest USD conversion rate
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

      // Determine USD conversion factor (same for M1 and M2 – same currency)
      let toUSD = 1;
      if (cfg.fxSeries !== null) {
        const rate = fxMap[cfg.fxSeries];
        if (rate === null || rate === undefined) {
          return { ...base, error: true };
        }
        toUSD = cfg.fxInverted ? 1 / rate : rate;
      }

      // Scale factor: raw FRED value → billions USD
      // Step 1: raw × localToBillions → billions of local currency
      // Step 2: × toUSD               → billions USD
      const scale = cfg.localToBillions * toUSD;

      // ── M1 ──────────────────────────────────────────────────────────────
      let m1USD:       number | null = null;
      let m1ChangeUSD: number | null = null;
      let m1Date:      string | null = null;

      const m1Result = m1Settled[i];
      if (m1Result.status === "fulfilled") {
        const valid = parseObs(m1Result.value);
        if (valid.length >= 2) {
          m1USD       = valid[0].value * scale;
          m1ChangeUSD = m1USD - valid[1].value * scale;
          m1Date      = valid[0].date;
        }
      }
      // M1 failure is non-fatal: country still shows with M1 = null

      // ── M2 ──────────────────────────────────────────────────────────────
      const m2Result = m2Settled[i];
      if (m2Result.status === "rejected") {
        return { ...base, error: true };
      }

      const validM2 = parseObs(m2Result.value);
      if (validM2.length < 2) {
        return { ...base, error: true };
      }

      // Convert M2 observations to USD billions (up to 13 most-recent)
      const pts = validM2.slice(0, 13).map((o) => ({
        date:     o.date,
        valueUSD: o.value * scale,
      }));

      const latestUSD  = pts[0].valueUSD;
      const prevMonUSD = pts[1].valueUSD;

      const momPct  = ((latestUSD - prevMonUSD) / prevMonUSD) * 100;
      const printing = momPct >= PRINT_THRESHOLD_PCT;

      const m2USD       = latestUSD;
      const m2ChangeUSD = latestUSD - prevMonUSD;
      const m2Date      = pts[0].date;

      // ── Legacy fields (kept for any existing consumers) ──────────────────
      let printedUSD:      number | null = null;
      let printedDate:     string | null = null;
      let lastPrintedDate: string | null = null;
      let lastPrintedUSD:  number | null = null;

      if (printing) {
        printedUSD  = m2ChangeUSD;
        printedDate = m2Date;
      } else {
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
        m1USD,
        m1ChangeUSD,
        m1Date,
        m2USD,
        m2ChangeUSD,
        m2Date,
        printing,
        latestUSD,
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

