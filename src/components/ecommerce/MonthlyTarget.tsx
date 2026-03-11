import { useEffect, useState } from "react";
import { subscribeBtcTicker } from "../../lib/binanceTicker";

// ── DCA window ─────────────────────────────────────────────────────────────
// Day 1 = 4 Mar 2026 (DCA start); Day 421 = 28 Apr 2027 ($250/day × 421d = $105,250 total)
// $506/wk × 208 weeks = $105,248 total savings → $105,248 ÷ 421d = $249.995 → ceil-to-$5 = $250/day
const DCA_START_MS   = new Date("2026-03-04T00:00:00Z").getTime();
const DCA_END_MS     = DCA_START_MS + (421 - 1) * 86_400_000;
const DCA_WINDOW_DAYS = 421;
const YEARS_IN_CYCLE  = 4;
const WEEKS_PER_YEAR  = 52;
const DEFAULT_WEEKLY_AUD = 506; // $506/wk × 52 × 4yr ÷ 421d = $249.995 → ceil-to-$5 = $250/day

// ── Cache config ───────────────────────────────────────────────────────────
const ATH_CACHE_KEY  = "btc-ath";      // shared with BtcLiveChart
const ATH_CACHE_TTL  = 86_400_000;     // 24 h
const WMA_CACHE_KEY  = "btc-200wma";
const WMA_CACHE_TTL  = 7 * 86_400_000; // 7 days
const WMA_PERIOD     = 200;
const RSI_CACHE_KEY  = "btc-rsi14w";
const RSI_CACHE_TTL  = 86_400_000;     // 24 h
const DCA_SETTINGS_KEY = "dca-settings"; // user's custom DCA config

// ── 3-phase psychological confirmation thresholds ──────────────────────────
// Validated across 2015, 2018, 2020, 2022–2025 cycles. Signals are
// informational only — they do not affect the DCA buy amount.
const RSI_PERIOD     = 14;   // 14-week Wilder's RSI
const RSI_OVERSOLD   = 35;   // weekly RSI ≤ 35 → capitulation lows (2015, 2018, 2022)
const RSI_OVERBOUGHT = 80;   // weekly RSI ≥ 80 → blow-off tops (2013, 2017, 2021)
const SMA_50W_PERIOD = 50;   // 50-week SMA (for golden-cross confirmation)

// Deploy (🟢 trough confirmation): MVRV Z < 1, Below 200W MA, RSI < 35, F&G < 20
const FG_DEPLOY_THRESHOLD    = 20;   // extreme fear — bottoms in 2018, 2020, 2022
// Hold  (🟡 bull expansion):  NUPL 0.25–0.60, 50W > 200W MA, F&G 60–85
const FG_HOLD_LOW            = 60;
const FG_HOLD_HIGH           = 85;
// Reserve (🔴 peak / late-cycle): MVRV Z > 5–6, NUPL > 0.70, RSI > 80, F&G > 90
const FG_RESERVE_THRESHOLD   = 90;   // extreme greed — mania at tops

// MVRV / NUPL thresholds (derived from /api/onchain → CoinMetrics community API)
const MVRV_Z_DEPLOY  = 1;     // Deploy: Z < 1 (trough)
const MVRV_Z_RESERVE = 5;     // Reserve: Z > 5 (peak)
const NUPL_HOLD_LOW  = 0.25;  // Hold: NUPL 0.25–0.60
const NUPL_HOLD_HIGH = 0.60;
const NUPL_RESERVE   = 0.70;  // Reserve: NUPL > 0.70
const ONCHAIN_CACHE_KEY = "btc-onchain";
const ONCHAIN_CACHE_TTL = 21_600_000; // 6 h (matches API edge cache)

