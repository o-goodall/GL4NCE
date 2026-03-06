import type { IncomingMessage, ServerResponse } from "node:http";

// ── M1 + M2 Money Supply API ───────────────────────────────────────────────
// Fetches M1 and M2 money supply for 6 major economies, converts to USD
// billions, and returns monthly changes plus ON/OFF printing status.
//
// M1 sources (primary = FRED, fallback = OECD SDMX for EU/UK/JP/CA):
//   US  Fed  – FRED M1SL                (billions USD, monthly, SA)
//   EU  ECB  – FRED MANMM101EZM189S     (individual EUR, monthly, SA) ← 1e-9
//   UK  BOE  – FRED MANMM101GBM189S     (individual GBP, monthly, SA) ← 1e-9
//   JP  BOJ  – FRED MANMM101JPM189S     (individual JPY, monthly, SA) ← 1e-9
//   CA  BOC  – FRED MANMM101CAM189S     (individual CAD, monthly, SA) ← 1e-9
//   CN  PBOC – FRED MYAGM1CNM189N       (individual CNY, monthly, NSA) ← 1e-9
//   OECD fallback for EU/UK/JP/CA if FRED returns no data:
//     MABMM101 series via sdmx.oecd.org; free, no API key.
//     OECD country codes: EA (Euro area), GBR, JPN, CAN.
//     OECD MEI returns millions of national currency; multiply by 0.001 → billions.
//
// M2 / broad money sources (primary = FRED, fallback = OECD SDMX for EU/UK/JP/CA):
//   US  Fed  – FRED M2SL             (billions USD, monthly, SA)
//   EU  ECB  – FRED MABMM301EZM189S  (individual EUR, monthly, SA) ← 1e-9
//   UK  BOE  – FRED MABMM301GBM189S  (individual GBP, monthly, SA) ← 1e-9
//   JP  BOJ  – FRED MABMM301JPM189S  (individual JPY, monthly, SA) ← 1e-9
//   CA  BOC  – FRED MABMM301CAM189S  (individual CAD, monthly, SA) ← 1e-9
//   CN  PBOC – FRED MYAGM2CNM189N    (individual CNY, monthly, NSA) ← 1e-9
//   OECD fallback for EU/UK/JP/CA if FRED returns no data:
//     MABMM301 series via sdmx.oecd.org; free, no API key.
//     OECD country codes: EA (Euro area), GBR, JPN, CAN.
//     OECD MEI returns millions of national currency; multiply by 0.001 → billions.
//
// FX conversion (FRED daily rates, most recent observation):
//   DEXUSEU – USD per EUR  (direct)
//   DEXUSUK – USD per GBP  (direct)
//   DEXJPUS – JPY per USD  (inverted: toUSD = 1/rate)
//   DEXCAUS – CAD per USD  (inverted)
//   DEXCHUS – CNY per USD  (inverted)
//
// Gross debt / GDP data:
//   Debt-to-GDP  – FRED GGGDTA*188N (IMF WEO annual, % of GDP)
//   Nominal GDP  – World Bank API NY.GDP.MKTP.CD (free, no key, actual USD → /1e9 = billions)
//   Gross debt   – derived: (debtToGDP / 100) × gdpUSD

const FRED_BASE       = "https://api.stlouisfed.org/fred/series/observations";
const OECD_BASE       = "https://sdmx.oecd.org/public/rest/data";
// World Bank Indicators API (free, no key required) for nominal GDP in current USD.
// Used to derive gross national debt: grossDebtUSD = (debtToGDP / 100) * gdpUSD.
// Reference: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
const WORLDBANK_BASE  = "https://api.worldbank.org/v2";

// Number of monthly observations to retrieve (15 gives the 13 valid points
// needed for the latest value + 12 prior months, with a 2-observation buffer
// for FRED's occasional "." placeholder entries)
const OBS_LIMIT = 15;
// Number of daily FX observations to retrieve (take the most recent valid one)
const FX_LIMIT = 10;

