import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";
import { ArrowUpIcon, ArrowDownIcon } from "../../icons";
import Badge from "../ui/badge/Badge";

// ── Types ──────────────────────────────────────────────────────────────────────
type Timeframe = "1D" | "1W" | "1M" | "6M" | "1Y" | "ALL";
/** [timestamp_ms, close_price] */
type PricePoint = [number, number];

// ── Config ─────────────────────────────────────────────────────────────────────
const TF_CONFIG: Record<Timeframe, { interval: string; limit: number; cacheTTL: number }> = {
  "1D":  { interval: "5m",  limit: 288,  cacheTTL:        60_000 },
  "1W":  { interval: "1h",  limit: 168,  cacheTTL:       300_000 },
  "1M":  { interval: "4h",  limit: 180,  cacheTTL:       900_000 },
  "6M":  { interval: "1d",  limit: 180,  cacheTTL:     3_600_000 },
  "1Y":  { interval: "1d",  limit: 365,  cacheTTL:     3_600_000 },
  "ALL": { interval: "1w",  limit: 1000, cacheTTL: 86_400_000 },
};

const TIMEFRAMES: Timeframe[] = ["1D", "1W", "1M", "6M", "1Y", "ALL"];
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
  if (tf === "ALL") {
    // Try the CoinGecko proxy for full history back to ~2013, fall back to Binance on error
    try {
      const res = await fetch("/api/btc-history", { signal });
      if (res.ok) {
        const data = (await res.json()) as { data: PricePoint[] };
        if (Array.isArray(data.data) && data.data.length > 0) return data.data;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      // fall through to Binance
    }
  }
  const raw = await fetchKlines(tf, signal);
  // kline tuple: [openTime, open, high, low, close, ...]
  return raw.map((k) => [k[0] as number, parseFloat(k[4])] as PricePoint);
}

// ── Gold overlay types & config ───────────────────────────────────────────────
type GoldTF = "1M" | "6M" | "1Y" | "ALL";

const GOLD_TF_MAP: Record<Timeframe, GoldTF> = {
  "1D": "1M", "1W": "1M", "1M": "1M", "6M": "6M", "1Y": "1Y", "ALL": "ALL",
};

