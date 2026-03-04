import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";
import { useEffect, useRef, useState } from "react";

// ── POC constants ──────────────────────────────────────────────────────────
// LOW_PRICE_USD and HIGH_PRICE_USD are now dynamic — see state below.
// These fallbacks are used only while the async fetch is in-flight.
const LOW_PRICE_USD_FALLBACK  = 55_000;
const HIGH_PRICE_USD_FALLBACK = 126_200; // current ATH at time of writing
const MAX_DCA_AUD    = 1_000;

// ── Cache config ───────────────────────────────────────────────────────────
const ATH_CACHE_KEY   = "btc-ath";          // shared with BtcLiveChart
const ATH_CACHE_TTL   = 86_400_000;         // 24 h
const WMA_CACHE_KEY   = "btc-200wma";
const WMA_CACHE_TTL   = 7 * 86_400_000;     // 7 days
const WMA_PERIOD      = 200;

// ── Cache helpers ──────────────────────────────────────────────────────────
function getCachedNumber(key: string, ttl: number): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { price: number; fetchedAt: number };
    if (Date.now() - entry.fetchedAt > ttl) return null;
    return entry.price;
  } catch { return null; }
}

function setCachedNumber(key: string, price: number): void {
  try {
    localStorage.setItem(key, JSON.stringify({ price, fetchedAt: Date.now() }));
  } catch { /* ignore storage quota errors */ }
}

// ── Binance weekly kline fetch ─────────────────────────────────────────────
// Returns array of [openTime_ms, open, high, low, close, ...]
type RawKline = [number, string, string, string, string, ...unknown[]];

async function fetchWeeklyKlines(signal: AbortSignal): Promise<RawKline[]> {
  // 250 weeks covers well over 200 data-points for the WMA calculation
  const url =
    "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=250";
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as RawKline[];
}

// ── Derive ATH and 200WMA from a weekly kline array ───────────────────────
function deriveATH(klines: RawKline[]): number | null {
  if (!klines.length) return null;
  let max = -Infinity;
  for (const k of klines) {
    const high = parseFloat(k[2]);
    if (!isNaN(high) && high > max) max = high;
  }
  return isFinite(max) ? max : null;
}

function derive200WMA(klines: RawKline[]): number | null {
  const closes = klines.map((k) => parseFloat(k[4])).filter((v) => !isNaN(v));
  if (closes.length < WMA_PERIOD) return null;
  const last200 = closes.slice(-WMA_PERIOD);
  return last200.reduce((s, v) => s + v, 0) / WMA_PERIOD;
}

const NEXT_HALVING_MS = new Date("2028-04-19T00:00:00Z").getTime();

// Signal thresholds
const FEAR_EXTREME_THRESHOLD = 20;
const FEAR_ACTIVE_THRESHOLD  = 40;
const DIFF_DROP_THRESHOLD    = -5;

// Boost percentages per signal
const BOOST_FEAR_EXTREME = 20;
const BOOST_FEAR_ACTIVE  = 10;
const BOOST_DIFF_DROP    = 10;
const BOOST_HALVING      = 10;

// Chart style tokens
const CHART_FONT     = "Inter, sans-serif";
const CHART_TRACK_BG = "#E5E5E7"; // light-mode track; matches gray-200

function roundToNearest50(n: number): number {
  return Math.round(n / 50) * 50;
}

// ── Signal indicator ───────────────────────────────────────────────────────
interface SignalItemProps {
  active: boolean;
  label: string;
  sub: string;
}