// ── Per-bank Printer Score ────────────────────────────────────────────────────
// Weighted composite (0–100) derived from M1 and M2 month-on-month growth.
//
// Sub-score mapping (same scale used by api/printer.ts for US M2):
//   sub = clamp(momPct × MONEY_GROWTH_SCALE, 0, 100)
//   0.7 % MoM growth → sub = 100  (annualised ≈ 8.4 %)
//   0 % → 0;  negative growth → 0 (clamped)
//
// Composite weights (renormalized to sum to 1.0 when both signals available):
//   M1 available:  score = round((m1Sub × 3 + m2Sub × 4) / 7)
//                  [M1 ≈ 42.9 %, M2 ≈ 57.1 % — original intent M1:M2 = 30:40]
//   M1 unavailable: score = round(m2Sub)                         [M2 at 100 %]
//
// Score → regime:
//    0–29  → "Normal"
//   30–59  → "Warming"
//   60–79  → "Alert"
//   80–100 → "Crisis"
const MONEY_GROWTH_SCALE = 143;

// Scale factor for OECD SDMX monetary data: OECD MEI_FIN publishes both narrow
// money (MABMM101 / M1) and broad money (MABMM301 / M2) in millions of national
// currency.  Multiply by 0.001 to convert to billions of national currency.
// Used when falling back to OECD after a FRED fetch returns no valid observations.
const OECD_MILLIONS_TO_BILLIONS = 0.001;

// Minimum M2 MoM growth rate (%) to record a historical "printed" episode in
// the legacy printedUSD / lastPrintedDate fields.  Kept separate from the
// score threshold so historical lookback is not affected by the scoring change.
const PRINT_THRESHOLD_PCT = 0.1;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Compute a 0–100 Printer Score for a single central bank using M1 and M2
 * month-on-month growth rates (expressed as percentages, e.g. 0.7 for 0.7 %).
 * When M1 data is unavailable (null), the score is derived from M2 alone.
 */
function computeBankPrinterScore(
  m1MomPct: number | null,
  m2MomPct: number,
): number {
  const m2Sub = clamp(m2MomPct * MONEY_GROWTH_SCALE, 0, 100);
  if (m1MomPct !== null) {
    const m1Sub = clamp(m1MomPct * MONEY_GROWTH_SCALE, 0, 100);
    // Weights: original intent M1 = 30 %, M2 = 40 %; renormalized 3 : 4 ratio
    // so they sum to 1.0 when no balance-sheet data is available.
    // M1 effective weight = 3/7 ≈ 42.9 %; M2 effective weight = 4/7 ≈ 57.1 %.
    return Math.round((m1Sub * 3 + m2Sub * 4) / 7);
  }
  return Math.round(m2Sub);
}

function bankScoreRegime(score: number): string {
  if (score >= 80) return "Crisis";
  if (score >= 60) return "Alert";
  if (score >= 30) return "Warming";
  return "Normal";
}

interface CountryConfig {
  id:               string;
  name:             string;    // Short label (e.g. "Fed", "ECB")
  flag:             string;    // Emoji flag
  // ── M1 (narrow money) ───────────────────────────────────────────────────
  m1Series:         string | null;  // FRED series ID; null = use OECD
  m1OecdCode:       string | null;  // OECD country code; null = use FRED
  m1LocalToBillions: number;        // raw value → billions of local currency
                                    //   M1SL (US):    1     (already billions USD)
                                    //   OECD MEI M1:  0.001 (millions NCU → billions)
                                    //   MYAGM1CN:     1e-9  (individual CNY → billions)
  // ── M2 / broad money ────────────────────────────────────────────────────
  m2Series:         string;         // FRED series ID for M2 (primary)
  m2OecdCode:       string | null;  // OECD country code for M2 fallback; null = no fallback
  localToBillions:  number;         // raw FRED value → billions of local currency
                                    //   M2SL:    1     (already billions USD)
                                    //   MABMM301*: 1e-9 (individual NCU → billions)
                                    //   MYAGM2CN:  1e-9  (individual CNY → billions)
  // ── FX conversion (FRED daily rates) ────────────────────────────────────
  fxSeries:         string | null;  // null → already USD
  fxInverted:       boolean;        // true = LCU/USD (invert); false = USD/LCU
  // ── Debt-to-GDP (FRED GGGDTA*188N series, sourced from IMF WEO) ──────────
  // Annual, % of GDP.  Uses the confirmed-working FRED API key (same as M1/M2).
  // Series IDs follow the pattern GGGDTA{country}A188N.
  debtSeries:       string;         // FRED series ID for general govt gross debt
}