// ── Confirmed cycle dates + one projected next event per series ────────────
// Troughs: Jan 2015, Dec 2018, Nov 2022 (all confirmed).
// Avg trough-to-trough spacing: 1431d + 1437d ÷ 2 = 1434d
// Projected: Nov 2022 + 1434d ≈ 25 Oct 2026; Oct 2026 + 1434d ≈ 28 Sep 2030
const CYCLE_TROUGHS_MS: readonly number[] = [
  new Date("2015-01-14T00:00:00Z").getTime(),
  new Date("2018-12-15T00:00:00Z").getTime(),
  new Date("2022-11-21T00:00:00Z").getTime(),
  new Date("2026-10-25T00:00:00Z").getTime(), // projected — day 236/421 of DCA window
  new Date("2030-09-28T00:00:00Z").getTime(), // projected (+1434d)
];
// Peaks: Dec 2013, Dec 2017, Nov 2021, Oct 2025 (all confirmed); Oct 2029 (+4yr projected)
const CYCLE_PEAKS_MS: readonly number[] = [
  new Date("2013-12-04T00:00:00Z").getTime(),
  new Date("2017-12-16T00:00:00Z").getTime(),
  new Date("2021-11-08T00:00:00Z").getTime(),
  new Date("2025-10-06T00:00:00Z").getTime(),
  new Date("2029-10-06T00:00:00Z").getTime(), // projected
];

// ── 3-phase strategy durations (derived from cycle constants, not hardcoded) ─
// Reserve: confirmed Oct 2025 cycle peak → DCA window open  ≈ 149 d
// Buy:     DCA deployment window                             = 421 d (DCA_WINDOW_DAYS)
// Hold:    DCA window close → projected Oct 2029 cycle peak ≈ 891 d
const RESERVE_WINDOW_DAYS = Math.round((DCA_START_MS - CYCLE_PEAKS_MS[3]) / 86_400_000);
const HOLD_WINDOW_DAYS    = Math.round((CYCLE_PEAKS_MS[4] - DCA_END_MS)    / 86_400_000);

// ── Fallbacks while async fetches are in-flight ────────────────────────────
const LOW_PRICE_USD_FALLBACK  = 55_000;
const HIGH_PRICE_USD_FALLBACK = 126_200; // used only until live ATH is fetched

// ── Halving cycle ──────────────────────────────────────────────────────────
const PREV_HALVING_MS     = new Date("2024-04-20T00:00:00Z").getTime();
const NEXT_HALVING_MS     = new Date("2028-04-19T00:00:00Z").getTime();
const POST_HALVING_WINDOW = 547 * 86_400_000; // ≈ 18 months after halving
const PRE_HALVING_WINDOW  = 365 * 86_400_000; // ≤ 12 months before next halving

// ── DCA settings — user-configurable ──────────────────────────────────────
interface DcaSlot {
  weeklyAmtAUD: number;
}
interface DcaSettings {
  slot1: DcaSlot;
  slot2?: DcaSlot;
}

/** $X/week → daily buy within the 421-day window, rounded up to nearest $5 */
function calcDailyAmt(weeklyAmtAUD: number): number {
  const total = weeklyAmtAUD * WEEKS_PER_YEAR * YEARS_IN_CYCLE;
  return Math.ceil(total / DCA_WINDOW_DAYS / 5) * 5;
}

function loadDcaSettings(): DcaSettings {
  try {
    const raw = localStorage.getItem(DCA_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DcaSettings>;
      if (typeof parsed?.slot1?.weeklyAmtAUD === "number") return parsed as DcaSettings;
    }
  } catch { /* ignore */ }
  return { slot1: { weeklyAmtAUD: DEFAULT_WEEKLY_AUD } };
}


// ── Helpers ────────────────────────────────────────────────────────────────
function fmtAUD(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtK(n: number): string {
  return `$${Math.round(n / 1_000)}K`;
}

function getCycleGradient(progressPct: number): string {
  void progressPct;
  return "linear-gradient(to right, #FFD700, #FFC700, #FF8C00, #FF4500, #FF0000, #B22222, #CD5C5C, #E0FFFF)";
}


// ── Cache helpers ──────────────────────────────────────────────────────────
function getCachedNumber(key: string, ttl: number): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { data?: unknown; price?: unknown; fetchedAt: number };
    if (Date.now() - entry.fetchedAt > ttl) return null;
    // Accept both { data: ... } (BtcLiveChart's setCache format) and { price: ... } (legacy)
    const val = entry.data ?? entry.price;
    if (typeof val !== "number" || !isFinite(val)) return null;
    return val;
  } catch { return null; }
}

