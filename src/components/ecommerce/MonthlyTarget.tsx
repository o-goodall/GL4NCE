import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";
import { useEffect, useRef, useState } from "react";

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

// ── Signal thresholds (informational only — do not affect DCA amount) ──────
const FEAR_EXTREME_THRESHOLD = 20;
const FEAR_ACTIVE_THRESHOLD  = 40;
const DIFF_DROP_THRESHOLD    = -5;
const RSI_PERIOD     = 14;   // 14-week Wilder's RSI
const RSI_OVERSOLD   = 30;   // weekly RSI ≤ 30 → bear-market trough territory confirmed
const RSI_OVERBOUGHT = 70;   // weekly RSI ≥ 70 → bull-market peak territory confirmed
const CYCLE_ZONE_DAYS = 90;  // within ±90 days of a known/projected cycle event = "in window"

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

// ── Fallbacks while async fetches are in-flight ────────────────────────────
const LOW_PRICE_USD_FALLBACK  = 55_000;
const HIGH_PRICE_USD_FALLBACK = 126_200; // used only until live ATH is fetched

// ── Halving cycle ──────────────────────────────────────────────────────────
const PREV_HALVING_MS     = new Date("2024-04-20T00:00:00Z").getTime();
const NEXT_HALVING_MS     = new Date("2028-04-19T00:00:00Z").getTime();
const POST_HALVING_WINDOW = 547 * 86_400_000; // ≈ 18 months after halving
const PRE_HALVING_WINDOW  = 365 * 86_400_000; // ≤ 12 months before next halving

// ── Chart style ────────────────────────────────────────────────────────────
const CHART_FONT     = "Inter, sans-serif";
const CHART_TRACK_BG = "#E5E5E7";

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

// ── Nearest date in a cycle series ────────────────────────────────────────
interface CycleDateInfo { daysAway: number; isPast: boolean }