const COUNTRIES: readonly CountryConfig[] = [
  // US: M1 and M2 both from FRED; already in billions USD
  { id: "US", name: "Fed",  flag: "🇺🇸",
    m1Series: "M1SL",              m1OecdCode: null,  m1LocalToBillions: 1,
    m2Series: "M2SL",              m2OecdCode: null,  localToBillions: 1,
    fxSeries: null,                fxInverted: false,
    debtSeries: "GGGDTAUSA188N" },
  // EU: M1 from FRED (MANMM101EZM189S, individual EUR) with OECD fallback;
  //     M2 from FRED (MABMM301EZM189S, individual EUR) with OECD fallback (EA)
  { id: "EU", name: "ECB",  flag: "🇪🇺",
    m1Series: "MANMM101EZM189S",   m1OecdCode: "EA",  m1LocalToBillions: 1e-9,
    m2Series: "MABMM301EZM189S",   m2OecdCode: "EA",  localToBillions: 1e-9,
    fxSeries: "DEXUSEU",           fxInverted: false,
    debtSeries: "GGGDTAEZA188N" },
  // UK: M1 from FRED (MANMM101GBM189S, individual GBP) with OECD fallback;
  //     M2 from FRED (MABMM301GBM189S, individual GBP) with OECD fallback (GBR)
  { id: "UK", name: "BOE",  flag: "🇬🇧",
    m1Series: "MANMM101GBM189S",   m1OecdCode: "GBR", m1LocalToBillions: 1e-9,
    m2Series: "MABMM301GBM189S",   m2OecdCode: "GBR", localToBillions: 1e-9,
    fxSeries: "DEXUSUK",           fxInverted: false,
    debtSeries: "GGGDTAGBA188N" },
  // JP: M1 from FRED (MANMM101JPM189S, individual JPY) with OECD fallback;
  //     M2 from FRED (MABMM301JPM189S, individual JPY) with OECD fallback (JPN)
  { id: "JP", name: "BOJ",  flag: "🇯🇵",
    m1Series: "MANMM101JPM189S",   m1OecdCode: "JPN", m1LocalToBillions: 1e-9,
    m2Series: "MABMM301JPM189S",   m2OecdCode: "JPN", localToBillions: 1e-9,
    fxSeries: "DEXJPUS",           fxInverted: true,
    debtSeries: "GGGDTAJPA188N" },
  // CA: M1 from FRED (MANMM101CAM189S, individual CAD) with OECD fallback;
  //     M2 from FRED (MABMM301CAM189S, individual CAD) with OECD fallback (CAN)
  { id: "CA", name: "BOC",  flag: "🇨🇦",
    m1Series: "MANMM101CAM189S",   m1OecdCode: "CAN", m1LocalToBillions: 1e-9,
    m2Series: "MABMM301CAM189S",   m2OecdCode: "CAN", localToBillions: 1e-9,
    fxSeries: "DEXCAUS",           fxInverted: true,
    debtSeries: "GGGDTACAA188N" },
  // CN: M1 and M2 both from FRED (individual CNY); no OECD fallback (China not in OECD)
  { id: "CN", name: "PBOC", flag: "🇨🇳",
    m1Series: "MYAGM1CNM189N",     m1OecdCode: null,  m1LocalToBillions: 1e-9,
    m2Series: "MYAGM2CNM189N",     m2OecdCode: null,  localToBillions: 1e-9,
    fxSeries: "DEXCHUS",           fxInverted: true,
    debtSeries: "GGGDTACNA188N" },
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

// ── OECD SDMX helpers (for M1 narrow money and M2 broad money fallbacks) ─────
//
// The OECD SDMX REST API (sdmx.oecd.org) is free and requires no API key.
// It is used as a fallback source for EU/UK/JP/CA M1 and M2 when the primary
// FRED MANMM101* / MABMM301* series return no valid observations.
//
// OECD MEI_FIN monetary data is published in MILLIONS of national currency,
// so the fallback scale factor is OECD_MILLIONS_TO_BILLIONS = 0.001.
//
// OECD country codes used: EA (Euro area), GBR (UK), JPN (Japan), CAN (Canada).

// Minimal SDMX-JSON 1.0 types for the fields we parse.
// The OECD SDMX REST API returns SDMX-JSON 1.0; the Accept header below
// requests this version explicitly.  If OECD ever upgrades to a newer version
// the Accept header may need updating (structure changes are handled gracefully:
// missing dimensions cause parseOecdSdmx to return an empty Map, showing "—").
interface OecdDimValue  { id: string }
interface OecdDimension { id: string; values: OecdDimValue[] }
interface OecdSeriesObs {
  observations: Record<string, [number, ...unknown[]]>;
}
interface OecdDataSet {
  series: Record<string, OecdSeriesObs>;
}
interface OecdSdmxBody {
  dataSets:  OecdDataSet[];
  structure: {
    dimensions: {
      series:      OecdDimension[];
      observation: OecdDimension[];
    };
  };
}

type OecdObsMap = Map<string, { date: string; value: number }[]>;

function parseOecdSdmx(body: OecdSdmxBody): OecdObsMap {
  const result = new Map<string, { date: string; value: number }[]>();
  if (!body.dataSets?.length || !body.structure?.dimensions) return result;

  const seriesDims  = body.structure.dimensions.series ?? [];
  const obsDims     = body.structure.dimensions.observation ?? [];

  const locDimIdx   = seriesDims.findIndex((d) => d.id === "LOCATION");
  const timeDim     = obsDims.find((d) => d.id === "TIME_PERIOD");
  if (locDimIdx === -1 || !timeDim) return result;

  const locations   = seriesDims[locDimIdx].values;
  const timePeriods = timeDim.values;

  // SDMX series key format: "{indicatorIdx}:{locationIdx}:{frequencyIdx}"
  // e.g. "0:1:0" → MABMM101 (index 0) · GBR (index 1) · M (index 0)
  for (const [seriesKey, seriesData] of Object.entries(body.dataSets[0].series ?? {})) {
    const parts   = seriesKey.split(":").map(Number);
    const locCode = locations[parts[locDimIdx]]?.id;
    if (!locCode) continue;

    const obs: { date: string; value: number }[] = [];
    for (const [obsIdxStr, obsArr] of Object.entries(seriesData.observations ?? {})) {
      const timeIdx = parseInt(obsIdxStr, 10);
      const date    = timePeriods[timeIdx]?.id;
      const value   = obsArr[0];
      if (!date || typeof value !== "number" || !isFinite(value) || value <= 0) continue;
      // value <= 0 guard: OECD occasionally emits 0 or negative sentinels for
      // confidential/revised data; these should not be treated as valid M1 figures.
      obs.push({ date, value });
    }
    // OECD returns observations in ascending time order; sort newest-first
    obs.sort((a, b) => b.date.localeCompare(a.date));
    result.set(locCode, obs);
  }
  return result;
}

// Generic OECD MEI_FIN fetcher used for both narrow money (MABMM101 / M1) and
// broad money (MABMM301 / M2).  The `indicator` argument is the OECD series
// code, e.g. "MABMM101" or "MABMM301".  The `label` is used only in error
// messages to distinguish M1 and M2 failures in logs.
async function fetchOecdMoney(
  indicator: string,
  oecdCodes: string[],
  label: string,
): Promise<OecdObsMap> {
  if (oecdCodes.length === 0) return new Map();
  // SDMX dataflow key: {indicator} · countries joined with "+" · M (monthly)
  const key = `${indicator}.${oecdCodes.join("+")}.M`;
  const url =
    `${OECD_BASE}/OECD,MEI_FIN,1.0/${encodeURIComponent(key)}` +
    `?lastNObservations=${OBS_LIMIT}&format=jsondata`;

  const res = await fetch(url, {
    headers: { Accept: "application/vnd.sdmx.data+json;version=1.0, application/json" },
  });
  if (!res.ok) throw new Error(`OECD HTTP ${res.status} for ${label}`);
  return parseOecdSdmx((await res.json()) as OecdSdmxBody);
}

// ── World Bank Indicators helpers (for nominal GDP in current USD) ────────────
//
// The World Bank Indicators API (api.worldbank.org/v2) is free, requires no
// API key, and provides GDP at current market prices in actual US$.  Values
// must be divided by 1e9 to obtain billions of USD used in the gross debt
// derivation: grossDebtUSD = (debtToGDP / 100) * gdpUSD.
//
// World Bank country / region codes used:
//   US  = United States · EMU = Economic and Monetary Union (Euro area)
//   GB  = United Kingdom · JP  = Japan · CA = Canada · CN = China
// Indicator: NY.GDP.MKTP.CD (GDP at current market prices, current US$)

// Map from our country IDs to World Bank API country codes
const WB_GDP_CODES: Record<string, string> = {
  US: "US",
  EU: "EMU",   // Economic and Monetary Union aggregate (Euro area)
  UK: "GB",
  JP: "JP",
  CA: "CA",
  CN: "CN",
};

interface WbGdpEntry {
  country:         { id: string; value: string };
  countryiso3code: string;   // ISO alpha-3 or aggregate code (e.g. "EMU"); matches query code for aggregates
  date:            string;
  value:           number | null;
}

// Returns a map of our country IDs to the most recent annual nominal GDP
// (USD billions).  Throws on network / HTTP errors so callers can .catch().
async function fetchWorldBankNominalGdp(): Promise<Record<string, number | null>> {
  // Semicolon-separated multi-country World Bank path; mrv=3 fetches the 3 most
  // recent annual observations per country so a one-year lag in the data doesn't
  // result in a null GDP.  per_page covers all expected rows plus a buffer.
  const codes = Object.values(WB_GDP_CODES).join(";");
  const perPage = Object.keys(WB_GDP_CODES).length * 3 + 2;
  const url =
    `${WORLDBANK_BASE}/country/${codes}/indicator/NY.GDP.MKTP.CD` +
    `?format=json&mrv=3&per_page=${perPage}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank HTTP ${res.status}`);

  const body = (await res.json()) as [unknown, WbGdpEntry[] | null];
  const rows = body[1];
  if (!Array.isArray(rows)) throw new Error("World Bank response missing data array");

  const result: Record<string, number | null> = {};
  for (const [countryId, wbCode] of Object.entries(WB_GDP_CODES)) {
    // Filter to this country's rows, sort newest-first, take first non-null value.
    // Check both country.id (used for standard ISO-2 countries) and countryiso3code
    // (used for aggregates like "EMU" where country.id may differ from the query code).
    const countryRows = rows
      .filter(r => r.country?.id === wbCode || r.countryiso3code === wbCode)
      .sort((a, b) => parseInt(b.date) - parseInt(a.date));

    let gdp: number | null = null;
    for (const row of countryRows) {
      if (typeof row.value === "number" && isFinite(row.value) && row.value > 0) {
        gdp = row.value / 1e9; // World Bank returns actual USD; convert to billions
        break;
      }
    }
    result[countryId] = gdp;
  }
  return result;
}

