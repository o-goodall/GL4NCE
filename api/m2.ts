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
// M2 / broad money sources (all via FRED, free tier – API key kept server-side):
//   US  Fed  – M2SL             (billions USD, monthly, SA)
//   EU  ECB  – MABMM301EZM189S  (individual EUR, monthly, SA) ← 1e-9
//   UK  BOE  – MABMM301GBM189S  (individual GBP, monthly, SA) ← 1e-9
//   JP  BOJ  – MABMM301JPM189S  (individual JPY, monthly, SA) ← 1e-9
//   CA  BOC  – MABMM301CAM189S  (individual CAD, monthly, SA) ← 1e-9
//   CN  PBOC – MYAGM2CNM189N    (individual CNY, monthly, NSA) ← 1e-9
//
// FX conversion (FRED daily rates, most recent observation):
//   DEXUSEU – USD per EUR  (direct)
//   DEXUSUK – USD per GBP  (direct)
//   DEXJPUS – JPY per USD  (inverted: toUSD = 1/rate)
//   DEXCAUS – CAD per USD  (inverted)
//   DEXCHUS – CNY per USD  (inverted)

const FRED_BASE  = "https://api.stlouisfed.org/fred/series/observations";
const OECD_BASE  = "https://sdmx.oecd.org/public/rest/data";
// IMF DataMapper API – free, no API key required.
// Indicator GGXWDG_NGDP = General government gross debt (% of GDP).
// Updated with each IMF World Economic Outlook release (Apr/Oct).
// Full coverage for all G20 economies including Japan, China, and Euro area.
// Euro area group code is "EURO" (not "EMU").
const IMF_BASE      = "https://www.imf.org/external/datamapper/api/v1";
const IMF_INDICATOR = "GGXWDG_NGDP";
// World Bank Open Data API – free, no API key required.
// Indicator GC.DOD.TOTL.GD.ZS = Central government debt, total (% of GDP).
// Used as fallback when IMF DataMapper is unreachable; covers US / UK / CA well.
const WB_BASE      = "https://api.worldbank.org/v2";
const WB_INDICATOR = "GC.DOD.TOTL.GD.ZS";

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

// Scale factor for OECD SDMX M1 data: OECD publishes in millions NCU.
// Used only when falling back to OECD after a FRED M1 fetch fails.
const OECD_M1_MILLIONS_TO_BILLIONS = 0.001;

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
  // ── M2 / broad money (always via FRED) ──────────────────────────────────
  m2Series:         string;         // FRED series ID for M2
  localToBillions:  number;         // raw FRED value → billions of local currency
                                    //   M2SL:    1     (already billions USD)
                                    //   MABMM301*: 1e-9 (individual NCU → billions)
                                    //   MYAGM2CN:  1e-9  (individual CNY → billions)
  // ── FX conversion (FRED daily rates) ────────────────────────────────────
  fxSeries:         string | null;  // null → already USD
  fxInverted:       boolean;        // true = LCU/USD (invert); false = USD/LCU
  // ── Debt-to-GDP ──────────────────────────────────────────────────────────
  // IMF DataMapper (primary): best coverage – has all 6 economies including
  // Euro area (EURO), Japan, and China.  Euro area group code is "EURO".
  imfCode:          string | null;  // IMF DataMapper country/group code; null = skip
  // World Bank (fallback): used when IMF DataMapper is unreachable.
  // Coverage for GC.DOD.TOTL.GD.ZS: US ✓  UK ✓  CA ✓  JP/CN/EU limited.
  wbCode:           string | null;  // World Bank country code; null = skip
}

