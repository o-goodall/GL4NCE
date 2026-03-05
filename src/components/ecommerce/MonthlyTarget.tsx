import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";
import { useEffect, useRef, useState } from "react";

// ── Fallback constants (used while async fetches are in-flight) ────────────
const LOW_PRICE_USD_FALLBACK  = 55_000;
const HIGH_PRICE_USD_FALLBACK = 126_200;
const MAX_DCA_AUD             = 1_000;

// ── Cache config ───────────────────────────────────────────────────────────
const ATH_CACHE_KEY = "btc-ath";       // shared with BtcLiveChart
const ATH_CACHE_TTL = 86_400_000;      // 24 h
const WMA_CACHE_KEY = "btc-200wma";
const WMA_CACHE_TTL = 7 * 86_400_000;  // 7 days
const WMA_PERIOD    = 200;

// ── Signal thresholds ──────────────────────────────────────────────────────
const FEAR_EXTREME_THRESHOLD = 20;
const FEAR_ACTIVE_THRESHOLD  = 40;
const DIFF_DROP_THRESHOLD    = -5;

// ── Boost percentages per signal ───────────────────────────────────────────
const BOOST_FEAR_EXTREME = 20;
const BOOST_FEAR_ACTIVE  = 10;
const BOOST_DIFF_DROP    = 10;
const BOOST_HALVING      = 10;
const BOOST_POST_HALVING = 10; // post-halving accumulation phase (BSP cycle insight)
const BOOST_BELOW_WMA    = 25; // price below 200WMA = historically rare extreme buy zone
const BOOST_NEAR_TROUGH  = 15; // near projected cycle trough = historically best accumulation
const DAMPEN_NEAR_PEAK   = -10; // near projected cycle peak = reduce exposure

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

// ── Helpers ────────────────────────────────────────────────────────────────
function roundToNearest50(n: number): number {
  return Math.round(n / 50) * 50;
}

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

  // Dynamic price boundaries
  const [lowPriceUSD,  setLowPriceUSD]  = useState<number>(LOW_PRICE_USD_FALLBACK);
  const [highPriceUSD, setHighPriceUSD] = useState<number>(HIGH_PRICE_USD_FALLBACK);

  const prevBuy   = useRef<number | "PASS" | null>(null);
  const [animate, setAnimate] = useState(false);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch weekly klines (ATH + 200WMA) ──────────────────────────────────
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
            // Update ATH if live price exceeds stored value
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
  const daysToWindow  = Math.max(0, Math.ceil((msToHalving - 365 * 86_400_000) / 86_400_000));

  // Post-halving accumulation phase (BSP cycle-awareness)
  const msSinceHalving    = Date.now() - PREV_HALVING_MS;
  const daysSinceHalving  = Math.max(0, Math.floor(msSinceHalving / 86_400_000));
  const postHalvingActive = msSinceHalving > 0 && msSinceHalving <= POST_HALVING_WINDOW;

  // Cycle peak/trough proximity (historical + projected cycle dates)
  const { phase: cyclePhase, daysAway: cycleDaysAway, nearest: cycleNearest } = getCyclePhase(Date.now());
  const nearPeak   = cyclePhase === "near-peak";
  const nearTrough = cyclePhase === "near-trough";

  // ── Boost ──────────────────────────────────────────────────────────────
  let totalBoost = 0;
  if (fearExtreme)     totalBoost += BOOST_FEAR_EXTREME;
  else if (fearActive) totalBoost += BOOST_FEAR_ACTIVE;
  if (diffActive)      totalBoost += BOOST_DIFF_DROP;
  // Post-halving and pre-halving are mutually exclusive phases of the same
  // 4-year cycle, so only one boost can apply at a time.
  if (halvingActive)   totalBoost += BOOST_HALVING;
  else if (postHalvingActive) totalBoost += BOOST_POST_HALVING;
  if (belowWMA)        totalBoost += BOOST_BELOW_WMA;
  // Cycle peak/trough: dampen near peaks, boost near troughs
  if (nearPeak)        totalBoost += DAMPEN_NEAR_PEAK;
  else if (nearTrough) totalBoost += BOOST_NEAR_TROUGH;

  // ── DCA calculation ────────────────────────────────────────────────────
  let recommendedBuy: number | "PASS" | null = null;
  let allocationPct = 0;

  if (priceUSD !== null) {
    if (priceUSD > highPriceUSD) {
      recommendedBuy = "PASS";
    } else {
      allocationPct = Math.max(
        0,
        Math.min(
          1,
          1 - (priceUSD - lowPriceUSD) / (highPriceUSD - lowPriceUSD)
        )
      );
      const rawBuy = MAX_DCA_AUD * allocationPct * (1 + totalBoost / 100);
      recommendedBuy = roundToNearest50(Math.min(rawBuy, MAX_DCA_AUD));
    }
  }

  // ── Gauge colour ──────────────────────────────────────────────────────
  let gaugeColor = "#98a2b3";

  if (priceUSD !== null) {
    if (priceUSD > highPriceUSD) {
      gaugeColor    = "#EF4444";
    } else if (belowWMA || (allocationPct >= 0.85 && totalBoost >= 20)) {
      gaugeColor    = "#10B981";
    } else if (allocationPct >= 0.45 || totalBoost >= 10) {
      gaugeColor    = "#FFD300";
    } else {
      gaugeColor    = "#F59E0B";
    }
  }

  // Subtle scale animation when buy amount changes
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
  const isPass    = recommendedBuy === "PASS";
  const isLoading = recommendedBuy === null;

  const buyRatio   = isPass || isLoading ? 0 : (recommendedBuy as number) / MAX_DCA_AUD;
  const chartValue = isPass || isLoading ? 0 : Math.round(buyRatio * 100);
  const centerLabel = isLoading
    ? "—"
    : isPass
    ? "PASS"
    : `$${fmtAUD(recommendedBuy as number)}`;

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
    <div className="rounded-2xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-white/[0.03] h-full flex flex-col">
      <div className="px-5 pt-5 bg-white shadow-default rounded-2xl pb-2 dark:bg-gray-900 sm:px-6 sm:pt-6 flex-1 flex flex-col">

        {/* Header — title */}
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            DCA signal
          </h3>
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

      {/* Signals footer — 5 signals */}
      <div className="grid grid-cols-5 divide-x divide-gray-200 dark:divide-gray-800">
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
            postHalvingActive  ? `${daysSinceHalving}d ago`
            : halvingActive    ? `${daysToHalving}d`
            :                    `in ${daysToWindow}d`
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
      </div>
    </div>
  );
}