function SignalItem({ active, label, sub }: SignalItemProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-3 px-1">
      <div className="flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full shrink-0 transition-colors duration-500 ${
            active ? "bg-emerald-400" : "bg-gray-300 dark:bg-gray-600"
          }`}
        />
        <span
          className={`text-xs font-semibold text-center leading-tight transition-colors duration-300 ${
            active
              ? "text-gray-800 dark:text-white/90"
              : "text-gray-400 dark:text-gray-500"
          }`}
        >
          {label}
        </span>
      </div>
      <span
        className={`text-xs transition-colors duration-300 ${
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

  // ── Fetch weekly klines once on mount to derive ATH + 200WMA ────────────
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
          const wma = derive200WMA(klines);
          if (wma !== null && wma > 0) {
            setCachedNumber(WMA_CACHE_KEY, wma);
            setLowPriceUSD(wma);
          }
        }
      })
      .catch(() => { /* keep fallback values */ });
    return () => ctrl.abort();
  }, []);

  // Fear & Greed index
  useEffect(() => {
    fetch("https://api.alternative.me/fng/?limit=1&format=json")
      .then((r) => r.json())
      .then((d) => {
        const val = parseInt((d?.data?.[0]?.value as string) ?? "", 10);
        if (!isNaN(val)) setFearGreed(val);
      })
      .catch(() => {});
  }, []);

  // Mining difficulty — last retarget % from mempool.space
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

  // Binance WebSocket — live BTC/USDT price
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

  const msToHalving   = NEXT_HALVING_MS - Date.now();
  const daysToHalving = Math.max(0, Math.ceil(msToHalving / 86_400_000));
  const halvingActive = msToHalving > 0 && msToHalving <= 365 * 86_400_000;
  // Days until we enter the 365-day pre-halving buy window
  const daysToWindow  = Math.max(0, Math.ceil((msToHalving - 365 * 86_400_000) / 86_400_000));

  // ── Boost ──────────────────────────────────────────────────────────────
  let totalBoost = 0;
  if (fearExtreme)     totalBoost += BOOST_FEAR_EXTREME;
  else if (fearActive) totalBoost += BOOST_FEAR_ACTIVE;
  if (diffActive)      totalBoost += BOOST_DIFF_DROP;
  if (halvingActive)   totalBoost += BOOST_HALVING;

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
  const fmt = (n: number) =>
    n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const isPass    = recommendedBuy === "PASS";
  const isLoading = recommendedBuy === null;

  const buyRatio    = isPass || isLoading ? 0 : (recommendedBuy as number) / MAX_DCA_AUD;
  const color       = isPass || isLoading ? "#98a2b3" : "#FFD300";
  const chartValue  = isPass || isLoading ? 0 : Math.round(buyRatio * 100);
  const centerLabel = isLoading
    ? "—"
    : isPass
    ? "PASS"
    : `$${fmt(recommendedBuy as number)}`;

  // ── ApexCharts radial bar ──────────────────────────────────────────────
  const options: ApexOptions = {
    chart: {
      fontFamily: CHART_FONT,
      type: "radialBar",
      height: 340,
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
    fill: { type: "solid", colors: [color] },
    stroke: { lineCap: "round" },
    labels: ["Allocation"],
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-white/[0.03] h-full flex flex-col">
      <div className="px-5 pt-5 bg-white shadow-default rounded-2xl pb-6 dark:bg-gray-900 sm:px-6 sm:pt-6 flex-1">

        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
            4
          </span>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            DCA signal
          </h3>
        </div>

        {/* Radial bar — allocation % */}
        <div
          style={{
            transform: animate ? "scale(1.02)" : "scale(1)",
            transition: "transform 0.3s ease",
            position: "relative",
          }}
        >
          <Chart
            options={options}
            series={[chartValue]}
            type="radialBar"
            height={340}
          />
          {/* Centre label rendered as HTML so colour always matches the bar.
               bottom: ~18px sits the label closer to the gauge arc baseline;
               font-size 56px makes the amount more prominent while chart height
               stays at 340px so mobile layout is unaffected. */}
          <div
            style={{
              position: "absolute",
              bottom: "18px",
              left: 0,
              right: 0,
              textAlign: "center",
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                color,
                fontSize: "56px",
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

      {/* Signals footer */}
      <div className="grid grid-cols-3 divide-x divide-gray-200 dark:divide-gray-800">
        <SignalItem
          active={fearActive}
          label={fearExtreme ? "Extreme Fear" : "Fear & Greed"}
          sub={fearGreed !== null ? String(fearGreed) : "—"}
        />
        <SignalItem
          active={diffActive}
          label="Diff Drop"
          sub={diffChange !== null ? `${diffChange.toFixed(1)}%` : "—"}
        />
        <SignalItem
          active={halvingActive}
          label={halvingActive ? "Pre-Halving" : "Halving Window"}
          sub={halvingActive ? `${daysToHalving}d to halving` : `in ${daysToWindow}d`}
        />
      </div>
    </div>
  );
}