// ── Eurostat REST API helpers (for Euro Area government debt as % of GDP) ─────
//
// Eurostat gov_10dd_edpt1 (Excessive Deficit Procedure – Government Debt) is
// the official source for Euro Area general government consolidated gross debt
// as a percentage of GDP (Maastricht criterion).  It is used as a fallback for
// the EU/ECB row when the FRED series GGGDTAEZA188N is unavailable.
//
// Eurostat API reference:
//   https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/
//   gov_10dd_edpt1?format=JSON&geo=EA&unit=PC_GDP&sector=S13&na_item=GD
//
// Response format: JSON-stat (value dictionary keyed by string index, plus
//   dimension objects keyed by dimension name with category.index mappings).

interface EurostatJsonStat {
  value:     Record<string, number | null>;
  dimension: {
    time?: { category: { index: Record<string, number> } };
    // other dimensions not needed
  };
}

// Returns the most recent Euro Area general government gross debt, % of GDP.
// Throws on network / HTTP errors so callers can .catch().
async function fetchEurostatEuroAreaDebt(): Promise<number | null> {
  const url =
    "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/gov_10dd_edpt1" +
    "?format=JSON&geo=EA&unit=PC_GDP&sector=S13&na_item=GD&lang=en";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Eurostat HTTP ${res.status}`);

  const body = (await res.json()) as EurostatJsonStat;
  const timeIndex = body.dimension?.time?.category?.index;
  if (!timeIndex || !body.value) return null;

  // Sort years descending; pick the first non-null positive value.
  const years = Object.keys(timeIndex).sort().reverse();
  for (const yr of years) {
    const val = body.value[String(timeIndex[yr])];
    if (typeof val === "number" && isFinite(val) && val > 0) return val;
  }
  return null;
}

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
  // Debt-to-GDP (FRED GGGDTA*188N series from IMF WEO – annual)
  debtToGDP?:       number | null;   // General government gross debt, % of GDP
  // Gross National Debt in current USD (annual, derived: debtToGDP% × nominal GDP)
  // Source: World Bank NY.GDP.MKTP.CD (nominal GDP, actual USD → /1e9 = billions)
  grossDebtUSD?:    number | null;   // billions USD
  // Per-bank Printer Score
  printerScore?:    number;          // 0–100 composite (M1 30%, M2 40%, renorm.)
  scoreRegime?:     string;          // "Normal" | "Warming" | "Alert" | "Crisis"
  printing?:        boolean;         // true when printerScore ≥ 30 (Warming+)
  m1DataMissing?:   boolean;         // true when M1 was expected but not available
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

    // Collect OECD codes needed for M1 (EU/UK/JP/CA)
    const oecdM1Codes = COUNTRIES
      .map((c) => c.m1OecdCode)
      .filter((code): code is string => code !== null);

    // Collect OECD codes needed for M2 fallback (EU/UK/JP/CA — same set as M1)
    const oecdM2Codes = COUNTRIES
      .map((c) => c.m2OecdCode)
      .filter((code): code is string => code !== null);

    // Fetch M1 from FRED (US + CN), M2 from FRED (all 6), FX from FRED,
    // M1 from OECD (EU/UK/JP/CA), M2 from OECD (EU/UK/JP/CA, fallback),
    // debt-to-GDP from FRED (all 6), nominal GDP from World Bank (all 6),
    // and Euro Area debt from Eurostat – all in parallel.
    // grossDebtUSD is derived server-side: (debtToGDP / 100) * gdpUSD.
    // For countries that use OECD M1, pass an empty resolved promise as FRED
    // placeholder so the settled array stays index-aligned with COUNTRIES.
    const [fredM1Settled, m2Settled, fxSettled, oecdM1Map, oecdM2Map, debtSettled, gdpMap, euroAreaDebt] = await Promise.all([
      Promise.allSettled(
        COUNTRIES.map((c) =>
          c.m1Series ? fetchFredObs(c.m1Series, apiKey, OBS_LIMIT) : Promise.resolve([]),
        ),
      ),
      Promise.allSettled(
        COUNTRIES.map((c) => fetchFredObs(c.m2Series, apiKey, OBS_LIMIT)),
      ),
      Promise.allSettled(
        fxSeriesList.map((s) => fetchFredObs(s, apiKey, FX_LIMIT)),
      ),
      fetchOecdMoney("MABMM101", oecdM1Codes, "M1")
        // OECD M1 failure is intentionally non-fatal: the M1 columns show "—"
        // rather than breaking the whole widget. This covers network issues or
        // OECD API downtime without affecting M2 / printer-status data.
        .catch((): OecdObsMap => new Map()),
      fetchOecdMoney("MABMM301", oecdM2Codes, "M2")
        // OECD M2 failure is intentionally non-fatal: FRED M2 is tried first;
        // OECD is only used as a fallback when FRED returns no valid observations
        // (e.g. when a FRED-hosted OECD series is discontinued or lagging).
        .catch((): OecdObsMap => new Map()),
      Promise.allSettled(
        COUNTRIES.map((c) => fetchFredObs(c.debtSeries, apiKey, OBS_LIMIT)),
      ),
      // World Bank nominal GDP for all 6 economies.
      // Used to derive gross national debt: (debtToGDP / 100) × gdpUSD.
      // Failure is non-fatal; grossDebtUSD shows "—" if the API is unreachable.
      fetchWorldBankNominalGdp()
        .catch((): Record<string, number | null> => ({})),
      // Eurostat gov_10dd_edpt1: Euro Area general govt gross debt, % of GDP.
      // Used as fallback for EU/ECB when FRED GGGDTAEZA188N is unavailable
      // (that series was discontinued in 2010).  Failure is non-fatal.
      fetchEurostatEuroAreaDebt()
        .catch(() => null),
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

      // Determine USD conversion factor (same currency for M1 and M2)
      let toUSD = 1;
      if (cfg.fxSeries !== null) {
        const rate = fxMap[cfg.fxSeries];
        if (rate === null || rate === undefined) {
          return { ...base, error: true };
        }
        toUSD = cfg.fxInverted ? 1 / rate : rate;
      }

      // ── M1 (narrow money) ────────────────────────────────────────────────
      let m1USD:       number | null = null;
      let m1ChangeUSD: number | null = null;
      let m1Date:      string | null = null;

      // Primary: FRED M1 series (all 6 banks now have m1Series set)
      if (cfg.m1Series !== null) {
        const m1Result = fredM1Settled[i];
        if (m1Result.status === "fulfilled") {
          const valid = parseObs(m1Result.value);
          if (valid.length >= 2) {
            const m1Scale = cfg.m1LocalToBillions * toUSD;
            m1USD         = valid[0].value * m1Scale;
            m1ChangeUSD   = m1USD - valid[1].value * m1Scale;
            m1Date        = valid[0].date;
          }
        }
      }

      // Fallback: OECD SDMX for EU/UK/JP/CA when FRED M1 returned no valid data.
      // OECD data is published in millions NCU (scale = OECD_MILLIONS_TO_BILLIONS).
      if (m1USD === null && cfg.m1OecdCode !== null) {
        const oecdObs = oecdM1Map.get(cfg.m1OecdCode) ?? [];
        if (oecdObs.length >= 2) {
          const m1Scale = OECD_MILLIONS_TO_BILLIONS * toUSD;
          m1USD         = oecdObs[0].value * m1Scale;
          m1ChangeUSD   = m1USD - oecdObs[1].value * m1Scale;
          m1Date        = oecdObs[0].date;
        }
      }
      // M1 failure is non-fatal: country still shows with M1 columns = null

      // ── M2 / broad money (FRED primary, OECD SDMX fallback for EU/UK/JP/CA) ──
      // Try FRED first; if it is rejected or returns < 2 valid observations,
      // fall back to the OECD SDMX MABMM301 series (same countries as M1 fallback).
      // OECD publishes in millions of national currency; scale = OECD_MILLIONS_TO_BILLIONS.
      // If both sources fail, the country row shows "—" (error: true).
      const m2Result = m2Settled[i];

      let pts: { date: string; valueUSD: number }[] = [];

      if (m2Result.status === "fulfilled") {
        const validFred = parseObs(m2Result.value);
        if (validFred.length >= 2) {
          // Step 1: raw FRED value × localToBillions → billions of local currency
          // Step 2: × toUSD → billions USD
          pts = validFred.slice(0, 13).map((o) => ({
            date:     o.date,
            valueUSD: o.value * cfg.localToBillions * toUSD,
          }));
        }
      }

      // OECD fallback: used when FRED M2 is rejected or has < 2 valid observations.
      // OECD data is published in millions NCU (scale = OECD_MILLIONS_TO_BILLIONS).
      if (pts.length < 2 && cfg.m2OecdCode !== null) {
        const oecdObs = oecdM2Map.get(cfg.m2OecdCode) ?? [];
        if (oecdObs.length >= 2) {
          const m2Scale = OECD_MILLIONS_TO_BILLIONS * toUSD;
          pts = oecdObs.slice(0, 13).map((o) => ({
            date:     o.date,
            valueUSD: o.value * m2Scale,
          }));
        }
      }

      // If neither FRED nor OECD returned enough data, mark this country as errored.
      if (pts.length < 2) {
        return { ...base, error: true };
      }

      const latestUSD  = pts[0].valueUSD;
      const prevMonUSD = pts[1].valueUSD;

      const momPct   = ((latestUSD - prevMonUSD) / prevMonUSD) * 100;

      // ── Per-bank Printer Score ─────────────────────────────────────────────
      // Compute M1 MoM % from the absolute change (when M1 data is available)
      // m1PrevUSD = m1USD - m1ChangeUSD; guard against divide-by-zero / negative prev
      const m1PrevUSD   = m1USD !== null && m1ChangeUSD !== null ? m1USD - m1ChangeUSD : null;
      const m1MomPct    = m1PrevUSD !== null && m1PrevUSD > 0 ? (m1ChangeUSD! / m1PrevUSD) * 100 : null;

      // m1DataMissing: true when the bank has an M1 source (OECD or FRED) but
      // no valid observations were returned (e.g. OECD API temporarily down).
      const m1DataMissing = m1USD === null && (cfg.m1OecdCode !== null || cfg.m1Series !== null);

      const printerScore = computeBankPrinterScore(m1MomPct, momPct);
      const scoreRegime  = bankScoreRegime(printerScore);

      // printing = true when score ≥ 30 (Warming / Alert / Crisis)
      const printing = printerScore >= 30;

      const m2USD       = latestUSD;
      const m2ChangeUSD = latestUSD - prevMonUSD;
      const m2Date      = pts[0].date;

      // ── Legacy fields (kept for any existing consumers) ──────────────────
      // Use the M2 MoM % threshold (not the composite score) for the historical
      // episode scan so that past "printed" months are not retroactively changed.
      let printedUSD:      number | null = null;
      let printedDate:     string | null = null;
      let lastPrintedDate: string | null = null;
      let lastPrintedUSD:  number | null = null;

      if (momPct >= PRINT_THRESHOLD_PCT) {
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

      // ── Debt-to-GDP (FRED GGGDTA*188N – IMF WEO annual, % of GDP) ───────
      // For the EU/ECB row, FRED series GGGDTAEZA188N was discontinued in 2010.
      // Eurostat gov_10dd_edpt1 is used as a fallback when FRED returns null.
      // Failure is non-fatal: column shows "—" if all sources are unreachable.
      const debtResult = debtSettled[i];
      const fredDebt   = debtResult.status === "fulfilled"
        ? (parseObs(debtResult.value)[0]?.value ?? null)
        : null;
      // Prefer FRED; fall back to Eurostat for EU when FRED is unavailable.
      const debtToGDP  =
        fredDebt !== null              ? fredDebt          :
        cfg.id === "EU"               ? euroAreaDebt      :
                                        null;

      // ── Gross National Debt in current USD ────────────────────────────────
      // Source: World Bank NY.GDP.MKTP.CD (nominal GDP, actual USD → /1e9 = billions) × debtToGDP%.
      // Both series are annual so they share the same reference year.
      // Failure is non-fatal: grossDebtUSD is null if either value is unavailable.
      const gdpUSD       = gdpMap[cfg.id] ?? null;
      const grossDebtUSD = debtToGDP !== null && gdpUSD !== null
        ? (debtToGDP / 100) * gdpUSD
        : null;

      return {
        ...base,
        error: false,
        m1USD,
        m1ChangeUSD,
        m1Date,
        m1DataMissing,
        m2USD,
        m2ChangeUSD,
        m2Date,
        debtToGDP,
        grossDebtUSD,
        printerScore,
        scoreRegime,
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

