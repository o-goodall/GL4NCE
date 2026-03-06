import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";
import { useEffect, useRef, useState, useCallback } from "react";
import { useModal } from "../../hooks/useModal";
import { Modal } from "../ui/modal";
import Button from "../ui/button/Button";
import Input from "../form/input/InputField";
import Label from "../form/Label";
import Checkbox from "../form/input/Checkbox";

// ── DCA window ─────────────────────────────────────────────────────────────
// Day 1 = 6 March 2026; Day 423 = 2 May 2027 ($245/day × 423d = $103,935 total)
const DCA_START_MS   = new Date("2026-03-06T00:00:00Z").getTime();
const DCA_END_MS     = DCA_START_MS + (423 - 1) * 86_400_000;
const DCA_WINDOW_DAYS = 423;
const YEARS_IN_CYCLE  = 4;
const WEEKS_PER_YEAR  = 52;
const DEFAULT_WEEKLY_AUD = 500; // $500/wk → $245/day

// ── Cache config ───────────────────────────────────────────────────────────
const ATH_CACHE_KEY      = "btc-ath";       // shared with BtcLiveChart
const ATH_CACHE_TTL      = 86_400_000;      // 24 h
const WMA_CACHE_KEY      = "btc-200wma";
const WMA_CACHE_TTL      = 7 * 86_400_000;  // 7 days
const WMA_PERIOD         = 200;
const DCA_SETTINGS_KEY   = "dca-settings";  // user's custom DCA config

// ── Signal thresholds (informational only — do not affect DCA amount) ──────
const FEAR_EXTREME_THRESHOLD = 20;
const FEAR_ACTIVE_THRESHOLD  = 40;
const DIFF_DROP_THRESHOLD    = -5;

// ── Fallbacks while async fetches are in-flight ────────────────────────────
const LOW_PRICE_USD_FALLBACK  = 55_000;
const HIGH_PRICE_USD_FALLBACK = 126_200; // used only until live ATH is fetched

// ── Halving cycle ──────────────────────────────────────────────────────────
const PREV_HALVING_MS     = new Date("2024-04-20T00:00:00Z").getTime();
const NEXT_HALVING_MS     = new Date("2028-04-19T00:00:00Z").getTime();
const POST_HALVING_WINDOW = 547 * 86_400_000; // ≈ 18 months after halving

// ── Historical + projected market cycle dates ──────────────────────────────
// Peaks (market highs) — projected dates based on ~4-year halving cycle rhythm
const CYCLE_PEAKS_MS: number[] = [
  new Date("2013-12-04T00:00:00Z").getTime(),
  new Date("2017-12-16T00:00:00Z").getTime(),
  new Date("2021-11-18T00:00:00Z").getTime(),
  new Date("2025-12-06T00:00:00Z").getTime(), // projected
];
// Troughs (market lows) — projected dates based on historical cycle patterns
const CYCLE_TROUGHS_MS: number[] = [
  new Date("2015-01-14T00:00:00Z").getTime(),
  new Date("2018-12-15T00:00:00Z").getTime(),
  new Date("2022-11-21T00:00:00Z").getTime(),
  new Date("2028-12-15T00:00:00Z").getTime(), // projected
];
const CYCLE_ZONE_RADIUS = 90 * 86_400_000; // 90 days either side of peak/trough

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

