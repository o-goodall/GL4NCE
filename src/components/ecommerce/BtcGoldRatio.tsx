import { useEffect, useMemo, useState } from "react";
import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";

// ── Types ──────────────────────────────────────────────────────────────────────
type Timeframe = "1M" | "3M" | "1Y" | "5Y" | "ALL";
/** [timestamp_ms, price] */
type PricePoint = [number, number];

// ── Config ─────────────────────────────────────────────────────────────────────
const TF_CONFIG: Record<
  Timeframe,
  { btcInterval: string; btcLimit: number; goldRange: string; goldInterval: string; cacheTTL: number }
> = {
  "1M":  { btcInterval: "1d",  btcLimit: 30,   goldRange: "1mo", goldInterval: "1d",  cacheTTL:     900_000 },
  "3M":  { btcInterval: "1d",  btcLimit: 90,   goldRange: "3mo", goldInterval: "1d",  cacheTTL:   3_600_000 },
  "1Y":  { btcInterval: "1w",  btcLimit: 52,   goldRange: "1y",  goldInterval: "1wk", cacheTTL:   3_600_000 },
  "5Y":  { btcInterval: "1w",  btcLimit: 260,  goldRange: "5y",  goldInterval: "1wk", cacheTTL:  86_400_000 },
  "ALL": { btcInterval: "1w",  btcLimit: 1000, goldRange: "max", goldInterval: "1wk", cacheTTL:  86_400_000 },
};

const TIMEFRAMES: Timeframe[] = ["1M", "3M", "1Y", "5Y", "ALL"];
const GOLD_POLL_MS = 10 * 60 * 1000;

// Fallback ATH — BTC $106,182 / Gold $2,632 on 17 Dec 2024
const INITIAL_ATH = { ratio: 38.51, date: "17 Dec 2024" };

const ATH_CACHE_KEY = "btc-gold-ath";
const ATH_CACHE_TTL = 86_400_000; // 24 hours

// ── Cache helpers ──────────────────────────────────────────────────────────────
function getCache<T>(key: string, ttl: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { data: T; fetchedAt: number };
    if (Date.now() - entry.fetchedAt > ttl) return null;
    return entry.data;
  } catch { return null; }
}

function setCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch { /* ignore storage quota errors */ }
}

// ── Fetch helpers ──────────────────────────────────────────────────────────────
type RawKline = [number, string, string, string, string, ...unknown[]];

async function fetchBtcPrices(tf: Timeframe, signal: AbortSignal): Promise<PricePoint[]> {
  const { btcInterval, btcLimit } = TF_CONFIG[tf];
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${btcInterval}&limit=${btcLimit}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = (await res.json()) as RawKline[];
  return raw.map((k) => [k[0] as number, parseFloat(k[4])] as PricePoint);
}