function nearestCycleDate(now: number, datesMs: readonly number[]): CycleDateInfo | null {
  if (!datesMs.length) return null;
  let minDist = Infinity;
  let nearest = 0;
  for (const d of datesMs) {
    const dist = Math.abs(now - d);
    if (dist < minDist) { minDist = dist; nearest = d; }
  }
  return { daysAway: Math.round(minDist / 86_400_000), isPast: nearest < now };
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
            active ? "bg-emerald-400" : "bg-gray-300 dark:bg-gray-600"
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
            ? "text-emerald-500 dark:text-emerald-400"
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
  const [diffChange, setDiffChange] = useState<number | null>(null);

  // 200-week moving average (for Below-WMA signal)
  const [lowPriceUSD,  setLowPriceUSD]  = useState<number>(LOW_PRICE_USD_FALLBACK);
  // Live ATH — PASS threshold (pauses DCA when price ≥ all-time high)
  const [highPriceUSD, setHighPriceUSD] = useState<number>(HIGH_PRICE_USD_FALLBACK);
  // 14-week RSI — live confirmation for cycle trough/peak windows
  const [weeklyRSI, setWeeklyRSI] = useState<number | null>(null);

  // ── User DCA settings ─────────────────────────────────────────────────
  const [dcaSettings] = useState<DcaSettings>(loadDcaSettings);

  // Active daily amount derived from selected slot
  const activeConfig  = dcaSettings.slot1;
  const dailyAmtAUD   = calcDailyAmt(activeConfig.weeklyAmtAUD);



  const prevBuy   = useRef<number | "PASS" | null>(null);
  const [animate, setAnimate] = useState(false);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch weekly klines (live ATH + 200WMA + 14-week RSI) ──────────────
  useEffect(() => {
    const cachedATH = getCachedNumber(ATH_CACHE_KEY, ATH_CACHE_TTL);
    const cachedWMA = getCachedNumber(WMA_CACHE_KEY, WMA_CACHE_TTL);
    const cachedRSI = getCachedNumber(RSI_CACHE_KEY, RSI_CACHE_TTL);

    if (cachedATH !== null) setHighPriceUSD(cachedATH);
    if (cachedWMA !== null) setLowPriceUSD(cachedWMA);
    if (cachedRSI !== null) setWeeklyRSI(cachedRSI);

    if (cachedATH !== null && cachedWMA !== null && cachedRSI !== null) return;

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

  // ── Mining difficulty — last retarget % from mempool.space ───────────────
  useEffect(() => {
    fetch("https://mempool.space/api/v1/difficulty-adjustment")
      .then((r) => r.json())
      .then((d: unknown) => {
        if (d !== null && typeof d === "object" && "previousRetarget" in d) {
          const val = parseFloat(String((d as Record<string, unknown>).previousRetarget));
          if (!isNaN(val)) setDiffChange(val);
        }
      })
      .catch(() => {});
  }, []);

  // ── Binance WebSocket — live BTC/USDT price ──────────────────────────────
  useEffect(() => {
    const ws = new WebSocket(
      "wss://stream.binance.com:9443/stream?streams=btcusdt@ticker"
    );
    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as {
          data?: Record<string, string>;
        };
        const raw = msg?.data?.["c"];
        if (raw !== undefined) {
          const price = parseFloat(raw);
          if (!isNaN(price)) {
            setPriceUSD(price);
            // Keep ATH up-to-date as BTC makes new highs (future-proofing)
            setHighPriceUSD((prev) => {
              if (price > prev) {
                setCachedNumber(ATH_CACHE_KEY, price);
                return price;
              }
              return prev;
            });
          }
        }
      } catch { /* ignore malformed frames */ }
    };
    if (import.meta.env.DEV) {
      ws.onerror = () => console.error("[DCAWidget] WebSocket error");
    }
    return () => {
      if (
        ws.readyState !== WebSocket.CLOSED &&
        ws.readyState !== WebSocket.CLOSING
      ) ws.close();
    };
  }, []);

  // ── Signal states ──────────────────────────────────────────────────────
  const fearExtreme = fearGreed !== null && fearGreed <= FEAR_EXTREME_THRESHOLD;
  const fearActive  = fearGreed !== null && fearGreed <= FEAR_ACTIVE_THRESHOLD;
  const diffActive  = diffChange !== null && diffChange < DIFF_DROP_THRESHOLD;
  const belowWMA    = priceUSD !== null && priceUSD < lowPriceUSD;
  const aboveWMA    = priceUSD !== null && priceUSD >= lowPriceUSD;

  const msToHalving   = NEXT_HALVING_MS - Date.now();
  const daysToHalving = Math.max(0, Math.ceil(msToHalving / 86_400_000));
  const halvingActive = msToHalving > 0 && msToHalving <= PRE_HALVING_WINDOW;

  // Post-halving accumulation phase (BSP cycle-awareness)
  const msSinceHalving    = Date.now() - PREV_HALVING_MS;
  const daysSinceHalving  = Math.max(0, Math.floor(msSinceHalving / 86_400_000));
  const postHalvingActive = msSinceHalving > 0 && msSinceHalving <= POST_HALVING_WINDOW;

  // Hybrid cycle signals: historical window (hardcoded accurate dates) + live RSI confirmation.
  // nearTroughActive = within ±90 days of a confirmed/projected trough AND RSI ≤ 30 (oversold)
  // nearPeakActive   = within ±90 days of a confirmed/projected peak   AND RSI ≥ 70 (overbought)
  const now           = Date.now();
  const nearestTrough = nearestCycleDate(now, CYCLE_TROUGHS_MS);
  const nearestPeak   = nearestCycleDate(now, CYCLE_PEAKS_MS);
  const inTroughWindow  = nearestTrough !== null && nearestTrough.daysAway <= CYCLE_ZONE_DAYS;
  const inPeakWindow    = nearestPeak   !== null && nearestPeak.daysAway   <= CYCLE_ZONE_DAYS;
  const nearTroughActive = inTroughWindow && weeklyRSI !== null && weeklyRSI <= RSI_OVERSOLD;
  const nearPeakActive   = inPeakWindow   && weeklyRSI !== null && weeklyRSI >= RSI_OVERBOUGHT;

  // ── DCA window ─────────────────────────────────────────────────────────
  const inWindow   = now >= DCA_START_MS && now <= DCA_END_MS;
  const daysToStart = Math.max(0, Math.ceil((DCA_START_MS - now) / 86_400_000));

  // ── Strategy phase (3-phase: Save → DCA → Hold) ─────────────────────────
  // Derived from DCA_START_MS / DCA_END_MS — no hardcoded calendar dates here.
  const phase       = getDcaPhase(now);
  const isHoldPhase = phase === "hold";   // capital deployed; show hold signals
  const phaseLabel  =
    phase === "save" ? "Phase 1 · Save"
    : phase === "dca"  ? "Phase 2 · DCA"
    :                    "Phase 3 · Hold";

  // ── DCA recommendation — user-configured daily amount; PASS when price ≥ live ATH ─
  let recommendedBuy: number | "PASS" | null = null;
  if (priceUSD !== null && inWindow) {
    recommendedBuy = priceUSD >= highPriceUSD ? "PASS" : dailyAmtAUD;
  }

  // ── Gauge colour ──────────────────────────────────────────────────────
  let gaugeColor = "#98a2b3";
  const isPass = recommendedBuy === "PASS";
  if (isPass) {
    gaugeColor = "#EF4444";
  } else if (inWindow && priceUSD !== null) {
    gaugeColor = belowWMA ? "#10B981" : "#FFD300";
  }

  // Subtle scale animation when recommendation changes
  useEffect(() => {
    if (recommendedBuy !== null && recommendedBuy !== prevBuy.current) {
      if (prevBuy.current !== null) {
        setAnimate(true);
        if (animTimer.current) clearTimeout(animTimer.current);
        animTimer.current = setTimeout(() => setAnimate(false), 500);
      }
      prevBuy.current = recommendedBuy;
    }
    return () => {
      if (animTimer.current) clearTimeout(animTimer.current);
    };
  }, [recommendedBuy]);

  // ── Display helpers ────────────────────────────────────────────────────
  const chartValue = typeof recommendedBuy === "number" ? 100 : 0;
  const centerLabel =
    phase === "save"  ? `${daysToStart}d`
    : phase === "hold"  ? "HOLD"
    : priceUSD === null ? "—"
    : isPass            ? "PASS"
    :                     `$${fmtAUD(dailyAmtAUD)}`;

  // ── ApexCharts radial bar ──────────────────────────────────────────────
  const options: ApexOptions = {
    chart: {
      fontFamily: CHART_FONT,
      type: "radialBar",
      height: 280,
      sparkline: { enabled: true },
    },
    plotOptions: {
      radialBar: {
        startAngle: -85,
        endAngle: 85,
        hollow: { size: "80%" },
        track: {
          background: CHART_TRACK_BG,
          strokeWidth: "100%",
          margin: 5,
        },
        dataLabels: {
          name: { show: false },
          value: { show: false },
        },
      },
    },
    fill: { type: "solid", colors: [gaugeColor] },
    stroke: { lineCap: "round" },
    labels: ["Allocation"],
  };

  return (
    <>
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] h-full flex flex-col">
      <div className="px-5 pt-5 bg-white shadow-default rounded-2xl pb-2 dark:bg-gray-900 sm:px-6 sm:pt-6 flex-1 flex flex-col">

        {/* Chart + label section — fills remaining card height, centres content */}
        <div className="flex-1 flex flex-col justify-center">
          {/* Radial bar — allocation % */}
          <div
            style={{
              position: "relative",
              transform: animate ? "scale(1.02)" : "scale(1)",
              transition: "transform 0.3s ease",
            }}
          >
            <Chart
              options={options}
              series={[chartValue]}
              type="radialBar"
              height={280}
            />

            {/* Recommended buy amount — bottom edge aligned with the arc endpoints.
                The label's containing block is the position:relative wrapper
                (height ~135px). ApexCharts renders the 280px-chart SVG at 300px,
                overflowing the wrapper by ~56px upward. The arc endpoints sit
                ~129px below the wrapper's top, leaving ~6px to the wrapper's
                bottom. Setting bottom:"6px" aligns the text's bottom edge flush
                with the arc tips (the lowest visible points of the curved bar). */}
            <div
              style={{
                position: "absolute",
                bottom: "6px",
                left: 0,
                right: 0,
                textAlign: "center",
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  color: gaugeColor,
                  fontSize: "clamp(36px, 9vw, 52px)",
                  fontWeight: 600,
                  fontFamily: CHART_FONT,
                  lineHeight: 1,
                  transition: "color 0.3s ease",
                }}
              >
                {centerLabel}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Phase label + signals footer */}
      <div className={`flex items-center justify-center gap-1.5 px-4 py-1.5 border-t border-gray-200 dark:border-gray-800 ${
        phase === "save" ? "bg-amber-50/60 dark:bg-amber-900/10"
        : phase === "dca"  ? "bg-emerald-50/60 dark:bg-emerald-900/10"
        :                    "bg-sky-50/60 dark:bg-sky-900/10"
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          phase === "save" ? "bg-amber-400"
          : phase === "dca"  ? "bg-emerald-400"
          :                    "bg-sky-400"
        }`} />
        <span className="text-[10px] font-semibold tracking-wide uppercase text-gray-500 dark:text-gray-400">
          {phaseLabel}
        </span>
      </div>

      {/* Signals grid — 4 contextual tiles per phase */}
      <div className="grid grid-cols-4 divide-x divide-gray-200 dark:divide-gray-800">
        {!isHoldPhase ? (
          <>
            {/* Phase 1 (Save) + Phase 2 (DCA): accumulation/deployment signals */}
            <SignalItem
              active={fearActive}
              label={fearExtreme ? "Ext. Fear" : "Fear/Greed"}
              sub={fearGreed !== null ? String(fearGreed) : "—"}
            />
            <SignalItem
              active={diffActive}
              label="Diff Drop"
              sub={diffChange !== null ? `${diffChange.toFixed(1)}%` : "—"}
            />
            <SignalItem
              active={belowWMA}
              label="Below WMA"
              sub={fmtK(lowPriceUSD)}
            />
            <SignalItem
              active={nearTroughActive}
              label={inTroughWindow ? "Near Trough" : "Cycle Trough"}
              sub={
                inTroughWindow
                  ? weeklyRSI !== null ? `RSI ${Math.round(weeklyRSI)}` : "—"
                  : nearestTrough !== null
                    ? nearestTrough.isPast ? `${nearestTrough.daysAway}d ago` : `in ${nearestTrough.daysAway}d`
                    : "—"
              }
            />
          </>
        ) : (
          <>
            {/* Phase 3 (Hold): bull/hold signals — track the post-DCA bull run */}
            <SignalItem
              active={halvingActive || postHalvingActive}
              label={
                postHalvingActive ? "Post-Halv"
                : halvingActive   ? "Pre-Halving"
                :                   "Halving"
              }
              sub={
                postHalvingActive ? `${daysSinceHalving}d ago` : `${daysToHalving}d`
              }
            />
            <SignalItem
              active={aboveWMA}
              label="Above WMA"
              sub={fmtK(lowPriceUSD)}
            />
            <SignalItem
              active={nearPeakActive}
              label={inPeakWindow ? "Near Peak" : "Cycle Peak"}
              sub={
                inPeakWindow
                  ? weeklyRSI !== null ? `RSI ${Math.round(weeklyRSI)}` : "—"
                  : nearestPeak !== null
                    ? nearestPeak.isPast ? `${nearestPeak.daysAway}d ago` : `in ${nearestPeak.daysAway}d`
                    : "—"
              }
            />
            <SignalItem
              active={isPass}
              label="At ATH"
              sub={fmtK(highPriceUSD)}
            />
          </>
        )}
      </div>
    </div>

    </>
  );
}