const COUNTRIES: readonly CountryConfig[] = [
  // US: M1 and M2 both from FRED; already in billions USD
  { id: "US", name: "Fed",  flag: "🇺🇸",
    m1Series: "M1SL",              m1OecdCode: null,  m1LocalToBillions: 1,
    m2Series: "M2SL",              localToBillions: 1,
    fxSeries: null,                fxInverted: false,
    imfCode: "USA",  wbCode: "US" },
  // EU: M1 from FRED (MANMM101EZM189S, individual EUR) with OECD fallback;
  //     M2 from FRED (MABMM301EZM189S, individual EUR)
  { id: "EU", name: "ECB",  flag: "🇪🇺",
    m1Series: "MANMM101EZM189S",   m1OecdCode: "EA",  m1LocalToBillions: 1e-9,
    m2Series: "MABMM301EZM189S",   localToBillions: 1e-9,
    fxSeries: "DEXUSEU",           fxInverted: false,
    imfCode: "EURO", wbCode: "EMU" },  // "EMU" is WB's best-effort Euro area code; coverage limited
  // UK: M1 from FRED (MANMM101GBM189S, individual GBP) with OECD fallback;
  //     M2 from FRED (MABMM301GBM189S, individual GBP)
  { id: "UK", name: "BOE",  flag: "🇬🇧",
    m1Series: "MANMM101GBM189S",   m1OecdCode: "GBR", m1LocalToBillions: 1e-9,
    m2Series: "MABMM301GBM189S",   localToBillions: 1e-9,
    fxSeries: "DEXUSUK",           fxInverted: false,
    imfCode: "GBR",  wbCode: "GB" },
  // JP: M1 from FRED (MANMM101JPM189S, individual JPY) with OECD fallback;
  //     M2 from FRED (MABMM301JPM189S, individual JPY)
  { id: "JP", name: "BOJ",  flag: "🇯🇵",
    m1Series: "MANMM101JPM189S",   m1OecdCode: "JPN", m1LocalToBillions: 1e-9,
    m2Series: "MABMM301JPM189S",   localToBillions: 1e-9,
    fxSeries: "DEXJPUS",           fxInverted: true,
    imfCode: "JPN",  wbCode: "JP" },
  // CA: M1 from FRED (MANMM101CAM189S, individual CAD) with OECD fallback;
  //     M2 from FRED (MABMM301CAM189S, individual CAD)
  { id: "CA", name: "BOC",  flag: "🇨🇦",
    m1Series: "MANMM101CAM189S",   m1OecdCode: "CAN", m1LocalToBillions: 1e-9,
    m2Series: "MABMM301CAM189S",   localToBillions: 1e-9,
    fxSeries: "DEXCAUS",           fxInverted: true,
    imfCode: "CAN",  wbCode: "CA" },
  // CN: M1 and M2 both from FRED (individual CNY)
  { id: "CN", name: "PBOC", flag: "🇨🇳",
    m1Series: "MYAGM1CNM189N",     m1OecdCode: null,  m1LocalToBillions: 1e-9,
    m2Series: "MYAGM2CNM189N",     localToBillions: 1e-9,
    fxSeries: "DEXCHUS",           fxInverted: true,
    imfCode: "CHN",  wbCode: "CN" },
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

// ── OECD SDMX helpers (for M1 narrow money fallback) ─────────────────────────
//
// The OECD SDMX REST API (sdmx.oecd.org) is free and requires no API key.
// It is used as a fallback source for EU/UK/JP/CA M1 if the primary FRED
// MANMM101* series return no valid observations.
//
// OECD MEI_FIN monetary data is published in MILLIONS of national currency,
// so the fallback scale factor is OECD_M1_MILLIONS_TO_BILLIONS = 0.001.
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

async function fetchOecdNarrowMoney(oecdCodes: string[]): Promise<OecdObsMap> {
  if (oecdCodes.length === 0) return new Map();
  // SDMX dataflow key: MABMM101 (narrow money indicator) · countries joined
  // with "+" (multi-value selection) · M (monthly frequency)
  const key = `MABMM101.${oecdCodes.join("+")}.M`;
  const url =
    `${OECD_BASE}/OECD,MEI_FIN,1.0/${encodeURIComponent(key)}` +
    `?lastNObservations=${OBS_LIMIT}&format=jsondata`;

  const res = await fetch(url, {
    headers: { Accept: "application/vnd.sdmx.data+json;version=1.0, application/json" },
  });
  if (!res.ok) throw new Error(`OECD HTTP ${res.status} for M1`);
  return parseOecdSdmx((await res.json()) as OecdSdmxBody);
}

// ── World Bank Open Data helpers (debt-to-GDP fallback) ───────────────────────
//
// Indicator GC.DOD.TOTL.GD.ZS = Central government debt, total (% of GDP).
// Used as fallback when IMF DataMapper is unreachable.
// Good coverage for US / UK / CA; limited for JP, CN, and Euro area aggregate.
// mrv=10 retrieves the 10 most-recent observations to bridge publication lags.
//
// World Bank codes used:
//   US → "US"   UK → "GB"   JP → "JP"   CA → "CA"   CN → "CN"   EU → "EMU"

interface WbObservation {
  country: { id: string };
  date:    string;
  value:   number | null;
}

async function fetchWorldBankDebt(
  wbCodes: string[],
): Promise<Map<string, number | null>> {
  if (wbCodes.length === 0) return new Map();
  const codes = wbCodes.join(";");
  const url =
    `${WB_BASE}/country/${encodeURIComponent(codes)}/indicator/${WB_INDICATOR}` +
    `?format=json&mrv=10&per_page=100`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank HTTP ${res.status}`);
  const body = (await res.json()) as [unknown, WbObservation[] | null];
  const obs  = body[1] ?? [];

  const result = new Map<string, number | null>();
  // obs is sorted most-recent first; skip null entries to find the latest real value per country
  for (const o of obs) {
    const code = o.country.id.toUpperCase();
    if (!result.has(code)) {
      if (o.value !== null) result.set(code, o.value);
    }
  }
  return result;
}

// ── IMF DataMapper helpers (debt-to-GDP primary) ──────────────────────────────
//
// Indicator GGXWDG_NGDP = General government gross debt (% of GDP).
// Source: IMF World Economic Outlook – free, no API key required.
// Updated twice yearly (April and October WEO releases).
// Full coverage for all G20 economies including Japan, China, and Euro area.
// Euro area group code is "EURO" (not "EMU").
// A failure here is non-fatal – World Bank is used as fallback.
//
// IMF DataMapper codes used:
//   US  → "USA"   UK  → "GBR"   JP → "JPN"
//   CA  → "CAN"   CN  → "CHN"   EU → "EURO" (Euro area WEO group)

interface ImfDataMapperResponse {
  values?: {
    [indicator: string]: {
      [countryCode: string]: {
        [year: string]: number | null;
      };
    };
  };
}

async function fetchImfDebt(
  imfCodes: string[],
): Promise<Map<string, number | null>> {
  if (imfCodes.length === 0) return new Map();
  const url = `${IMF_BASE}/${IMF_INDICATOR}/${imfCodes.join("/")}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`IMF HTTP ${res.status}`);
  const body = (await res.json()) as ImfDataMapperResponse;
  const data = body.values?.[IMF_INDICATOR] ?? {};

  const result = new Map<string, number | null>();
  for (const [code, yearMap] of Object.entries(data)) {
    // Sort years descending; take the most recent non-null value.
    // IMF WEO includes forecasts for future years – using the latest available
    // value (actual or near-term estimate) reflects the most current picture.
    const years = Object.keys(yearMap).sort((a, b) => Number(b) - Number(a));
    let latest: number | null = null;
    for (const yr of years) {
      const v = yearMap[yr];
      if (v !== null && v !== undefined) {
        latest = v;
        break;
      }
    }
    result.set(code.toUpperCase(), latest);
  }
  return result;
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
  // Debt-to-GDP (IMF WEO primary, World Bank fallback – annual)
  debtToGDP?:       number | null;   // General government gross debt, % of GDP
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

    // Collect IMF codes needed for debt-to-GDP (all 6 countries)
    const imfCodes = COUNTRIES
      .map((c) => c.imfCode)
      .filter((code): code is string => code !== null);

    // Collect World Bank codes for debt-to-GDP fallback (all 6 countries)
    const wbCodes = COUNTRIES
      .map((c) => c.wbCode)
      .filter((code): code is string => code !== null);

    // Fetch M1 from FRED (US + CN), M2 from FRED (all 6), FX from FRED,
    // M1 from OECD (EU/UK/JP/CA), debt-to-GDP from IMF DataMapper (primary),
    // and debt-to-GDP from World Bank (fallback) – all in parallel.
    // For countries that use OECD M1, pass an empty resolved promise as FRED
    // placeholder so the settled array stays index-aligned with COUNTRIES.
    const [fredM1Settled, m2Settled, fxSettled, oecdM1Map, imfDebtMap, wbDebtMap] = await Promise.all([
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
      fetchOecdNarrowMoney(oecdM1Codes)
        // OECD M1 failure is intentionally non-fatal: the M1 columns show "—"
        // rather than breaking the whole widget. This covers network issues or
        // OECD API downtime without affecting M2 / printer-status data.
        .catch((): OecdObsMap => new Map()),
      fetchImfDebt(imfCodes)
        // IMF failure is non-fatal: World Bank fallback is used instead.
        .catch((): Map<string, number | null> => new Map()),
      fetchWorldBankDebt(wbCodes)
        // World Bank failure is non-fatal: debt-to-GDP column shows "—".
        .catch((): Map<string, number | null> => new Map()),
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
      // OECD data is published in millions NCU (scale = OECD_M1_MILLIONS_TO_BILLIONS).
      if (m1USD === null && cfg.m1OecdCode !== null) {
        const oecdObs = oecdM1Map.get(cfg.m1OecdCode) ?? [];
        if (oecdObs.length >= 2) {
          const m1Scale = OECD_M1_MILLIONS_TO_BILLIONS * toUSD;
          m1USD         = oecdObs[0].value * m1Scale;
          m1ChangeUSD   = m1USD - oecdObs[1].value * m1Scale;
          m1Date        = oecdObs[0].date;
        }
      }
      // M1 failure is non-fatal: country still shows with M1 columns = null

      // ── M2 / broad money (always via FRED) ──────────────────────────────
      const m2Result = m2Settled[i];
      if (m2Result.status === "rejected") {
        return { ...base, error: true };
      }

      const validM2 = parseObs(m2Result.value);
      if (validM2.length < 2) {
        return { ...base, error: true };
      }

      // Convert M2 observations to USD billions (up to 13 most-recent)
      // Step 1: raw FRED value × localToBillions → billions of local currency
      // Step 2: × toUSD → billions USD
      const pts = validM2.slice(0, 13).map((o) => ({
        date:     o.date,
        valueUSD: o.value * cfg.localToBillions * toUSD,
      }));

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

      // ── Debt-to-GDP ──────────────────────────────────────────────────────
      // Prefer IMF DataMapper (GGXWDG_NGDP – general government gross debt,
      // full G20 coverage); fall back to World Bank (GC.DOD.TOTL.GD.ZS) which
      // reliably covers US / UK / CA when IMF DataMapper is unreachable.
      const debtToGDP =
        (cfg.imfCode !== null ? imfDebtMap.get(cfg.imfCode.toUpperCase()) ?? null : null) ??
        (cfg.wbCode  !== null ? wbDebtMap.get(cfg.wbCode.toUpperCase())   ?? null : null);

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

