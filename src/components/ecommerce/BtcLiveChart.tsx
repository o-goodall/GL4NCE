import { useEffect, useRef, useState, useMemo } from "react";
import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";
import { ArrowUpIcon, ArrowDownIcon } from "../../icons";
import Badge from "../ui/badge/Badge";

// ── Types ──────────────────────────────────────────────────────────────────────
type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y";
type KlinePoint = { x: number; y: number };

// ── Config ─────────────────────────────────────────────────────────────────────
const TF_CONFIG: Record<Timeframe, { interval: string; limit: number; cacheTTL: number }> = {
  "1D": { interval: "5m",  limit: 288,  cacheTTL:       60_000 },
  "1W": { interval: "1h",  limit: 168,  cacheTTL:      300_000 },
  "1M": { interval: "4h",  limit: 180,  cacheTTL:      900_000 },
  "3M": { interval: "1d",  limit: 90,   cacheTTL:    3_600_000 },
  "1Y": { interval: "1d",  limit: 365,  cacheTTL:    3_600_000 },
  "5Y": { interval: "1w",  limit: 260,  cacheTTL:  604_800_000 },
};

const TIMEFRAMES: Timeframe[] = ["1D", "1W", "1M", "3M", "1Y", "5Y"];
const MA_PERIOD = 20;