function setCachedNumber(key: string, price: number): void {
  try {
    localStorage.setItem(key, JSON.stringify({ price, fetchedAt: Date.now() }));
  } catch { /* ignore storage quota errors */ }
}

// ── CoinMetrics direct fetch (client-side fallback for /api/onchain) ───────
interface OnchainResult { mvrvZScore: number; nupl: number }

async function fetchOnchainDirect(signal: AbortSignal): Promise<OnchainResult | null> {
  const url =
    "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics" +
    "?assets=btc&metrics=CapMVRVCur,CapMrktCurUSD&frequency=1d&page_size=10000&start_time=2011-01-01";
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { CapMVRVCur: string; CapMrktCurUSD: string }[] };
  const rows = json.data;
  if (!rows?.length || rows.length < 100) return null;

  const marketCaps: number[] = [];
  const mvrvs: number[] = [];
  for (const row of rows) {
    const mc = parseFloat(row.CapMrktCurUSD);
    const mv = parseFloat(row.CapMVRVCur);
    if (isNaN(mc) || isNaN(mv) || mv === 0) continue;
    marketCaps.push(mc);
    mvrvs.push(mv);
  }
  if (marketCaps.length < 100) return null;

  const lastIdx = marketCaps.length - 1;
  const currentMC = marketCaps[lastIdx];
  const currentMVRV = mvrvs[lastIdx];
  const currentRC = currentMC / currentMVRV;
  const nupl = 1 - 1 / currentMVRV;
  const meanMC = marketCaps.reduce((s, v) => s + v, 0) / marketCaps.length;
  const variance = marketCaps.reduce((s, v) => s + (v - meanMC) ** 2, 0) / marketCaps.length;
  const stddevMC = Math.sqrt(variance);
  const mvrvZScore = stddevMC > 0 ? (currentMC - currentRC) / stddevMC : 0;

  return {
    mvrvZScore: Math.round(mvrvZScore * 100) / 100,
    nupl: Math.round(nupl * 1000) / 1000,
  };
}

// ── Binance kline fetchers ─────────────────────────────────────────────────
type RawKline = [number, string, string, string, string, ...unknown[]];

async function fetchWeeklyKlines(signal: AbortSignal): Promise<RawKline[]> {
  const url = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=250";
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as RawKline[];
}

// ── Derive ATH from klines (all-time high across weekly highs) ────────────
function deriveATH(klines: RawKline[]): number | null {
  if (!klines.length) return null;
  let max = -Infinity;
  for (const k of klines) {
    const high = parseFloat(k[2]);
    if (!isNaN(high) && high > max) max = high;
  }
  return isFinite(max) ? max : null;
}

// ── Generic SMA of the last `period` closes ────────────────────────────────
function deriveSMA(klines: RawKline[], period: number): number | null {
  const closes = klines.map((k) => parseFloat(k[4])).filter((v) => !isNaN(v));
  if (closes.length < period) return null;
  const last = closes.slice(-period);
  return last.reduce((s, v) => s + v, 0) / period;
}

