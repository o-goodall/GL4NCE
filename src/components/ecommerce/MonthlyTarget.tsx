import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";
import { useEffect, useRef, useState } from "react";

// ── POC constants ──────────────────────────────────────────────────────────
const LOW_PRICE_USD  = 55_000;
const HIGH_PRICE_USD = 125_000;
const MAX_DCA_AUD    = 1_000;
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
const CHART_FONT     = "Outfit, sans-serif";
const CHART_TRACK_BG = "#E4E7EC"; // light-mode track; matches gray-200

function roundToNearest50(n: number): number {
  return Math.round(n / 50) * 50;
}

// Convert HSL values to a hex color string.
// ApexCharts requires hex/rgb colors for fill; HSL is not reliably supported.
function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  const [r1, g1, b1] =
    h < 60  ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] :
              [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

function tierColor(alloc: number): string {
  // alloc is a 0–1 fraction (0 = $0 DCA → red, 1 = $1000 max DCA → green)
  const hue = Math.round(alloc * 120);
  return hslToHex(hue, 72, 50);
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

  const prevBuy   = useRef<number | "PASS" | null>(null);
  const [animate, setAnimate] = useState(false);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          if (!isNaN(price)) setPriceUSD(price);
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
    if (priceUSD > HIGH_PRICE_USD) {
      recommendedBuy = "PASS";
    } else {
      allocationPct = Math.max(
        0,
        Math.min(
          1,
          1 - (priceUSD - LOW_PRICE_USD) / (HIGH_PRICE_USD - LOW_PRICE_USD)
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
  const color       = isPass || isLoading ? "#98a2b3" : tierColor(buyRatio);
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
      height: 330,
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
          value: {
            fontSize: "32px",
            fontWeight: "600",
            offsetY: -40,
            color,
            formatter: () => centerLabel,
          },
        },
      },
    },
    fill: { type: "solid", colors: [color] },
    stroke: { lineCap: "round" },
    labels: ["Allocation"],
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-white/[0.03] h-full flex flex-col">
      <div className="px-5 pt-5 bg-white shadow-default rounded-2xl pb-11 dark:bg-gray-900 sm:px-6 sm:pt-6 flex-1">

        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            4
          </span>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            DCA signal
          </h3>
          <span className="ml-auto flex items-center gap-1 text-xs text-gray-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        </div>

        {/* Radial bar — allocation % */}
        <div
          style={{
            transform: animate ? "scale(1.02)" : "scale(1)",
            transition: "transform 0.3s ease",
          }}
        >
          <Chart
            key={color}
            options={options}
            series={[chartValue]}
            type="radialBar"
            height={330}
          />
        </div>

        {/* Sub-label */}
        <p className="mx-auto mt-10 w-full max-w-[380px] text-center text-sm text-gray-500 dark:text-gray-400 sm:text-base">
          AUD · Fortnightly DCA
        </p>
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