async function fetchGoldPrices(tf: Timeframe, signal: AbortSignal): Promise<PricePoint[]> {
  const { goldRange, goldInterval } = TF_CONFIG[tf];
  const url = `/api/gold-history?range=${goldRange}&interval=${goldInterval}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { data: PricePoint[] };
  return data.data;
}

async function fetchGoldPrice(signal: AbortSignal): Promise<number> {
  const res = await fetch("/api/gold-price", { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { price: number };
  if (!data.price || isNaN(data.price)) throw new Error("Invalid gold price");
  return data.price;
}

// ── Align timestamps and compute ratio series ──────────────────────────────────
function computeRatioSeries(btcPrices: PricePoint[], goldPrices: PricePoint[]): PricePoint[] {
  if (!btcPrices.length || !goldPrices.length) return [];

  // Sort gold timestamps for binary search
  const sortedGold = [...goldPrices].sort((a, b) => a[0] - b[0]);

  function nearestGoldPrice(ts: number): number | null {
    let lo = 0, hi = sortedGold.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (sortedGold[mid][0] < ts) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return sortedGold[0][1];
    const before = sortedGold[lo - 1];
    const after  = sortedGold[lo];
    return Math.abs(after[0] - ts) <= Math.abs(before[0] - ts) ? after[1] : before[1];
  }

  return btcPrices
    .map(([ts, btc]) => {
      const gold = nearestGoldPrice(ts);
      if (!gold || gold <= 0) return null;
      return [ts, parseFloat((btc / gold).toFixed(2))] as PricePoint;
    })
    .filter((p): p is PricePoint => p !== null);
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function BtcGoldRatio() {
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const [loading,   setLoading]   = useState(true);
  const [ratioData, setRatioData] = useState<PricePoint[]>([]);
  const [btcPrice,  setBtcPrice]  = useState<number | null>(null);
  const [goldPrice, setGoldPrice] = useState<number | null>(null);
  const [ath,       setAth]       = useState(INITIAL_ATH);

  // ── Historical data fetch (with cache) ───────────────────────────────────────
  useEffect(() => {
    const cacheKey = `btc-gold-ratio-${timeframe}`;
    const cached = getCache<PricePoint[]>(cacheKey, TF_CONFIG[timeframe].cacheTTL);
    if (cached) { setRatioData(cached); setLoading(false); return; }

    setLoading(true);
    const ctrl = new AbortController();
    Promise.all([
      fetchBtcPrices(timeframe, ctrl.signal),
      fetchGoldPrices(timeframe, ctrl.signal),
    ])
      .then(([btc, gold]) => {
        const ratio = computeRatioSeries(btc, gold);
        setCache(cacheKey, ratio);
        setRatioData(ratio);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (import.meta.env.DEV) console.error("[BtcGoldRatio] fetch error:", err);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [timeframe]);

  // ── ATH fetch on mount — compute from full history ───────────────────────────
  useEffect(() => {
    // Try cache first
    const cached = getCache<{ ratio: number; date: string }>(ATH_CACHE_KEY, ATH_CACHE_TTL);
    if (cached) {
      setAth((prev) => (cached.ratio > prev.ratio ? cached : prev));
      return;
    }

    const ctrl = new AbortController();
    Promise.all([
      fetchBtcPrices("ALL", ctrl.signal),
      fetchGoldPrices("ALL", ctrl.signal),
    ])
      .then(([btc, gold]) => {
        const series = computeRatioSeries(btc, gold);
        if (!series.length) return;
        const maxPoint = series.reduce((m, p) => (p[1] > m[1] ? p : m), series[0]);
        const athRatio = parseFloat(maxPoint[1].toFixed(2));
        const athDate  = new Date(maxPoint[0]).toLocaleDateString("en-GB", {
          day: "numeric", month: "short", year: "numeric",
        });
        const entry = { ratio: athRatio, date: athDate };
        setCache(ATH_CACHE_KEY, entry);
        setAth((prev) => (athRatio > prev.ratio ? entry : prev));
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (import.meta.env.DEV) console.error("[BtcGoldRatio] ATH fetch error:", err);
      });
    return () => ctrl.abort();
  }, []);

  // ── Live BTC price via Binance WebSocket ──────────────────────────────────────
  useEffect(() => {
    const ws = new WebSocket("wss://stream.binance.com:9443/stream?streams=btcusdt@ticker");
    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          stream: string;
          data: Record<string, string>;
        };
        if (msg.stream === "btcusdt@ticker") {
          const price = parseFloat(msg.data["c"]);
          if (!isNaN(price)) setBtcPrice(price);
        }
      } catch { /* ignore malformed frames */ }
    };
    ws.onerror = () => {
      if (import.meta.env.DEV) console.error("[BtcGoldRatio] WebSocket error");
    };
    return () => {
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close();
    };
  }, []);

  // ── Poll gold price every 10 min ──────────────────────────────────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    const poll = () =>
      fetchGoldPrice(ctrl.signal).then(setGoldPrice).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (import.meta.env.DEV) console.error("[BtcGoldRatio] Gold price error:", err);
      });
    poll();
    const id = setInterval(poll, GOLD_POLL_MS);
    return () => { ctrl.abort(); clearInterval(id); };
  }, []);

  const ratio = btcPrice !== null && goldPrice !== null ? btcPrice / goldPrice : null;

  // Update ATH whenever a new high is reached
  useEffect(() => {
    if (ratio === null) return;
    setAth((prev) => {
      if (ratio <= prev.ratio) return prev;
      const date = new Date().toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
      });
      return { ratio: parseFloat(ratio.toFixed(2)), date };
    });
  }, [ratio]);

  const fmt = (n: number, decimals = 2) =>
    n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  // ── Chart series & options ────────────────────────────────────────────────────
  const series = useMemo(() => [{ name: "BTC/Gold (oz)", data: ratioData }], [ratioData]);

  const options = useMemo<ApexOptions>(() => ({
    chart: {
      fontFamily: "Inter, sans-serif",
      type: "line",
      toolbar: { show: false },
      background: "transparent",
      zoom: { enabled: true, type: "x", autoScaleYaxis: true },
      animations: { enabled: false },
    },
    stroke: { curve: "smooth", width: [2] },
    colors: ["#FFD300"],
    dataLabels: { enabled: false },
    markers: { size: 0, hover: { size: 4, sizeOffset: 2 } },
    xaxis: {
      type: "datetime",
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: {
        datetimeUTC: false,
        style: { fontSize: "11px", colors: "#6B7280", fontFamily: "Inter, sans-serif" },
      },
      crosshairs: { show: true },
      tooltip: { enabled: false },
    },
    yaxis: {
      opposite: true,
      labels: {
        style: { fontSize: "11px", colors: ["#6B7280"] },
        formatter: (val: number) => val.toFixed(1),
      },
    },
    grid: {
      borderColor: "#1F2937",
      strokeDashArray: 0,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
      padding: { left: 4, right: 4 },
    },
    tooltip: {
      enabled: true,
      shared: true,
      theme: "dark",
      x: { format: "dd MMM yyyy" },
      y: { formatter: (val: number) => `${val.toFixed(2)} oz` },
    },
    annotations: {
      yaxis: [{
        y:               ath.ratio,
        borderColor:     "#f59e0b",
        strokeDashArray: 4,
        borderWidth:     1,
        label: {
          text:        "ATH",
          borderColor: "transparent",
          position:    "right",
          offsetX:     -4,
          offsetY:     -6,
          style: {
            color:      "#f59e0b",
            background: "transparent",
            fontSize:   "10px",
            fontFamily: "Inter, sans-serif",
          },
        },
      }],
    },
    legend: { show: false },
  }), [ath]);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
      {/* Header row: title + stats + timeframe tabs */}
      <div className="flex flex-col gap-4 mb-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: title + live ratio */}
        <div>
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">BTC / Gold</h3>
          <div className="flex flex-wrap items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold tabular-nums text-gray-800 dark:text-white/90">
              {ratio !== null ? fmt(ratio, 1) : "—"}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">oz</span>
            <span className="text-xs font-medium text-amber-500 tabular-nums">
              ATH {ath.ratio} oz
            </span>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-gray-400 dark:text-gray-500 mt-1">
            <span>
              BTC{" "}
              <span className="text-gray-600 dark:text-gray-300">
                {btcPrice !== null ? `$${fmt(btcPrice, 0)}` : "—"}
              </span>
            </span>
            <span>
              Gold{" "}
              <span className="text-gray-600 dark:text-gray-300">
                {goldPrice !== null ? `$${fmt(goldPrice, 0)}/oz` : "—"}
              </span>
            </span>
          </div>
        </div>

        {/* Right: timeframe tabs */}
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
      </div>

      {/* Chart area */}
      <div className="relative -mx-3" aria-label="BTC/Gold ratio chart">
        {loading && (
          <div
            className="absolute inset-0 z-10 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800"
            style={{ height: 300 }}
          />
        )}
        <Chart options={options} series={series} type="line" height={300} />
      </div>

      <p className="mt-1 text-center text-[10px] text-gray-400 dark:text-gray-600 select-none">
        Drag to zoom · Scroll / pinch to zoom
      </p>
    </div>
  );
}