// ── Cache helpers ──────────────────────────────────────────────────────────────
function getCached(tf: Timeframe): KlinePoint[] | null {
  try {
    const raw = localStorage.getItem(`btc-klines-${tf}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { data: KlinePoint[]; fetchedAt: number };
    if (Date.now() - entry.fetchedAt > TF_CONFIG[tf].cacheTTL) return null;
    return entry.data;
  } catch { return null; }
}

function setCache(tf: Timeframe, data: KlinePoint[]): void {
  try {
    localStorage.setItem(`btc-klines-${tf}`, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch { /* ignore storage quota errors */ }
}

// ── Binance REST fetch ─────────────────────────────────────────────────────────
async function fetchKlines(tf: Timeframe, signal: AbortSignal): Promise<KlinePoint[]> {
  const { interval, limit } = TF_CONFIG[tf];
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // kline tuple: [openTime, open, high, low, close, volume, closeTime, ...]
  const raw = (await res.json()) as [number, string, string, string, string, ...unknown[]][];
  return raw.map((k) => ({ x: k[6] as number, y: parseFloat(k[4]) }));
}

// ── Simple moving average (sliding window, O(n)) ──────────────────────────────
function calcSMA(data: KlinePoint[], period: number): KlinePoint[] {
  const result: KlinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].y;
    if (i >= period) sum -= data[i - period].y;
    if (i >= period - 1) result.push({ x: data[i].x, y: sum / period });
  }
  return result;
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function BtcLiveChart() {
  const [timeframe,  setTimeframe]  = useState<Timeframe>("1D");
  const [logScale,   setLogScale]   = useState(false);
  const [showMA,     setShowMA]     = useState(false);
  const [klines,     setKlines]     = useState<KlinePoint[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [livePrice,  setLivePrice]  = useState<number | null>(null);
  const [change24h,  setChange24h]  = useState<number | null>(null);
  const [flash,      setFlash]      = useState<"up" | "down" | null>(null);
  const prevPrice  = useRef<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch historical klines (with cache) ────────────────────────────────────
  useEffect(() => {
    const cached = getCached(timeframe);
    if (cached) { setKlines(cached); setLoading(false); return; }

    setLoading(true);
    const ctrl = new AbortController();
    fetchKlines(timeframe, ctrl.signal)
      .then((data) => { setCache(timeframe, data); setKlines(data); setLoading(false); })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (import.meta.env.DEV) console.error("[BtcLiveChart] fetch error:", err);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [timeframe]);

  // ── Binance WebSocket — live price ──────────────────────────────────────────
  useEffect(() => {
    const ws = new WebSocket("wss://stream.binance.com:9443/stream?streams=btcusdt@ticker");

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          stream: string;
          data: Record<string, string>;
        };
        if (msg.stream !== "btcusdt@ticker") return;
        const price = parseFloat(msg.data["c"]);
        const pct   = parseFloat(msg.data["P"]);
        if (isNaN(price)) return;
        setLivePrice(price);
        setChange24h(pct);
        if (prevPrice.current !== null && price !== prevPrice.current) {
          const dir: "up" | "down" = price > prevPrice.current ? "up" : "down";
          setFlash(dir);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setFlash(null), 600);
        }
        prevPrice.current = price;
      } catch { /* ignore malformed frames */ }
    };

    ws.onerror = () => {
      if (import.meta.env.DEV) console.error("[BtcLiveChart] WebSocket error");
    };

    return () => {
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  // ── Merge live tick into last candle ────────────────────────────────────────
  const chartData = useMemo<KlinePoint[]>(() => {
    if (!klines.length || livePrice === null) return klines;
    const lastCandle = klines[klines.length - 1];
    return [...klines.slice(0, -1), { x: lastCandle.x, y: livePrice }];
  }, [klines, livePrice]);

  const maSeries = useMemo<KlinePoint[]>(
    () => (showMA && chartData.length > MA_PERIOD ? calcSMA(chartData, MA_PERIOD) : []),
    [chartData, showMA],
  );

  // ── Chart options ────────────────────────────────────────────────────────────
  const isUp      = change24h !== null ? change24h >= 0 : true;
  const lineColor = isUp ? "#10b981" : "#ef4444";

  const chartOptions = useMemo<ApexOptions>(() => ({
    chart: {
      type: "area",
      fontFamily: "Inter, sans-serif",
      background: "transparent",
      toolbar: { show: false },
      zoom: { enabled: true, type: "x" },
      animations: { enabled: false },
    },
    colors: showMA ? [lineColor, "#f59e0b"] : [lineColor],
    stroke: {
      curve: "smooth",
      width: showMA ? [2, 1.5] : [2],
      dashArray: showMA ? [0, 5] : [0],
    },
    fill: {
      type: "gradient",
      gradient: { shadeIntensity: 1, opacityFrom: 0.15, opacityTo: 0, stops: [0, 100] },
    },
    dataLabels: { enabled: false },
    markers: { size: 0, hover: { size: 4 } },
    grid: {
      borderColor: "#374151",
      strokeDashArray: 4,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
      padding: { left: 4, right: 8, top: 0, bottom: 0 },
    },
    xaxis: {
      type: "datetime",
      labels: { style: { fontSize: "10px", colors: "#6B7280" }, datetimeUTC: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false },
    },
    yaxis: {
      logarithmic: logScale,
      labels: {
        style: { fontSize: "11px", colors: ["#6B7280"] },
        formatter: (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`),
      },
      forceNiceScale: true,
    },
    tooltip: {
      theme: "dark",
      shared: true,
      x: {
        format:
          timeframe === "1D" ? "HH:mm" :
          timeframe === "1W" ? "dd MMM HH:mm" :
          "dd MMM yyyy",
      },
      y: {
        formatter: (v: number) =>
          `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
      },
    },
    crosshairs: {
      x: { show: true, width: 1, stroke: { color: "#6B7280", dashArray: 4 } },
      y: { show: true },
    },
    legend: {
      show: showMA,
      position: "top",
      horizontalAlign: "right",
      fontSize: "11px",
      labels: { colors: "#9CA3AF" },
    },
  }), [logScale, lineColor, showMA, timeframe]);

  const series = useMemo(() => {
    const main = { name: "BTC/USD", data: chartData };
    if (!showMA || !maSeries.length) return [main];
    return [main, { name: `SMA ${MA_PERIOD}`, data: maSeries }];
  }, [chartData, maSeries, showMA]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const fmtPrice = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const flashClass =
    flash === "up"   ? "text-emerald-500" :
    flash === "down" ? "text-red-500"     :
    "text-gray-800 dark:text-white/90";

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
      {/* Header row: title + price + controls */}
      <div className="flex flex-col gap-4 mb-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: tile badge + title + live price */}
        <div>
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
              5
            </span>
            <span
              className="w-5 h-5 flex items-center justify-center text-lg font-bold text-brand-500 leading-none"
              aria-label="Bitcoin"
            >
              ₿
            </span>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Bitcoin</h3>
          </div>
          <div className="flex items-baseline gap-2 mt-1 ml-8">
            <span
              className={`text-2xl font-bold tabular-nums transition-colors duration-300 ${flashClass}`}
              aria-live="polite"
              aria-label={livePrice !== null ? `Bitcoin price $${fmtPrice(livePrice)}` : "Loading"}
            >
              {livePrice !== null ? `$${fmtPrice(livePrice)}` : "—"}
            </span>
            {change24h !== null && (
              <Badge color={change24h >= 0 ? "success" : "error"}>
                {change24h >= 0 ? <ArrowUpIcon /> : <ArrowDownIcon />}
                {Math.abs(change24h).toFixed(2)}%
              </Badge>
            )}
          </div>
        </div>

        {/* Right: timeframe tabs + toggles */}
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {/* Timeframe selector */}
          <div
            className="flex items-center gap-1"
            role="tablist"
            aria-label="Chart timeframe"
          >
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                role="tab"
                aria-selected={timeframe === tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  timeframe === tf
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Scale + overlay toggles */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setLogScale((s) => !s)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                logScale
                  ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                  : "border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400"
              }`}
              aria-pressed={logScale}
            >
              Log
            </button>
            <button
              onClick={() => setShowMA((m) => !m)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                showMA
                  ? "border-amber-400 bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
                  : "border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400"
              }`}
              aria-pressed={showMA}
            >
              MA{MA_PERIOD}
            </button>
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div
        className="relative -mx-1 h-[280px] sm:h-[340px]"
        aria-label="Bitcoin price chart"
      >
        {loading ? (
          <div className="h-full w-full animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
        ) : (
          <Chart
            key={`btc-${timeframe}-${logScale}`}
            options={chartOptions}
            series={series}
            type="area"
            height="100%"
          />
        )}
      </div>

      <p className="mt-2 text-center text-[10px] text-gray-400 dark:text-gray-600 select-none">
        Drag to zoom · Pinch on mobile
      </p>
    </div>
  );
}