/** $X/week → daily buy within the 423-day window (floor = conservative) */
function calcDailyAmt(weeklyAmtAUD: number): number {
  const total = weeklyAmtAUD * WEEKS_PER_YEAR * YEARS_IN_CYCLE;
  return Math.floor(total / DCA_WINDOW_DAYS);
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

function saveDcaSettings(s: DcaSettings): void {
  try { localStorage.setItem(DCA_SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
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

// ── Cycle phase detection (peak / trough proximity) ────────────────────────
type CyclePhase = "near-peak" | "near-trough" | "mid-cycle";
type NearestEvent = "peak" | "trough";

function getCyclePhase(now: number): { phase: CyclePhase; daysAway: number; nearest: NearestEvent } {
  let nearestPeakDist = Infinity;
  for (const p of CYCLE_PEAKS_MS) {
    const d = Math.abs(now - p);
    if (d < nearestPeakDist) nearestPeakDist = d;
  }
  let nearestTroughDist = Infinity;
  for (const t of CYCLE_TROUGHS_MS) {
    const d = Math.abs(now - t);
    if (d < nearestTroughDist) nearestTroughDist = d;
  }

  if (nearestPeakDist <= CYCLE_ZONE_RADIUS) {
    return { phase: "near-peak", daysAway: Math.round(nearestPeakDist / 86_400_000), nearest: "peak" };
  }
  if (nearestTroughDist <= CYCLE_ZONE_RADIUS) {
    return { phase: "near-trough", daysAway: Math.round(nearestTroughDist / 86_400_000), nearest: "trough" };
  }
  // Mid-cycle: report distance to the closer upcoming event
  const peakCloser = nearestPeakDist < nearestTroughDist;
  return {
    phase: "mid-cycle",
    daysAway: Math.round((peakCloser ? nearestPeakDist : nearestTroughDist) / 86_400_000),
    nearest: peakCloser ? "peak" : "trough",
  };
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

  // ── User DCA settings ─────────────────────────────────────────────────
  const [dcaSettings, setDcaSettings] = useState<DcaSettings>(loadDcaSettings);
  const [activeSlot,  setActiveSlot]  = useState<1 | 2>(1);

  // Settings modal state
  const { isOpen: settingsOpen, openModal, closeModal } = useModal();
  const [formWeekly1,     setFormWeekly1]     = useState("");
  const [formWeekly2,     setFormWeekly2]     = useState("");
  const [formEnableSlot2, setFormEnableSlot2] = useState(false);

  const openSettings = useCallback(() => {
    setFormWeekly1(String(dcaSettings.slot1.weeklyAmtAUD));
    setFormWeekly2(dcaSettings.slot2 ? String(dcaSettings.slot2.weeklyAmtAUD) : "");
    setFormEnableSlot2(!!dcaSettings.slot2);
    openModal();
  }, [dcaSettings, openModal]);

  function handleSaveSettings() {
    const w1 = parseFloat(formWeekly1);
    if (!isFinite(w1) || w1 <= 0) return;
    const next: DcaSettings = { slot1: { weeklyAmtAUD: w1 } };
    if (formEnableSlot2) {
      const w2 = parseFloat(formWeekly2);
      if (isFinite(w2) && w2 > 0) next.slot2 = { weeklyAmtAUD: w2 };
    }
    saveDcaSettings(next);
    setDcaSettings(next);
    if (activeSlot === 2 && !next.slot2) setActiveSlot(1);
    closeModal();
  }

  // Active daily amount derived from selected slot
  const activeConfig  = activeSlot === 2 && dcaSettings.slot2 ? dcaSettings.slot2 : dcaSettings.slot1;
  const dailyAmtAUD   = calcDailyAmt(activeConfig.weeklyAmtAUD);
  const hasSlot2      = !!dcaSettings.slot2;

  // Preview amounts for the settings form
  const preview1 = (() => {
    const w = parseFloat(formWeekly1);
    return isFinite(w) && w > 0 ? calcDailyAmt(w) : null;
  })();
  const preview2 = (() => {
    const w = parseFloat(formWeekly2);
    return isFinite(w) && w > 0 ? calcDailyAmt(w) : null;
  })();

  const prevBuy   = useRef<number | "PASS" | null>(null);
  const [animate, setAnimate] = useState(false);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch weekly klines (live ATH + 200WMA) ─────────────────────────────
  useEffect(() => {
    const cachedATH = getCachedNumber(ATH_CACHE_KEY, ATH_CACHE_TTL);
    const cachedWMA = getCachedNumber(WMA_CACHE_KEY, WMA_CACHE_TTL);
    if (cachedATH !== null) setHighPriceUSD(cachedATH);
    if (cachedWMA !== null) setLowPriceUSD(cachedWMA);
    if (cachedATH !== null && cachedWMA !== null) return;

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

  const msToHalving   = NEXT_HALVING_MS - Date.now();
  const daysToHalving = Math.max(0, Math.ceil(msToHalving / 86_400_000));
  const halvingActive = msToHalving > 0 && msToHalving <= 365 * 86_400_000;

  // Post-halving accumulation phase (BSP cycle-awareness)
  const msSinceHalving    = Date.now() - PREV_HALVING_MS;
  const daysSinceHalving  = Math.max(0, Math.floor(msSinceHalving / 86_400_000));
  const postHalvingActive = msSinceHalving > 0 && msSinceHalving <= POST_HALVING_WINDOW;

  // Cycle peak/trough proximity (historical + projected cycle dates)
  const { phase: cyclePhase, daysAway: cycleDaysAway, nearest: cycleNearest } = getCyclePhase(Date.now());
  const nearPeak   = cyclePhase === "near-peak";
  const nearTrough = cyclePhase === "near-trough";

  // ── DCA window ─────────────────────────────────────────────────────────
  const now        = Date.now();
  const inWindow   = now >= DCA_START_MS && now <= DCA_END_MS;
  const daysToStart = Math.max(0, Math.ceil((DCA_START_MS - now) / 86_400_000));

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
    now < DCA_START_MS ? `${daysToStart}d`
    : now > DCA_END_MS  ? "Done"
    : priceUSD === null  ? "—"
    : isPass             ? "PASS"
    :                      `$${fmtAUD(dailyAmtAUD)}`;

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
    <div className="rounded-2xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-white/[0.03] h-full flex flex-col">
      <div className="px-5 pt-5 bg-white shadow-default rounded-2xl pb-2 dark:bg-gray-900 sm:px-6 sm:pt-6 flex-1 flex flex-col">

        {/* Header — title + pill toggle + settings gear */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              DCA signal
            </h3>
            {/* Pill toggle — only shown when a second DCA is configured */}
            {hasSlot2 && (
              <div className="flex items-center rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-0.5 gap-0.5">
                <button
                  onClick={() => setActiveSlot(1)}
                  className={`px-2.5 py-0.5 rounded-full text-xs font-semibold transition-colors ${
                    activeSlot === 1
                      ? "bg-brand-500 text-gray-900"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  1
                </button>
                <button
                  onClick={() => setActiveSlot(2)}
                  className={`px-2.5 py-0.5 rounded-full text-xs font-semibold transition-colors ${
                    activeSlot === 2
                      ? "bg-brand-500 text-gray-900"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  2
                </button>
              </div>
            )}
          </div>
          {/* Settings gear */}
          <button
            onClick={openSettings}
            title="Configure DCA"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                fillRule="evenodd" clipRule="evenodd"
                d="M12 1a1 1 0 0 1 .97.757l.524 2.094a7.967 7.967 0 0 1 1.716.71l1.88-1.127a1 1 0 0 1 1.225.155l1.096 1.096a1 1 0 0 1 .155 1.225l-1.126 1.88a7.967 7.967 0 0 1 .71 1.716l2.094.524A1 1 0 0 1 22 11v2a1 1 0 0 1-.757.97l-2.094.524a7.965 7.965 0 0 1-.71 1.716l1.126 1.88a1 1 0 0 1-.155 1.225l-1.096 1.096a1 1 0 0 1-1.225.155l-1.88-1.126a7.965 7.965 0 0 1-1.716.71l-.524 2.094A1 1 0 0 1 12 23a1 1 0 0 1-.97-.757l-.524-2.094a7.965 7.965 0 0 1-1.716-.71l-1.88 1.126a1 1 0 0 1-1.225-.155l-1.096-1.096a1 1 0 0 1-.155-1.225l1.126-1.88a7.965 7.965 0 0 1-.71-1.716L2.757 14A1 1 0 0 1 2 13v-2a1 1 0 0 1 .757-.97l2.094-.524a7.967 7.967 0 0 1 .71-1.716L4.435 5.91a1 1 0 0 1 .155-1.225l1.096-1.096a1 1 0 0 1 1.225-.155l1.88 1.127a7.967 7.967 0 0 1 1.716-.71L11.03 1.757A1 1 0 0 1 12 1Zm0 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

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

      {/* Signals footer — 6 signals */}
      <div className="grid grid-cols-6 divide-x divide-gray-200 dark:divide-gray-800">
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
          active={halvingActive || postHalvingActive}
          label={
            postHalvingActive  ? "Post-Halv"
            : halvingActive    ? "Pre-Halving"
            :                    "Halving"
          }
          sub={
            postHalvingActive ? `${daysSinceHalving}d ago` : `${daysToHalving}d`
          }
        />
        <SignalItem
          active={nearPeak || nearTrough}
          label={
            nearPeak    ? "Near Peak"
            : nearTrough ? "Near Trough"
            :              "Mid-Cycle"
          }
          sub={
            nearPeak || nearTrough
              ? `${cycleDaysAway}d`
              : `${cycleNearest} ${cycleDaysAway}d`
          }
        />
        <SignalItem
          active={belowWMA}
          label="Below WMA"
          sub={fmtK(lowPriceUSD)}
        />
        <SignalItem
          active={isPass}
          label="At ATH"
          sub={fmtK(highPriceUSD)}
        />
      </div>
    </div>

    {/* ── DCA Settings modal ──────────────────────────────────────────────── */}
    <Modal isOpen={settingsOpen} onClose={closeModal} className="max-w-[480px] m-4">
      <div className="no-scrollbar relative w-full overflow-y-auto rounded-3xl bg-white p-6 dark:bg-gray-900 lg:p-8">
        <div className="mb-6">
          <h4 className="text-xl font-semibold text-gray-800 dark:text-white/90">
            DCA Settings
          </h4>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Enter your weekly investment amount. The system calculates your optimal daily buy
            for the <strong className="text-gray-700 dark:text-gray-300">423-day</strong> accumulation window based on a 4-year cycle.
          </p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); handleSaveSettings(); }}
          className="flex flex-col gap-5"
        >
          {/* DCA 1 */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">DCA 1</p>
            <div>
              <Label htmlFor="dca1-weekly">Weekly amount (AUD)</Label>
              <Input
                id="dca1-weekly"
                type="number"
                placeholder="e.g. 500"
                min="1"
                step={1}
                value={formWeekly1}
                onChange={(e) => setFormWeekly1(e.target.value)}
              />
            </div>
            {preview1 !== null && (
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-sm">${fmtAUD(preview1)}/day</span>
                  {" "}× 423 days
                </div>
                <div>= ${fmtAUD(preview1 * DCA_WINDOW_DAYS)} total over {YEARS_IN_CYCLE} years</div>
                <div className="text-gray-400 dark:text-gray-500">
                  (${fmtAUD(parseFloat(formWeekly1) * WEEKS_PER_YEAR)}/year × {YEARS_IN_CYCLE} ÷ {DCA_WINDOW_DAYS} days)
                </div>
              </div>
            )}
          </div>

          {/* Enable second DCA */}
          <Checkbox
            checked={formEnableSlot2}
            onChange={setFormEnableSlot2}
            label="Add a second DCA strategy"
          />

          {/* DCA 2 */}
          {formEnableSlot2 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">DCA 2</p>
              <div>
                <Label htmlFor="dca2-weekly">Weekly amount (AUD)</Label>
                <Input
                  id="dca2-weekly"
                  type="number"
                  placeholder="e.g. 200"
                  min="1"
                  step={1}
                  value={formWeekly2}
                  onChange={(e) => setFormWeekly2(e.target.value)}
                />
              </div>
              {preview2 !== null && (
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                  <div>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-sm">${fmtAUD(preview2)}/day</span>
                    {" "}× 423 days
                  </div>
                  <div>= ${fmtAUD(preview2 * DCA_WINDOW_DAYS)} total over {YEARS_IN_CYCLE} years</div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            <Button size="sm" variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveSettings}>
              Save
            </Button>
          </div>
        </form>
      </div>
    </Modal>
    </>
  );
}
