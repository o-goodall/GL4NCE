import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";
import { ArrowUpIcon, ArrowDownIcon } from "../../icons";
import Badge from "../ui/badge/Badge";

// ── Types ──────────────────────────────────────────────────────────────────────
type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y" | "ALL";
/** [timestamp_ms, close_price] */
type PricePoint = [number, number];

// ── Config ─────────────────────────────────────────────────────────────────────
const TF_CONFIG: Record<Timeframe, { interval: string; limit: number; cacheTTL: number }> = {
  "1D":  { interval: "5m",  limit: 288,  cacheTTL:        60_000 },
  "1W":  { interval: "1h",  limit: 168,  cacheTTL:       300_000 },
  "1M":  { interval: "4h",  limit: 180,  cacheTTL:       900_000 },
  "3M":  { interval: "1d",  limit: 90,   cacheTTL:     3_600_000 },
  "1Y":  { interval: "1d",  limit: 365,  cacheTTL:     3_600_000 },
  "5Y":  { interval: "1w",  limit: 260,  cacheTTL:   604_800_000 },
  "ALL": { interval: "1w",  limit: 1000, cacheTTL:   604_800_000 },
};

const TIMEFRAMES: Timeframe[] = ["1D", "1W", "1M", "3M", "1Y", "5Y", "ALL"];
const MA_PERIOD = 200;
const ATH_CACHE_KEY = "btc-ath";
const ATH_CACHE_TTL = 86_400_000; // 24 hours
const CHART_UPDATE_THROTTLE_MS = 1_000;

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtNum(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Cache helpers ──────────────────────────────────────────────────────────────
function getCachedPrices(tf: Timeframe): PricePoint[] | null {
  try {
    const raw = localStorage.getItem(`btc-ohlc-${tf}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { data: unknown; fetchedAt: number };
    if (Date.now() - entry.fetchedAt > TF_CONFIG[tf].cacheTTL) return null;
    const data = entry.data;
    if (!Array.isArray(data) || !data.length) return null;
    // Support legacy OHLC format { time (seconds), close } and new tuple [ts_ms, close]
    const first = data[0];
    if (Array.isArray(first)) return data as PricePoint[];
    return (data as Array<{ time: number; close: number }>).map(
      (d) => [d.time * 1000, d.close] as PricePoint,
    );
  } catch { return null; }
}

function setCachedPrices(tf: Timeframe, data: PricePoint[]): void {
  try {
    localStorage.setItem(`btc-ohlc-${tf}`, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch { /* ignore storage quota errors */ }
}

function getCachedATH(): number | null {
  try {
    const raw = localStorage.getItem(ATH_CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { price: number; fetchedAt: number };
    if (Date.now() - entry.fetchedAt > ATH_CACHE_TTL) return null;
    return entry.price;
  } catch { return null; }
}

function setCachedATH(price: number): void {
  try {
    localStorage.setItem(ATH_CACHE_KEY, JSON.stringify({ price, fetchedAt: Date.now() }));
  } catch { /* ignore storage quota errors */ }
}

// ── Binance REST fetch ─────────────────────────────────────────────────────────
type RawKline = [number, string, string, string, string, ...unknown[]];

async function fetchKlines(tf: Timeframe, signal: AbortSignal): Promise<RawKline[]> {
  const { interval, limit } = TF_CONFIG[tf];
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as RawKline[];
}

async function fetchPrices(tf: Timeframe, signal: AbortSignal): Promise<PricePoint[]> {
  const raw = await fetchKlines(tf, signal);
  // kline tuple: [openTime, open, high, low, close, ...]
  return raw.map((k) => [k[0] as number, parseFloat(k[4])] as PricePoint);
}

async function fetchATHHigh(signal: AbortSignal): Promise<number> {
  const raw = await fetchKlines("ALL", signal);
  return raw.reduce((m, k) => {
    const high = parseFloat(k[2]);
    return high > m ? high : m;
  }, -Infinity);
}

// ── Simple moving average (sliding window, O(n)) ──────────────────────────────
function calcSMA(data: PricePoint[], period: number): PricePoint[] {
  const result: PricePoint[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i][1];
    if (i >= period) sum -= data[i - period][1];
    if (i >= period - 1) result.push([data[i][0], sum / period]);
  }
  return result;
}

// ── Gold overlay types & config ───────────────────────────────────────────────
type GoldTF = "1M" | "3M" | "1Y" | "5Y" | "ALL";

const GOLD_TF_MAP: Record<Timeframe, GoldTF> = {
  "1D": "1M", "1W": "1M", "1M": "1M", "3M": "3M", "1Y": "1Y", "5Y": "5Y", "ALL": "ALL",
};

const GOLD_TF_CONFIG: Record<GoldTF, { goldRange: string; goldInterval: string; cacheTTL: number }> = {
  "1M":  { goldRange: "1mo", goldInterval: "1d",  cacheTTL:     900_000 },
  "3M":  { goldRange: "3mo", goldInterval: "1d",  cacheTTL:   3_600_000 },
  "1Y":  { goldRange: "1y",  goldInterval: "1wk", cacheTTL:   3_600_000 },
  "5Y":  { goldRange: "5y",  goldInterval: "1wk", cacheTTL:  86_400_000 },
  "ALL": { goldRange: "max", goldInterval: "1wk", cacheTTL:  86_400_000 },
};

const GOLD_RATIO_ATH_FALLBACK = { ratio: 38.51, date: "17 Dec 2024" };
const GOLD_ATH_CACHE_KEY = "btc-gold-ath";
const GOLD_ATH_CACHE_TTL = 86_400_000;
const GOLD_POLL_MS = 10 * 60 * 1_000; // 10 minutes

// ── Generic localStorage cache helpers (for gold overlay) ─────────────────────
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

// ── Gold spot price fetch ─────────────────────────────────────────────────────
async function fetchGoldSpotPrice(signal: AbortSignal): Promise<number> {
  const res = await fetch("/api/gold-price", { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { price: number };
  if (!data.price || isNaN(data.price)) throw new Error("Invalid gold price");
  return data.price;
}

// ── Gold history fetch ────────────────────────────────────────────────────────
async function fetchGoldHistory(goldTF: GoldTF, signal: AbortSignal): Promise<PricePoint[]> {
  const { goldRange, goldInterval } = GOLD_TF_CONFIG[goldTF];
  const res = await fetch(`/api/gold-history?range=${goldRange}&interval=${goldInterval}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { data: PricePoint[] };
  return data.data;
}

// ── Compute BTC/Gold ratio series (nearest-gold interpolation) ────────────────
function computeRatioSeries(btcPrices: PricePoint[], goldPrices: PricePoint[]): PricePoint[] {
  if (!btcPrices.length || !goldPrices.length) return [];
  const sortedGold = [...goldPrices].sort((a, b) => a[0] - b[0]);

  function nearestGold(ts: number): number | null {
    let lo = 0, hi = sortedGold.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (sortedGold[mid][0] < ts) lo = mid + 1; else hi = mid;
    }
    if (lo === 0) return sortedGold[0][1];
    const before = sortedGold[lo - 1], after = sortedGold[lo];
    return Math.abs(after[0] - ts) <= Math.abs(before[0] - ts) ? after[1] : before[1];
  }

  return btcPrices
    .map(([ts, btc]) => {
      const gold = nearestGold(ts);
      if (!gold || gold <= 0) return null;
      return [ts, parseFloat((btc / gold).toFixed(2))] as PricePoint;
    })
    .filter((p): p is PricePoint => p !== null);
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function BtcLiveChart() {
  const prevPriceRef      = useRef<number | null>(null);
  const flashTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastChartUpdateRef = useRef<number>(0);

  const [timeframe,  setTimeframe]  = useState<Timeframe>("1D");
  const [showMA,     setShowMA]     = useState(false);
  const [showGold,   setShowGold]   = useState(false);
  const [closeData,  setCloseData]  = useState<PricePoint[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [livePrice,  setLivePrice]  = useState<number | null>(null);
  const [change24h,  setChange24h]  = useState<number | null>(null);
  const [flash,      setFlash]      = useState<"up" | "down" | null>(null);
  const [ath,        setATH]        = useState<number | null>(null);
  const [goldPriceHistory, setGoldPriceHistory] = useState<PricePoint[]>([]);
  const [goldAth,    setGoldAth]    = useState(GOLD_RATIO_ATH_FALLBACK);
  const [liveGoldPrice, setLiveGoldPrice] = useState<number | null>(null);

  // ── ATH fetch on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    const cached = getCachedATH();
    if (cached !== null) { setATH(cached); return; }
    const ctrl = new AbortController();
    fetchATHHigh(ctrl.signal)
      .then((maxHigh) => { setCachedATH(maxHigh); setATH(maxHigh); })
      .catch(() => { /* non-critical — ATH annotation simply won't render */ });
    return () => ctrl.abort();
  }, []);

  // ── Gold ATH — load from localStorage cache on mount ─────────────────────────
  useEffect(() => {
    const cached = getCache<{ ratio: number; date: string }>(GOLD_ATH_CACHE_KEY, GOLD_ATH_CACHE_TTL);
    if (cached && cached.ratio > 0) setGoldAth(cached);
  }, []);

  // ── Gold price history fetch (when overlay is active) ────────────────────────
  useEffect(() => {
    if (!showGold) { setGoldPriceHistory([]); return; }
    const goldTF = GOLD_TF_MAP[timeframe];
    const cacheKey = `btc-gold-history-${goldTF}`;
    const cached = getCache<PricePoint[]>(cacheKey, GOLD_TF_CONFIG[goldTF].cacheTTL);
    if (cached) { setGoldPriceHistory(cached); return; }
    const ctrl = new AbortController();
    fetchGoldHistory(goldTF, ctrl.signal)
      .then((data) => { setCache(cacheKey, data); setGoldPriceHistory(data); })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (import.meta.env.DEV) console.error("[BtcLiveChart] Gold history error:", err);
      });
    return () => ctrl.abort();
  }, [showGold, timeframe]);

  // ── Gold spot price poll (active only while gold overlay is on) ───────────────
  useEffect(() => {
    if (!showGold) { setLiveGoldPrice(null); return; }
    const ctrl = new AbortController();
    const poll = () =>
      fetchGoldSpotPrice(ctrl.signal).then(setLiveGoldPrice).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (import.meta.env.DEV) console.error("[BtcLiveChart] Gold price error:", err);
      });
    poll();
    const id = setInterval(poll, GOLD_POLL_MS);
    return () => { ctrl.abort(); clearInterval(id); };
  }, [showGold]);

  // ── Historical price fetch (with cache) ──────────────────────────────────────
  useEffect(() => {
    const cached = getCachedPrices(timeframe);
    if (cached) { setCloseData(cached); setLoading(false); return; }

    setLoading(true);
    const ctrl = new AbortController();
    fetchPrices(timeframe, ctrl.signal)
      .then((data) => { setCachedPrices(timeframe, data); setCloseData(data); setLoading(false); })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (import.meta.env.DEV) console.error("[BtcLiveChart] fetch error:", err);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [timeframe]);

  // ── Binance WebSocket — live price + throttled chart update ──────────────────
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

        // Flash effect on price change
        if (prevPriceRef.current !== null && price !== prevPriceRef.current) {
          const dir: "up" | "down" = price > prevPriceRef.current ? "up" : "down";
          setFlash(dir);
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          flashTimerRef.current = setTimeout(() => setFlash(null), 600);
        }
        prevPriceRef.current = price;

        // Throttled chart update — mutate only the last data point
        const now = Date.now();
        if (now - lastChartUpdateRef.current >= CHART_UPDATE_THROTTLE_MS) {
          lastChartUpdateRef.current = now;
          setCloseData((prev) => {
            if (!prev.length) return prev;
            const next = [...prev];
            next[next.length - 1] = [next[next.length - 1][0], price];
            return next;
          });
        }
      } catch { /* ignore malformed frames */ }
    };

    ws.onerror = () => {
      if (import.meta.env.DEV) console.error("[BtcLiveChart] WebSocket error");
    };

    return () => {
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  // ── Build ApexCharts series ───────────────────────────────────────────────────
  const maData = useMemo<PricePoint[]>(() => {
    if (!showMA || closeData.length <= MA_PERIOD) return [];
    return calcSMA(closeData, MA_PERIOD);
  }, [closeData, showMA]);

  // BTC/Gold ratio overlay (computed from current BTC closes + gold history)
  const ratioData = useMemo<PricePoint[]>(() => {
    if (!showGold || !closeData.length || !goldPriceHistory.length) return [];
    return computeRatioSeries(closeData, goldPriceHistory);
  }, [showGold, closeData, goldPriceHistory]);

  // ── Keep goldAth in sync with actual ratio series ─────────────────────────────
  useEffect(() => {
    if (!ratioData.length) return;
    const maxPoint = ratioData.reduce((m: PricePoint, p: PricePoint) => (p[1] > m[1] ? p : m), ratioData[0]);
    setGoldAth((prev: { ratio: number; date: string }) => {
      if (maxPoint[1] <= prev.ratio) return prev;
      const date = new Date(maxPoint[0]).toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
      });
      const entry = { ratio: maxPoint[1], date };
      setCache(GOLD_ATH_CACHE_KEY, entry);
      return entry;
    });
  }, [ratioData]);

  const series = useMemo(() => {
    const result: { name: string; data: PricePoint[] }[] = [
      { name: "BTC/USD", data: closeData },
    ];
    if (showGold && ratioData.length > 0) {
      result.push({ name: "BTC/Gold (oz)", data: ratioData });
    }
    if (showMA && maData.length > 0) {
      result.push({ name: `MA${MA_PERIOD}`, data: maData });
    }
    return result;
  }, [closeData, showGold, ratioData, showMA, maData]);

  // ── Chart options ─────────────────────────────────────────────────────────────
  // maActive: true only when the MA series is actually present in `series`
  const maActive = showMA && maData.length > 0;

  const options = useMemo<ApexOptions>(() => {
    // Series colors — sized to the exact number of active series
    const colors = showGold
      ? (maActive ? ["#10b981", "#FFD300", "#f59e0b"] : ["#10b981", "#FFD300"])
      : (maActive ? ["#10b981", "#f59e0b"] : ["#10b981"]);
    const strokeWidths = showGold
      ? (maActive ? [2, 2, 1.5] : [2, 2])
      : (maActive ? [2, 1.5]   : [2]);
    const strokeDashes = showGold
      ? (maActive ? [0, 0, 5]  : [0, 0])
      : (maActive ? [0, 5]     : [0]);

    // Y-axis — single when no gold, dual (or triple with hidden MA axis) with gold
    const yaxisConfig: ApexOptions["yaxis"] = showGold
      ? [
          {
            seriesName: "BTC/USD",
            opposite: true,
            labels: {
              style: { fontSize: "11px", colors: ["#6B7280"] },
              formatter: (val: number) => `$${fmtNum(val)}`,
            },
          },
          {
            seriesName: "BTC/Gold (oz)",
            opposite: false,
            labels: {
              style: { fontSize: "11px", colors: ["#6B7280"] },
              formatter: (val: number) => `${val.toFixed(1)} oz`,
            },
          },
          // Add hidden MA axis ONLY when the MA series is actually in `series`.
          // Keeping yaxis count === series count prevents ApexCharts from
          // mis-assigning the oz axis to the MA line.
          ...(maActive ? [{
            seriesName: "BTC/USD",
            opposite:   true,
            show:       false,
          }] : []),
        ]
      : {
          opposite: true,
          labels: {
            style: { fontSize: "11px", colors: ["#6B7280"] },
            formatter: (val: number) => `$${fmtNum(val)}`,
          },
        };

    // Custom tooltip — better spacing than the default shared tooltip
    const tooltipCustom = ({
      series,
      dataPointIndex,
      w,
    }: {
      series: number[][];
      dataPointIndex: number;
      w: { globals: { seriesX: number[][] } };
    }): string => {
      const ts = w.globals.seriesX[0]?.[dataPointIndex];
      const dateStr = ts
        ? new Date(ts).toLocaleString("en-GB", {
            day: "numeric", month: "short",
            hour: "2-digit", minute: "2-digit",
          })
        : "";

      const defs: Array<{ color: string; label: string; fmt: (v: number) => string }> = [
        { color: "#10b981", label: "BTC",          fmt: (v) => `$${fmtNum(v)}` },
        ...(showGold ? [{ color: "#FFD300", label: "Gold oz", fmt: (v: number) => `${v.toFixed(2)} oz` }] : []),
        ...(maActive ? [{ color: "#f59e0b", label: `MA${MA_PERIOD}`, fmt: (v: number) => `$${fmtNum(v)}` }] : []),
      ];

      const rows = defs.map((d, i) => {
        const val = series[i]?.[dataPointIndex];
        if (val == null) return "";
        return (
          `<div style="display:flex;align-items:center;gap:8px;padding:3px 0">` +
          `<span style="width:8px;height:8px;border-radius:50%;background:${d.color};flex-shrink:0"></span>` +
          `<span style="color:#9ca3af;flex:1">${d.label}</span>` +
          `<span style="color:#f9fafb;font-weight:600">${d.fmt(val)}</span>` +
          `</div>`
        );
      }).join("");

      return (
        `<div style="padding:8px 12px;font-family:Inter,sans-serif;font-size:12px;min-width:170px">` +
        `<div style="color:#6b7280;font-size:11px;margin-bottom:5px">${dateStr}</div>` +
        rows +
        `</div>`
      );
    };

    return {
      chart: {
        fontFamily: "Inter, sans-serif",
        type: "line",
        toolbar: { show: false },
        background: "transparent",
        zoom: { enabled: true, type: "x", autoScaleYaxis: !showGold },
        animations: {
          enabled: true,
          speed: 200,
          dynamicAnimation: { enabled: true, speed: 300 },
          animateGradually: { enabled: false },
        },
      },
      stroke: { curve: "smooth", width: strokeWidths, dashArray: strokeDashes },
      colors,
      dataLabels: { enabled: false },
      markers: { size: 0, hover: { size: 4, sizeOffset: 2 } },
      xaxis: {
        type: "datetime",
        axisBorder: { show: false },
        axisTicks:  { show: false },
        labels: {
          datetimeUTC: false,
          style: { fontSize: "11px", colors: "#6B7280", fontFamily: "Inter, sans-serif" },
        },
        crosshairs: { show: true },
        tooltip:    { enabled: false },
      },
      yaxis: yaxisConfig,
      grid: {
        borderColor: "#1F2937",
        strokeDashArray: 0,
        xaxis: { lines: { show: false } },
        yaxis: { lines: { show: true } },
        padding: { left: 4, right: 4 },
      },
      tooltip: {
        enabled: true,
        shared:  true,
        theme:   "dark",
        custom:  tooltipCustom,
      },
      annotations: (ath !== null || showGold) ? {
        yaxis: [
          ...(ath !== null ? [{
            y:               ath,
            ...(showGold ? { yAxisIndex: 0 } : {}),
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
          }] : []),
          ...(showGold ? [{
            y:               goldAth.ratio,
            yAxisIndex:      1,
            borderColor:     "#FFD300",
            strokeDashArray: 4,
            borderWidth:     1,
            label: {
              text:        "ATH",
              borderColor: "transparent",
              position:    "right",
              offsetX:     -4,
              offsetY:     -6,
              style: {
                color:      "#FFD300",
                background: "transparent",
                fontSize:   "10px",
                fontFamily: "Inter, sans-serif",
              },
            },
          }] : []),
        ],
      } : {},
      legend: { show: false },
    };
  }, [ath, showGold, goldAth, maActive]);

  // ── Derived display values ────────────────────────────────────────────────────
  const isUp      = change24h !== null ? change24h >= 0 : true;
  const flashClass =
    flash === "up"   ? "text-emerald-500" :
    flash === "down" ? "text-red-500"     :
    "text-gray-800 dark:text-white/90";
  const liveRatio = livePrice !== null && liveGoldPrice !== null && liveGoldPrice > 0
    ? livePrice / liveGoldPrice
    : null;

  // % change over the currently loaded timeframe (first candle → live price)
  const tfChangePct = useMemo<number | null>(() => {
    if (!closeData.length) return null;
    const first = closeData[0][1];
    if (!first) return null;
    const last = livePrice ?? closeData[closeData.length - 1][1];
    return ((last - first) / first) * 100;
  }, [closeData, livePrice]);

  // Same but for the BTC/Gold ratio series
  const tfGoldChangePct = useMemo<number | null>(() => {
    if (!showGold || !ratioData.length) return null;
    const first = ratioData[0][1];
    if (!first) return null;
    const last = liveRatio ?? ratioData[ratioData.length - 1][1];
    return ((last - first) / first) * 100;
  }, [showGold, ratioData, liveRatio]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
      {/* Header row: title + price + controls */}
      <div className="flex flex-col gap-4 mb-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: tile badge + title + live price */}
        <div>
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
              1
            </span>
            <span
              className="w-5 h-5 flex items-center justify-center text-lg font-bold text-brand-500 leading-none"
              aria-label="Bitcoin"
            >
              ₿
            </span>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Bitcoin</h3>
          </div>
          {/* Price columns: BTC USD | BTC/Gold oz (side-by-side when gold active) */}
          <div className="mt-1 ml-8 flex items-start gap-4">

            {/* ── USD column ── */}
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className={`text-2xl font-bold tabular-nums transition-colors duration-300 ${flashClass}`}
                  aria-live="polite"
                  aria-label={livePrice !== null ? `Bitcoin price $${fmtNum(livePrice)}` : "Loading"}
                >
                  {livePrice !== null ? `$${fmtNum(livePrice)}` : "—"}
                </span>
                {timeframe === "1D" && change24h !== null && (
                  <Badge color={change24h >= 0 ? "success" : "error"} size="sm">
                    {isUp ? <ArrowUpIcon /> : <ArrowDownIcon />}
                    {Math.abs(change24h).toFixed(2)}% 24h
                  </Badge>
                )}
                {timeframe !== "1D" && tfChangePct !== null && (
                  <Badge color={tfChangePct >= 0 ? "success" : "error"} size="sm">
                    {tfChangePct >= 0 ? <ArrowUpIcon /> : <ArrowDownIcon />}
                    {Math.abs(tfChangePct).toFixed(2)}% {timeframe}
                  </Badge>
                )}
              </div>
              {ath !== null && (
                <span className="text-xs font-medium text-amber-500 tabular-nums">
                  ATH ${fmtNum(ath)}
                </span>
              )}
            </div>

            {/* ── Gold oz column (only when overlay active) ── */}
            {showGold && (
              <>
                <div className="w-px self-stretch bg-gray-200 dark:bg-gray-700" />
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-2xl font-bold tabular-nums text-yellow-400">
                      {liveRatio !== null ? `${liveRatio.toFixed(2)} oz` : "—"}
                    </span>
                    {tfGoldChangePct !== null && (
                      <Badge color={tfGoldChangePct >= 0 ? "success" : "error"} size="sm">
                        {tfGoldChangePct >= 0 ? <ArrowUpIcon /> : <ArrowDownIcon />}
                        {Math.abs(tfGoldChangePct).toFixed(2)}% {timeframe} oz
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs font-medium text-yellow-400/70 tabular-nums">
                    ATH {goldAth.ratio.toFixed(2)} oz
                  </span>
                </div>
              </>
            )}

          </div>
        </div>

        {/* Right: timeframe tabs + MA toggle */}
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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
                disabled={showGold && (tf === "1D" || tf === "1W")}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  timeframe === tf
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : showGold && (tf === "1D" || tf === "1W")
                    ? "text-gray-300 cursor-not-allowed dark:text-gray-700"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
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
            <button
              onClick={() => {
                const next = !showGold;
                if (next && (timeframe === "1D" || timeframe === "1W")) setTimeframe("1M");
                setShowGold(next);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                showGold
                  ? "border-yellow-400 bg-yellow-50 text-yellow-600 dark:bg-yellow-500/10 dark:text-yellow-400"
                  : "border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400"
              }`}
              aria-pressed={showGold}
            >
              Gold oz
            </button>
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div
        className="relative -mx-3"
        aria-label="Bitcoin price chart"
      >
        {loading && (
          <div className="absolute inset-0 z-10 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" style={{ height: 300 }} />
        )}
        <Chart
          options={options}
          series={series}
          type="line"
          height={300}
        />
      </div>

      <p className="mt-1 text-center text-[10px] text-gray-400 dark:text-gray-600 select-none">
        Drag to zoom · Scroll / pinch to zoom
      </p>
    </div>
  );
}