const GOLD_TF_CONFIG: Record<GoldTF, { goldRange: string; goldInterval: string; cacheTTL: number }> = {
  "1M":  { goldRange: "1mo", goldInterval: "1d",  cacheTTL:     900_000 },
  "6M":  { goldRange: "6mo", goldInterval: "1d",  cacheTTL:   3_600_000 },
  "1Y":  { goldRange: "1y",  goldInterval: "1wk", cacheTTL:   3_600_000 },
  "ALL": { goldRange: "max", goldInterval: "1wk", cacheTTL:  86_400_000 },
};

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
  const [showGold,   setShowGold]   = useState(false);
  const [closeData,  setCloseData]  = useState<PricePoint[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [livePrice,  setLivePrice]  = useState<number | null>(null);
  const [change24h,  setChange24h]  = useState<number | null>(null);
  const [flash,      setFlash]      = useState<"up" | "down" | null>(null);
  const [goldPriceHistory, setGoldPriceHistory] = useState<PricePoint[]>([]);
  const [liveGoldPrice, setLiveGoldPrice] = useState<number | null>(null);

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
  // BTC/Gold ratio overlay (computed from current BTC closes + gold history)
  const ratioData = useMemo<PricePoint[]>(() => {
    if (!showGold || !closeData.length || !goldPriceHistory.length) return [];
    return computeRatioSeries(closeData, goldPriceHistory);
  }, [showGold, closeData, goldPriceHistory]);

  const series = useMemo(() => {
    const result: { name: string; data: PricePoint[] }[] = [
      { name: "BTC/USD", data: closeData },
    ];
    if (showGold && ratioData.length > 0) {
      result.push({ name: "BTC/Gold (oz)", data: ratioData });
    }
    return result;
  }, [closeData, showGold, ratioData]);

  // ── High / Low for the selected timeframe ─────────────────────────────────────
  const { highPoint, lowPoint } = useMemo<{
    highPoint: PricePoint | null;
    lowPoint:  PricePoint | null;
  }>(() => {
    if (!closeData.length) return { highPoint: null, lowPoint: null };
    let hi = closeData[0], lo = closeData[0];
    for (let i = 1; i < closeData.length; i++) {
      if (closeData[i][1] > hi[1]) hi = closeData[i];
      if (closeData[i][1] < lo[1]) lo = closeData[i];
    }
    return { highPoint: hi, lowPoint: lo };
  }, [closeData]);

  // ── High / Low for the BTC/Gold ratio series ──────────────────────────────────
  const { goldHighPoint, goldLowPoint } = useMemo<{
    goldHighPoint: PricePoint | null;
    goldLowPoint:  PricePoint | null;
  }>(() => {
    if (!showGold || !ratioData.length) {
      return { goldHighPoint: null, goldLowPoint: null };
    }
    let hi = ratioData[0], lo = ratioData[0];
    for (let i = 1; i < ratioData.length; i++) {
      if (ratioData[i][1] > hi[1]) hi = ratioData[i];
      if (ratioData[i][1] < lo[1]) lo = ratioData[i];
    }
    return { goldHighPoint: hi, goldLowPoint: lo };
  }, [showGold, ratioData]);

  // ── Chart options ─────────────────────────────────────────────────────────────
  const options = useMemo<ApexOptions>(() => {
    // Series colors
    const colors = showGold ? ["#10b981", "#FFD300"] : ["#10b981"];
    const strokeWidths = showGold ? [2, 2] : [2];
    const strokeDashes = showGold ? [0, 0] : [0];

    // Y-axis — hidden (we show high/low as point annotations instead)
    const yaxisConfig: ApexOptions["yaxis"] = showGold
      ? [
          {
            seriesName: "BTC/USD",
            opposite: true,
            labels: { show: false },
            axisBorder: { show: false },
            axisTicks: { show: false },
          },
          {
            seriesName: "BTC/Gold (oz)",
            opposite: false,
            labels: { show: false },
            axisBorder: { show: false },
            axisTicks: { show: false },
          },
        ]
      : {
          labels: { show: false },
          axisBorder: { show: false },
          axisTicks: { show: false },
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
        { color: "#10b981", label: "BTC",      fmt: (v) => `$${fmtNum(v)}` },
        ...(showGold ? [{ color: "#FFD300", label: "Gold oz", fmt: (v: number) => `${v.toFixed(2)} oz` }] : []),
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

    // ── High / low point annotations — dots only, values shown in header ─────────
    const pointAnnotations: NonNullable<ApexOptions["annotations"]>["points"] = [];

    if (!showGold) {
      if (highPoint) {
        pointAnnotations.push({
          x: highPoint[0],
          y: highPoint[1],
          seriesIndex: 0,
          marker: { size: 5, fillColor: "#32CD32", strokeColor: "#fff", strokeWidth: 1.5 },
        });
      }
      if (lowPoint) {
        pointAnnotations.push({
          x: lowPoint[0],
          y: lowPoint[1],
          seriesIndex: 0,
          marker: { size: 5, fillColor: "#FF4F4F", strokeColor: "#fff", strokeWidth: 1.5 },
        });
      }
    } else {
      if (goldHighPoint) {
        pointAnnotations.push({
          x: goldHighPoint[0],
          y: goldHighPoint[1],
          seriesIndex: 1,
          yAxisIndex: 1,
          marker: { size: 5, fillColor: "#32CD32", strokeColor: "#fff", strokeWidth: 1.5 },
        });
      }
      if (goldLowPoint) {
        pointAnnotations.push({
          x: goldLowPoint[0],
          y: goldLowPoint[1],
          seriesIndex: 1,
          yAxisIndex: 1,
          marker: { size: 5, fillColor: "#FF4F4F", strokeColor: "#fff", strokeWidth: 1.5 },
        });
      }
    }

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
        labels: { show: false },
        crosshairs: { show: true },
        tooltip:    { enabled: false },
      },
      yaxis: yaxisConfig,
      grid: {
        show: false,
        padding: { left: 8, right: 8, top: 16, bottom: 16 },
      },
      tooltip: {
        enabled: true,
        shared:  true,
        theme:   "dark",
        custom:  tooltipCustom,
      },
      annotations: {
        points: pointAnnotations,
      },
      legend: { show: false },
    };
  }, [showGold, highPoint, lowPoint, goldHighPoint, goldLowPoint]);

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
              {(highPoint || lowPoint) && (
                <span className="flex items-center gap-2 text-xs tabular-nums">
                  {highPoint && (
                    <span className="flex items-center gap-1 text-[#32CD32]">
                      <span className="text-[8px] leading-none">●</span>
                      ${fmtNum(highPoint[1])}
                    </span>
                  )}
                  {lowPoint && (
                    <span className="flex items-center gap-1 text-[#FF4F4F]">
                      <span className="text-[8px] leading-none">●</span>
                      ${fmtNum(lowPoint[1])}
                    </span>
                  )}
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
                  {(goldHighPoint || goldLowPoint) && (
                    <span className="flex items-center gap-2 text-xs tabular-nums">
                      {goldHighPoint && (
                        <span className="flex items-center gap-1 text-[#32CD32]">
                          <span className="text-[8px] leading-none">●</span>
                          {goldHighPoint[1].toFixed(2)} oz
                        </span>
                      )}
                      {goldLowPoint && (
                        <span className="flex items-center gap-1 text-[#FF4F4F]">
                          <span className="text-[8px] leading-none">●</span>
                          {goldLowPoint[1].toFixed(2)} oz
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </>
            )}

          </div>
        </div>

        {/* Right: timeframe tabs + Gold toggle */}
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

          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowGold((g) => !g)}
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

    </div>
  );
}