// ── Derive 14-week RSI using Wilder's smoothed method ─────────────────────
// Used as live confirmation within historical cycle windows:
//   Phase 1 "Near Trough" active when: in trough window AND RSI ≤ RSI_OVERSOLD
//   Phase 2 "Near Peak"   active when: in peak window   AND RSI ≥ RSI_OVERBOUGHT
function deriveRSI(klines: RawKline[], period: number): number | null {
  const closes = klines.map((k) => parseFloat(k[4])).filter((v) => !isNaN(v));
  if (closes.length < period + 1) return null;

  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i - 1]);

  // Seed: simple average of first `period` moves
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing (factor = 1/period)
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + (changes[i] > 0 ? changes[i] : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (changes[i] <= 0 ? Math.abs(changes[i]) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// ── 3-phase strategy system ────────────────────────────────────────────────
// Phases are derived entirely from the DCA window constants — no hardcoded
// calendar comparisons — so they automatically adapt when DCA_START_MS /
// DCA_END_MS are updated.
//
//   Phase 1 · Save  — before DCA deployment begins   (accumulate capital)
//   Phase 2 · DCA   — inside the deployment window   (deploy $250/day)
//   Phase 3 · Hold  — after deployment window ends   (hold through bull run)
type StrategyPhase = "save" | "dca" | "hold";

function getDcaPhase(nowMs: number): StrategyPhase {
  if (nowMs < DCA_START_MS) return "save";
  if (nowMs <= DCA_END_MS)  return "dca";
  return "hold";
}

// ── Signal indicator card ──────────────────────────────────────────────────
interface SignalItemProps {
  active: boolean;
  label: string;
  sub: string;
}

function SignalItem({ active, label, sub }: SignalItemProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-2.5 px-0.5">
      <div className="flex items-center gap-1">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500 ${
            active ? "bg-positive" : "bg-gray-300 dark:bg-gray-600"
          }`}
        />
        <span
          className={`text-[10px] font-semibold text-center leading-tight transition-colors duration-300 ${
            active
              ? "text-gray-800 dark:text-white/90"
              : "text-gray-400 dark:text-gray-500"
          }`}
        >
          {label}
        </span>
      </div>
      <span
        className={`text-[10px] tabular-nums transition-colors duration-300 ${
          active
            ? "text-positive"
            : "text-gray-400 dark:text-gray-500"
        }`}
      >
        {sub}
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function MonthlyTarget() {
  const [priceUSD,   setPriceUSD]   = useState<number | null>(null);
  const [fearGreed,  setFearGreed]  = useState<number | null>(null);

  // 200-week moving average (for Below-WMA signal)
  const [lowPriceUSD,  setLowPriceUSD]  = useState<number>(LOW_PRICE_USD_FALLBACK);
  // Live ATH — PASS threshold (pauses DCA when price ≥ all-time high)
  const [highPriceUSD, setHighPriceUSD] = useState<number>(HIGH_PRICE_USD_FALLBACK);
  // 14-week RSI — live confirmation for cycle trough/peak windows
  const [weeklyRSI, setWeeklyRSI] = useState<number | null>(null);
  // 50-week SMA — golden-cross confirmation (Hold phase: 50W > 200W)
  const [sma50w, setSma50w] = useState<number | null>(null);
  // On-chain metrics from /api/onchain (CoinMetrics community API)
  const [mvrvZScore, setMvrvZScore] = useState<number | null>(null);
  const [nupl, setNupl] = useState<number | null>(null);

  // ── User DCA settings ─────────────────────────────────────────────────
  const [dcaSettings] = useState<DcaSettings>(loadDcaSettings);

  // Active daily amount derived from selected slot
  const activeConfig  = dcaSettings.slot1;
  const dailyAmtAUD   = calcDailyAmt(activeConfig.weeklyAmtAUD);

  // ── Fetch weekly klines (live ATH + 200WMA + 50WMA + 14-week RSI) ───────
  useEffect(() => {
    const cachedATH = getCachedNumber(ATH_CACHE_KEY, ATH_CACHE_TTL);
    const cachedWMA = getCachedNumber(WMA_CACHE_KEY, WMA_CACHE_TTL);
    const cachedRSI = getCachedNumber(RSI_CACHE_KEY, RSI_CACHE_TTL);

    if (cachedATH !== null) setHighPriceUSD(cachedATH);
    if (cachedWMA !== null) setLowPriceUSD(cachedWMA);
    if (cachedRSI !== null) setWeeklyRSI(cachedRSI);

    // Always fetch klines so we can derive the 50W SMA (not cached separately)
    const ctrl = new AbortController();
    fetchWeeklyKlines(ctrl.signal)
      .then((klines) => {
        if (cachedATH === null) {
          const ath = deriveATH(klines);
          if (ath !== null && ath > 0) {
            setCachedNumber(ATH_CACHE_KEY, ath);
            setHighPriceUSD(ath);
          }
        }
        if (cachedWMA === null) {
          const wma = deriveSMA(klines, WMA_PERIOD);
          if (wma !== null && wma > 0) {
            setCachedNumber(WMA_CACHE_KEY, wma);
            setLowPriceUSD(wma);
          }
        }
        if (cachedRSI === null) {
          const rsi = deriveRSI(klines, RSI_PERIOD);
          if (rsi !== null && isFinite(rsi)) {
            setCachedNumber(RSI_CACHE_KEY, rsi);
            setWeeklyRSI(rsi);
          }
        }
        // 50-week SMA — used for Hold phase golden-cross check (50W > 200W)
        const sma50 = deriveSMA(klines, SMA_50W_PERIOD);
        if (sma50 !== null && sma50 > 0) setSma50w(sma50);
      })
      .catch(() => { /* keep fallback values */ });
    return () => ctrl.abort();
  }, []);

  // ── Fear & Greed index ───────────────────────────────────────────────────
  useEffect(() => {
    fetch("https://api.alternative.me/fng/?limit=1&format=json")
      .then((r) => r.json())
      .then((d) => {
        const val = parseInt((d?.data?.[0]?.value as string) ?? "", 10);
        if (!isNaN(val)) setFearGreed(val);
      })
      .catch(() => {});
  }, []);

  // ── On-chain metrics (MVRV Z-Score + NUPL) ──────────────────────────────
  // Try /api/onchain (Vercel), fall back to direct CoinMetrics community API.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ONCHAIN_CACHE_KEY);
      if (raw) {
        const entry = JSON.parse(raw) as { mvrvZScore?: number; nupl?: number; fetchedAt: number };
        if (Date.now() - entry.fetchedAt < ONCHAIN_CACHE_TTL) {
          if (typeof entry.mvrvZScore === "number") setMvrvZScore(entry.mvrvZScore);
          if (typeof entry.nupl === "number") setNupl(entry.nupl);
          return; // cache hit — skip network
        }
      }
    } catch { /* ignore */ }

    const ctrl = new AbortController();
    const applyResult = (d: { mvrvZScore?: number; nupl?: number }) => {
      if (typeof d.mvrvZScore === "number") setMvrvZScore(d.mvrvZScore);
      if (typeof d.nupl === "number") setNupl(d.nupl);
      try {
        localStorage.setItem(ONCHAIN_CACHE_KEY, JSON.stringify({ ...d, fetchedAt: Date.now() }));
      } catch { /* ignore storage quota */ }
    };

    // Primary: Vercel serverless; Fallback: direct CoinMetrics community API
    fetch("/api/onchain", { signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(applyResult)
      .catch(() =>
        fetchOnchainDirect(ctrl.signal)
          .then((d) => { if (d) applyResult(d); })
          .catch(() => {}),
      );
    return () => ctrl.abort();
  }, []);

  // ── Shared Binance ticker — live BTC/USDT price ───────────────────────────
  useEffect(() => {
    const unsubscribe = subscribeBtcTicker(({ price }) => {
      setPriceUSD(price);
      // Keep ATH up-to-date as BTC makes new highs (future-proofing)
      setHighPriceUSD((prev) => {
        if (price > prev) {
          setCachedNumber(ATH_CACHE_KEY, price);
          return price;
        }
        return prev;
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // ── Signal states (3-phase psychological confirmation model) ─────────────
  // Each phase has its own indicator set, validated across all cycles 2015–2025.
  const now = Date.now();

  // Deploy (🟢) — trough confirmation: 3 of 4 active → high-confidence trough
  const deployMVRV     = mvrvZScore !== null && mvrvZScore < MVRV_Z_DEPLOY;     // Z < 1
  const deployBelowWMA  = priceUSD !== null && priceUSD < lowPriceUSD;
  const deployRSI       = weeklyRSI !== null && weeklyRSI <= RSI_OVERSOLD;   // ≤ 35
  const deployFear      = fearGreed !== null && fearGreed <= FG_DEPLOY_THRESHOLD; // ≤ 20

  // Hold (🟡) — bull expansion confirmation
  const holdNUPL        = nupl !== null && nupl >= NUPL_HOLD_LOW && nupl <= NUPL_HOLD_HIGH; // 0.25–0.60
  const holdGoldenCross = sma50w !== null && sma50w > lowPriceUSD;           // 50W > 200W
  const holdFearGreed   = fearGreed !== null && fearGreed >= FG_HOLD_LOW && fearGreed <= FG_HOLD_HIGH; // 60–85

  // Reserve (🔴) — peak / late-cycle confirmation
  const reserveMVRV     = mvrvZScore !== null && mvrvZScore > MVRV_Z_RESERVE;   // Z > 5
  const reserveNUPL     = nupl !== null && nupl > NUPL_RESERVE;                  // > 0.70
  const reserveRSI      = weeklyRSI !== null && weeklyRSI >= RSI_OVERBOUGHT; // ≥ 80
  const reserveFear     = fearGreed !== null && fearGreed >= FG_RESERVE_THRESHOLD; // ≥ 90

  // ── DCA window ─────────────────────────────────────────────────────────
  const inWindow   = now >= DCA_START_MS && now <= DCA_END_MS;
  const daysToStart = Math.max(0, Math.ceil((DCA_START_MS - now) / 86_400_000));

  // ── Strategy phase (3-phase: Save → DCA → Hold) ─────────────────────────
  // Derived from DCA_START_MS / DCA_END_MS — no hardcoded calendar dates here.
  const phase       = getDcaPhase(now);

  // DCA progress within the buy window (used by dotPct calculation)
  const dcaElapsedDays   = Math.max(0, Math.floor((now - DCA_START_MS) / 86_400_000));

  // Full cycle days used for display labels.
  const thermometerTotal = RESERVE_WINDOW_DAYS + DCA_WINDOW_DAYS + HOLD_WINDOW_DAYS;

  // Progress on an even 3-part UI timeline (Reserve/Buy/Hold each = 1/3 width).
  const elapsedReserveDays = Math.min(RESERVE_WINDOW_DAYS, Math.max(0, RESERVE_WINDOW_DAYS - daysToStart));
  const holdElapsedDays    = Math.min(HOLD_WINDOW_DAYS,    Math.max(0, Math.floor((now - DCA_END_MS) / 86_400_000)));
  const segment = 100 / 3;
  const phaseProgressPct =
    phase === "save"
      ? (elapsedReserveDays / Math.max(RESERVE_WINDOW_DAYS, 1)) * segment
      : phase === "dca"
      ? segment + (dcaElapsedDays / Math.max(DCA_WINDOW_DAYS, 1)) * segment
      : segment * 2 + (holdElapsedDays / Math.max(HOLD_WINDOW_DAYS, 1)) * segment;
  const progressPct = Math.min(100, Math.max(0, phaseProgressPct));
  const cycleDay =
    phase === "save"
      ? elapsedReserveDays + 1
      : phase === "dca"
      ? RESERVE_WINDOW_DAYS + dcaElapsedDays + 1
      : RESERVE_WINDOW_DAYS + DCA_WINDOW_DAYS + holdElapsedDays + 1;
  const [displayedProgressPct, setDisplayedProgressPct] = useState(0);

  // Repeating phase info for refined single-row UI (Reserve -> Buy -> Hold -> repeat).
  const cycleStartMs = CYCLE_PEAKS_MS[3];
  const daysSinceCycleStart = Math.max(0, Math.floor((now - cycleStartMs) / 86_400_000));
  const cycleDayInLoop = daysSinceCycleStart % Math.max(thermometerTotal, 1);

  let phaseLabel = "Distribution";
  let phaseElapsed = cycleDayInLoop;
  let phaseDuration = RESERVE_WINDOW_DAYS;
  if (cycleDayInLoop < RESERVE_WINDOW_DAYS) {
    phaseLabel = "Distribution";
    phaseElapsed = cycleDayInLoop;
    phaseDuration = RESERVE_WINDOW_DAYS;
  } else if (cycleDayInLoop < RESERVE_WINDOW_DAYS + DCA_WINDOW_DAYS) {
    phaseLabel = "Accumulation";
    phaseElapsed = cycleDayInLoop - RESERVE_WINDOW_DAYS;
    phaseDuration = DCA_WINDOW_DAYS;
  } else {
    phaseLabel = "Expansion";
    phaseElapsed = cycleDayInLoop - RESERVE_WINDOW_DAYS - DCA_WINDOW_DAYS;
    phaseDuration = HOLD_WINDOW_DAYS;
  }
  const phasePct = Math.min(100, Math.max(0, (phaseElapsed / Math.max(phaseDuration, 1)) * 100));
  const phaseDaysLeft = Math.max(0, phaseDuration - phaseElapsed);

  // Estimated cycle event position within the current phase bar (%).
  // Only visible when within ±30 days of the projected event.
  // Deploy: projected trough at Oct 25 2026 → position within DCA window.
  // Hold:   projected peak at Oct 6 2029 → position within hold window.
  const PING_WINDOW_DAYS = 30;

  const troughInDeployPct = (() => {
    if (phaseLabel !== "Accumulation") return null;
    const troughMs = CYCLE_TROUGHS_MS[3]; // Oct 25 2026
    const dayInDca = Math.round((troughMs - DCA_START_MS) / 86_400_000);
    if (dayInDca < 0 || dayInDca > DCA_WINDOW_DAYS) return null;
    if (Math.abs(phaseElapsed - dayInDca) > PING_WINDOW_DAYS) return null;
    return Math.min(100, Math.max(0, (dayInDca / DCA_WINDOW_DAYS) * 100));
  })();

  const peakInHoldPct = (() => {
    if (phaseLabel !== "Expansion") return null;
    const peakMs = CYCLE_PEAKS_MS[4]; // Oct 6 2029
    const dayInHold = Math.round((peakMs - DCA_END_MS) / 86_400_000);
    if (dayInHold < 0 || dayInHold > HOLD_WINDOW_DAYS) return null;
    if (Math.abs(phaseElapsed - dayInHold) > PING_WINDOW_DAYS) return null;
    return Math.min(100, Math.max(0, (dayInHold / HOLD_WINDOW_DAYS) * 100));
  })();

  // Animate fill from left to right on mount/revisit, then ease to updated progress.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setDisplayedProgressPct(phasePct);
    });
    return () => cancelAnimationFrame(frame);
  }, [phasePct]);

  // ── DCA recommendation — user-configured daily amount; PASS when price ≥ live ATH ─
  let recommendedBuy: number | "PASS" | null = null;
  if (priceUSD !== null && inWindow) {
    recommendedBuy = priceUSD >= highPriceUSD ? "PASS" : dailyAmtAUD;
  }

  const isPass = recommendedBuy === "PASS";

  // ── Display helpers ────────────────────────────────────────────────────
  const centerLabel =
    phase === "save"  ? `${daysToStart}d`
    : phase === "hold"  ? "HOLD"
    : priceUSD === null ? "—"
    : isPass            ? "PASS"
    :                     `$${fmtAUD(dailyAmtAUD)}`;

  return (
    <>
    <section className="w-full px-1 py-1 sm:px-0">
      <div className="pb-1 pt-0">
        <p className="flex items-center gap-2 text-3xl font-semibold leading-none text-white sm:text-4xl">
          {phase === "dca" ? (
            <span
              className="material-symbols-outlined shrink-0 text-brand-500 text-[24px] leading-none"
              aria-label="Deploy phase"
              style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
            >
              database_upload
            </span>
          ) : phase === "save" ? (
            <span
              className="material-symbols-outlined shrink-0 text-brand-500 text-[24px] leading-none"
              aria-label="Reserve phase"
              style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
            >
              database_off
            </span>
          ) : (
            <span
              className="material-symbols-outlined shrink-0 text-brand-500 text-[24px] leading-none"
              aria-label="Hold phase"
              style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
            >
              database
            </span>
          )}
          {centerLabel}
        </p>
      </div>

      {/* 3-phase strategy thermometer */}
      <div className="pt-2 pb-3.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {phaseLabel}
            </span>
            <span className="text-[10px] tabular-nums font-medium text-gray-500 dark:text-gray-400">
              {phasePct.toFixed(1)}%
            </span>
          </div>
          <span className="flex items-center gap-0.5 text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
            <span
              className="material-symbols-outlined leading-none" style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"', fontSize: '8px' }}
            >
              hourglass
            </span>
            {phaseDaysLeft} days
          </span>
        </div>

        {/* Progress bar */}
        <div className="relative">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-out"
              style={{
                width: `${displayedProgressPct}%`,
                background: getCycleGradient(displayedProgressPct),
                backgroundSize: `${10000 / Math.max(displayedProgressPct, 1)}% 100%`,
                backgroundPosition: "left center",
                backgroundRepeat: "no-repeat",
              }}
            />
          </div>

          {/* Estimated trough ping (Deploy phase) */}
          {troughInDeployPct !== null && (
            <span
              className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${troughInDeployPct}%` }}
            >
              <span className="block h-2.5 w-2.5 rounded-full bg-green-400 ring-2 ring-green-400/30 animate-pulse" />
            </span>
          )}

          {/* Estimated peak ping (Hold phase) */}
          {peakInHoldPct !== null && (
            <span
              className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${peakInHoldPct}%` }}
            >
              <span className="block h-2.5 w-2.5 rounded-full bg-red-400 ring-2 ring-red-400/30 animate-pulse" />
            </span>
          )}
        </div>

      </div>

      {/* Signals grid — phase-specific psychological confirmation tiles */}
      {phase === "dca" ? (
        /* 🟢 Deploy: trough confirmation — 3 of 4 active → high-confidence */
        <div className="grid grid-cols-4 gap-1">
          <SignalItem
            active={deployMVRV}
            label="MVRV Z"
            sub={mvrvZScore !== null ? String(mvrvZScore) : "—"}
          />
          <SignalItem
            active={deployBelowWMA}
            label="Below 200W"
            sub={fmtK(lowPriceUSD)}
          />
          <SignalItem
            active={deployRSI}
            label="RSI < 35"
            sub={weeklyRSI !== null ? String(Math.round(weeklyRSI)) : "—"}
          />
          <SignalItem
            active={deployFear}
            label="F&G < 20"
            sub={fearGreed !== null ? String(fearGreed) : "—"}
          />
        </div>
      ) : phase === "hold" ? (
        /* 🟡 Hold: bull expansion confirmation */
        <div className="grid grid-cols-3 gap-1">
          <SignalItem
            active={holdNUPL}
            label="NUPL"
            sub={nupl !== null ? nupl.toFixed(2) : "—"}
          />
          <SignalItem
            active={holdGoldenCross}
            label="50W > 200W"
            sub={sma50w !== null ? fmtK(sma50w) : "—"}
          />
          <SignalItem
            active={holdFearGreed}
            label="F&G 60–85"
            sub={fearGreed !== null ? String(fearGreed) : "—"}
          />
        </div>
      ) : (
        /* 🔴 Reserve: peak / late-cycle confirmation */
        <div className="grid grid-cols-4 gap-1">
          <SignalItem
            active={reserveMVRV}
            label="MVRV Z"
            sub={mvrvZScore !== null ? String(mvrvZScore) : "—"}
          />
          <SignalItem
            active={reserveNUPL}
            label="NUPL"
            sub={nupl !== null ? nupl.toFixed(2) : "—"}
          />
          <SignalItem
            active={reserveRSI}
            label="RSI > 80"
            sub={weeklyRSI !== null ? String(Math.round(weeklyRSI)) : "—"}
          />
          <SignalItem
            active={reserveFear}
            label="F&G > 90"
            sub={fearGreed !== null ? String(fearGreed) : "—"}
          />
        </div>
      )}
    </section>

    </>
  );
}
