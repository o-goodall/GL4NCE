import React, { useEffect, useMemo, useRef, useState } from "react";
import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";
import { ArrowUpIcon, ArrowDownIcon } from "../../icons";
import Badge from "../ui/badge/Badge";
import { subscribeBtcTicker } from "../../lib/binanceTicker";

// ── Types ──────────────────────────────────────────────────────────────────────
type Timeframe = "1D" | "1W" | "1M" | "6M" | "1Y" | "ALL";
/** [timestamp_ms, close_price] */
type PricePoint = [number, number];
type IncomingPricePoint = { timestamp: number; price: number };
type SmoothingMode = "ema" | "sma";

type SmoothingConfig = {
  mode: SmoothingMode;
  emaAlpha: number;
  smaWindow: number;
  maxPoints: number;
  replaceLastOnSameTimestamp: boolean;
};

type LiveSmoothingState = {
  lastEma: number | null;
  smaBuffer: number[];
  smaSum: number;
};

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
const LIVE_SMOOTHING_CONFIG: SmoothingConfig = {
  mode: "ema",
  emaAlpha: 0.2,
  smaWindow: 8,
  maxPoints: 1200,
  replaceLastOnSameTimestamp: true,
};
const SHOW_LINE_MARKERS = false;
/** Minimum pixels of horizontal finger movement before touch scrubbing activates (directional lock) */
const TOUCH_SLOP = 5;
const LABEL_FLIP_THRESHOLD = 0.8;
/** Brand yellow — the chart line colour (constant; no dynamic direction colouring) */
const BRAND_COLOR = "#FFD300";
/** Fractional Y-axis padding added to chart min/max so the dot calc matches ApexCharts' rendering */
const Y_AXIS_PAD = 0.05;
/** Fallback plot-area insets used only before the SVG bounds are read from the DOM */
const PLOT_PAD_L = 8, PLOT_PAD_R = 8, PLOT_PAD_T = 28, PLOT_PAD_B = 36;
const CHART_H = 300;

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtNum(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(ts: number, tf: Timeframe): string {
  const d = new Date(ts);
  if (tf === "1D" || tf === "1W" || tf === "1M") {
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  if (tf === "ALL") {
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function smoothIncomingBatch(
  prevSeries: PricePoint[],
  incomingPoints: IncomingPricePoint[],
  state: LiveSmoothingState,
  config: SmoothingConfig,
): PricePoint[] {
  if (!incomingPoints.length) return prevSeries;

  const nextSeries: PricePoint[] = [...prevSeries];

  for (const point of incomingPoints) {
    let smoothedPrice = point.price;

    if (config.mode === "ema") {
      const prevEma = state.lastEma ?? point.price;
      const nextEma = config.emaAlpha * point.price + (1 - config.emaAlpha) * prevEma;
      state.lastEma = nextEma;
      smoothedPrice = nextEma;
    } else {
      state.smaBuffer.push(point.price);
      state.smaSum += point.price;

      if (state.smaBuffer.length > config.smaWindow) {
        const removed = state.smaBuffer.shift();
        if (removed !== undefined) state.smaSum -= removed;
      }

      smoothedPrice = state.smaSum / state.smaBuffer.length;
    }

    const nextPoint: PricePoint = [point.timestamp, smoothedPrice];
    const lastPoint = nextSeries[nextSeries.length - 1];

    if (config.replaceLastOnSameTimestamp && lastPoint && lastPoint[0] === point.timestamp) {
      nextSeries[nextSeries.length - 1] = nextPoint;
    } else {
      nextSeries.push(nextPoint);
    }
  }

  if (nextSeries.length > config.maxPoints) {
    nextSeries.splice(0, nextSeries.length - config.maxPoints);
  }

  return nextSeries;
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
  const liveSmoothingRef = useRef<LiveSmoothingState>({
    lastEma: null,
    smaBuffer: [],
    smaSum: 0,
  });
  const incomingBufferRef = useRef<IncomingPricePoint[]>([]);
  const lastSeriesTimestampRef = useRef<number>(Date.now());

  const [timeframe,  setTimeframe]  = useState<Timeframe>("1D");
  const [showGold]   = useState(false);
  const [closeData,  setCloseData]  = useState<PricePoint[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [livePrice,  setLivePrice]  = useState<number | null>(null);
  const [change24h,  setChange24h]  = useState<number | null>(null);
  const [flash,      setFlash]      = useState<"up" | "down" | null>(null);
  const [goldPriceHistory, setGoldPriceHistory] = useState<PricePoint[]>([]);

  // ── Hover / scrub state ──────────────────────────────────────────────────────
  const chartWrapRef       = useRef<HTMLDivElement>(null);
  const hoverPctRef        = useRef<number>(0);
  const isPointerActiveRef = useRef(false);
  const [isInteracting,  setIsInteracting]  = useState(false);
  const [hoverPct,       setHoverPct]       = useState<number | null>(null);

  /** Actual SVG plot-area bounds read from the rendered DOM after each chart render. */
  const svgPlotRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  /** State copy of svgPlotRef — triggers a React re-render when plot bounds are first populated
   *  (needed for the animated live end-point dot to appear on first load). */
  const [plotBounds, setPlotBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

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

  // ── Historical price fetch (with cache) ──────────────────────────────────────
  useEffect(() => {
    const cached = getCachedPrices(timeframe);
    if (cached) {
      setCloseData(cached);
      incomingBufferRef.current = [];
      liveSmoothingRef.current = {
        lastEma: cached.length ? cached[cached.length - 1][1] : null,
        smaBuffer: [],
        smaSum: 0,
      };
      setLoading(false);
      return;
    }

    setLoading(true);
    const ctrl = new AbortController();
    fetchPrices(timeframe, ctrl.signal)
      .then((data) => {
        setCachedPrices(timeframe, data);
        setCloseData(data);
        incomingBufferRef.current = [];
        liveSmoothingRef.current = {
          lastEma: data.length ? data[data.length - 1][1] : null,
          smaBuffer: [],
          smaSum: 0,
        };
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (import.meta.env.DEV) console.error("[BtcLiveChart] fetch error:", err);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [timeframe]);

  useEffect(() => {
    if (closeData.length) {
      lastSeriesTimestampRef.current = closeData[closeData.length - 1][0];
    }
  }, [closeData]);

  // ── Shared Binance ticker — live price + throttled chart update ───────────────
  useEffect(() => {
    const unsubscribe = subscribeBtcTicker(({ price, changePct }) => {
      setLivePrice(price);
      setChange24h(changePct);

      // Flash effect on price change
      if (prevPriceRef.current !== null && price !== prevPriceRef.current) {
        const dir: "up" | "down" = price > prevPriceRef.current ? "up" : "down";
        setFlash(dir);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setFlash(null), 600);
      }
      prevPriceRef.current = price;

      incomingBufferRef.current.push({
        timestamp: lastSeriesTimestampRef.current,
        price,
      });

      // Throttled chart update — process buffered ticks in one pass for stable perf.
      const now = Date.now();
      if (now - lastChartUpdateRef.current >= CHART_UPDATE_THROTTLE_MS) {
        lastChartUpdateRef.current = now;
        const batch = incomingBufferRef.current;
        if (!batch.length) return;
        incomingBufferRef.current = [];

        setCloseData((prev) => {
          if (!prev.length) return prev;
          return smoothIncomingBatch(prev, batch, liveSmoothingRef.current, LIVE_SMOOTHING_CONFIG);
        });
      }
    });

    return () => {
      unsubscribe();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  // ── Read actual ApexCharts plot-area bounds from the rendered SVG ─────────────
  // ApexCharts' inner group translateY and gridRect height are the ground truth for
  // converting price→pixel. We re-read after every data change AND whenever the
  // element resizes (responsive layout) so the dot always snaps correctly.
  useEffect(() => {
    const readBounds = () => {
      if (!chartWrapRef.current) return;
      const inner    = chartWrapRef.current.querySelector<SVGGElement>(".apexcharts-inner");
      const gridRect = chartWrapRef.current.querySelector<SVGRectElement>(".apexcharts-gridRect");
      if (!inner || !gridRect) return;
      const m = (inner.getAttribute("transform") ?? "").match(
        /translate\(\s*([^,\s)]+)[,\s]+([^)]+)\)/,
      );
      const left = m ? parseFloat(m[1]) : PLOT_PAD_L;
      const top  = m ? parseFloat(m[2]) : PLOT_PAD_T;
      const w = parseFloat(gridRect.getAttribute("width")  ?? "0");
      const h = parseFloat(gridRect.getAttribute("height") ?? "0");
      if (w > 0 && h > 0) {
        svgPlotRef.current = { left, top, width: w, height: h };
        setPlotBounds({ left, top, width: w, height: h });
      }
    };

    const raf = requestAnimationFrame(readBounds);

    // Re-read whenever the chart container resizes (handles responsive layout changes).
    // Track the pending RAF id to avoid queuing multiple redundant callbacks during
    // rapid resize bursts (e.g., window drag-resize).
    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(readBounds);
    });
    if (chartWrapRef.current) ro.observe(chartWrapRef.current);

    return () => { cancelAnimationFrame(raf); cancelAnimationFrame(resizeRaf); ro.disconnect(); };
  }, [closeData, showGold]);

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
  const { highPoint, highIdx, lowPoint, lowIdx } = useMemo<{
    highPoint: PricePoint | null;
    highIdx:   number;
    lowPoint:  PricePoint | null;
    lowIdx:    number;
  }>(() => {
    if (!closeData.length) return { highPoint: null, highIdx: 0, lowPoint: null, lowIdx: 0 };
    let hi = closeData[0], lo = closeData[0], hiIdx = 0, loIdx = 0;
    for (let i = 1; i < closeData.length; i++) {
      if (closeData[i][1] > hi[1]) { hi = closeData[i]; hiIdx = i; }
      if (closeData[i][1] < lo[1]) { lo = closeData[i]; loIdx = i; }
    }
    return { highPoint: hi, highIdx: hiIdx, lowPoint: lo, lowIdx: loIdx };
  }, [closeData]);

  // ── High / Low for the BTC/Gold ratio series ──────────────────────────────────
  const { goldHighPoint, goldHighIdx, goldLowPoint, goldLowIdx } = useMemo<{
    goldHighPoint: PricePoint | null;
    goldHighIdx:   number;
    goldLowPoint:  PricePoint | null;
    goldLowIdx:    number;
  }>(() => {
    if (!showGold || !ratioData.length) {
      return { goldHighPoint: null, goldHighIdx: 0, goldLowPoint: null, goldLowIdx: 0 };
    }
    let hi = ratioData[0], lo = ratioData[0], hiIdx = 0, loIdx = 0;
    for (let i = 1; i < ratioData.length; i++) {
      if (ratioData[i][1] > hi[1]) { hi = ratioData[i]; hiIdx = i; }
      if (ratioData[i][1] < lo[1]) { lo = ratioData[i]; loIdx = i; }
    }
    return { goldHighPoint: hi, goldHighIdx: hiIdx, goldLowPoint: lo, goldLowIdx: loIdx };
  }, [showGold, ratioData]);

  // ── Y-axis bounds (with padding) — used by both the chart options and the dot position calc ───
  const { yAxisMin, yAxisMax } = useMemo<{ yAxisMin: number; yAxisMax: number }>(() => {
    if (!closeData.length) return { yAxisMin: 0, yAxisMax: 1 };
    let lo = closeData[0][1], hi = closeData[0][1];
    for (let i = 1; i < closeData.length; i++) {
      if (closeData[i][1] < lo) lo = closeData[i][1];
      if (closeData[i][1] > hi) hi = closeData[i][1];
    }
    const range = hi - lo;
    const pad = range > 0 ? range * Y_AXIS_PAD : Math.max(1, hi * 0.001);
    return { yAxisMin: lo - pad, yAxisMax: hi + pad };
  }, [closeData]);

  // ── Chart options ─────────────────────────────────────────────────────────────
  const options = useMemo<ApexOptions>(() => {
    // Series colors — BTC/USD = brand yellow, Gold overlay = emerald green
    const colors = showGold ? [BRAND_COLOR, "#10b981"] : [BRAND_COLOR];
    const strokeWidths = showGold ? [2, 1.5] : [2];
    const strokeDashes = showGold ? [0, 0] : [0];

    // Y-axis — hidden (we show high/low as point annotations instead)
    // Explicit min/max (with Y_AXIS_PAD) keeps the scale stable and lets the dot calc match.
    const yaxisConfig: ApexOptions["yaxis"] = showGold
      ? [
          {
            seriesName: "BTC/USD",
            opposite: true,
            min: yAxisMin,
            max: yAxisMax,
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
          min: yAxisMin,
          max: yAxisMax,
          labels: { show: false },
          axisBorder: { show: false },
          axisTicks: { show: false },
        };

    // ── High / low point annotations — text labels along x-axis, no dots ─────────
    const pointAnnotations: NonNullable<ApexOptions["annotations"]>["points"] = [];

    const labelStyle = {
      background: "transparent",
      color: "#9ca3af",
      fontSize: "11px",
      fontWeight: "500",
      padding: { top: 0, bottom: 0, left: 2, right: 2 },
    };

    const getOffsetX = (idx: number, total: number): number => {
      if (total < 2) return 0;
      const ratio = idx / (total - 1);
      if (ratio < 0.1) return 30;
      if (ratio > 0.9) return -30;
      return 0;
    };

    if (!showGold) {
      if (highPoint) {
        pointAnnotations.push({
          x: highPoint[0],
          y: highPoint[1],
          seriesIndex: 0,
          marker: { size: 0 },
          label: {
            text: `$${fmtNum(highPoint[1])}`,
            borderColor: "transparent",
            borderWidth: 0,
            borderRadius: 0,
            offsetY: -10,
            offsetX: getOffsetX(highIdx, closeData.length),
            style: labelStyle,
          },
        });
      }
      if (lowPoint) {
        pointAnnotations.push({
          x: lowPoint[0],
          y: lowPoint[1],
          seriesIndex: 0,
          marker: { size: 0 },
          label: {
            text: `$${fmtNum(lowPoint[1])}`,
            borderColor: "transparent",
            borderWidth: 0,
            borderRadius: 0,
            offsetY: 24,
            offsetX: getOffsetX(lowIdx, closeData.length),
            style: labelStyle,
          },
        });
      }
    } else {
      if (goldHighPoint) {
        pointAnnotations.push({
          x: goldHighPoint[0],
          y: goldHighPoint[1],
          seriesIndex: 1,
          yAxisIndex: 1,
          marker: { size: 0 },
          label: {
            text: `${goldHighPoint[1].toFixed(2)} oz`,
            borderColor: "transparent",
            borderWidth: 0,
            borderRadius: 0,
            offsetY: -10,
            offsetX: getOffsetX(goldHighIdx, ratioData.length),
            style: labelStyle,
          },
        });
      }
      if (goldLowPoint) {
        pointAnnotations.push({
          x: goldLowPoint[0],
          y: goldLowPoint[1],
          seriesIndex: 1,
          yAxisIndex: 1,
          marker: { size: 0 },
          label: {
            text: `${goldLowPoint[1].toFixed(2)} oz`,
            borderColor: "transparent",
            borderWidth: 0,
            borderRadius: 0,
            offsetY: 24,
            offsetX: getOffsetX(goldLowIdx, ratioData.length),
            style: labelStyle,
          },
        });
      }
    }

    return {
      chart: {
        id: "btc-live-price-chart",
        fontFamily: "Inter, sans-serif",
        type: "area",
        toolbar: { show: false },
        background: "transparent",
        zoom: { enabled: false },
        animations: {
          enabled: true,
          speed: 200,
          dynamicAnimation: { enabled: true, speed: 300 },
          animateGradually: { enabled: false },
        },
      },
      stroke: { curve: "smooth", width: strokeWidths, dashArray: strokeDashes },
      // Keep only the line; remove area fill to avoid panel-like glow under the chart.
      fill: { type: "solid", opacity: 0 },
      colors,
      dataLabels: { enabled: false },
      markers: SHOW_LINE_MARKERS ? { size: 2, hover: { size: 3 } } : { size: 0, hover: { size: 0 } },
      xaxis: {
        type: "datetime",
        axisBorder: { show: false },
        axisTicks:  { show: false },
        labels: { show: false },
        crosshairs: { show: false },
        tooltip:    { enabled: false },
      },
      yaxis: yaxisConfig,
      grid: {
        show: false,
        padding: { left: 8, right: 8, top: 28, bottom: 36 },
      },
      tooltip: {
        enabled: false,
      },
      annotations: {
        points: pointAnnotations,
      },
      legend: { show: false },
    };
  }, [showGold, highPoint, highIdx, lowPoint, lowIdx, goldHighPoint, goldHighIdx, goldLowPoint, goldLowIdx, closeData.length, ratioData.length, yAxisMin, yAxisMax]);

  // ── Derived display values ────────────────────────────────────────────────────
  const isUp      = change24h !== null ? change24h >= 0 : true;
  const flashClass =
    flash === "up"   ? "text-white" :
    flash === "down" ? "text-white" :
    "text-white";

  // % change over the currently loaded timeframe (first candle → live price)
  const tfChangePct = useMemo<number | null>(() => {
    if (!closeData.length) return null;
    const first = closeData[0][1];
    if (!first) return null;
    const last = livePrice ?? closeData[closeData.length - 1][1];
    return ((last - first) / first) * 100;
  }, [closeData, livePrice]);

  // ── Chart interaction helpers ─────────────────────────────────────────────────
  /** Converts a client-X pixel position into a [0,1] fraction across the chart wrapper. */
  function getChartFraction(clientX: number): number {
    if (!chartWrapRef.current) return 0;
    const r = chartWrapRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  }

  function deactivate(): void {
    isPointerActiveRef.current = false;
    setIsInteracting(false);
    setHoverPct(null);
  }

  // ── Mouse: crosshair appears on hover (no click-hold required) ───────────────
  // Inspired by react-native-simple-line-chart's immediate gesture activation —
  // the active point is shown as soon as the pointer enters the chart area.
  function onMouseMove(e: React.MouseEvent): void {
    const f = getChartFraction(e.clientX);
    hoverPctRef.current = f;
    if (!isPointerActiveRef.current) {
      isPointerActiveRef.current = true;
      setIsInteracting(true);
    }
    setHoverPct(f);
  }

  function onMouseLeave(): void { deactivate(); }

  // ── Touch: direction-locking gesture (no long-press delay) ───────────────────
  // A native, non-passive touchmove listener is registered via useEffect so that
  // e.preventDefault() can be called to suppress page-scroll when the user is
  // scrubbing horizontally — matching how react-native-simple-line-chart's
  // PanGestureHandler discriminates horizontal drags from vertical scrolls.
  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;

    let startX = 0, startY = 0;
    let direction: "h" | "v" | null = null;
    // Cache the bounding rect on touchstart so getBoundingClientRect() is not
    // called on every touchmove frame (avoids forced layout during fast scrubbing).
    let cachedRect = el.getBoundingClientRect();

    function onStart(e: TouchEvent) {
      // Ignore multi-touch — only track single-finger scrubbing.
      if (e.touches.length > 1) { direction = null; return; }
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      direction = null;
      cachedRect = el!.getBoundingClientRect(); // refresh once per gesture (el non-null: guarded above)
    }

    function onMove(e: TouchEvent) {
      // Bail on multi-touch or if we've already committed to vertical scroll.
      if (e.touches.length > 1 || direction === "v") return;
      const t = e.touches[0];
      if (!t) return;
      const dx = Math.abs(t.clientX - startX);
      const dy = Math.abs(t.clientY - startY);

      // Wait until the finger has moved at least TOUCH_SLOP pixels before committing
      // to a direction — avoids accidental activation on tiny taps.
      if (!direction) {
        if (dx < TOUCH_SLOP && dy < TOUCH_SLOP) return;
        direction = dx >= dy ? "h" : "v";
      }

      if (direction === "h") {
        e.preventDefault(); // suppress page-scroll while scrubbing
        const f = Math.max(0, Math.min(1, (t.clientX - cachedRect.left) / cachedRect.width));
        isPointerActiveRef.current = true;
        hoverPctRef.current = f;
        setIsInteracting(true);
        setHoverPct(f);
      }
    }

    function onEnd() {
      direction = null;
      if (isPointerActiveRef.current) {
        isPointerActiveRef.current = false;
        setIsInteracting(false);
        setHoverPct(null);
      }
    }

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove",  onMove,  { passive: false }); // non-passive for preventDefault
    el.addEventListener("touchend",   onEnd,   { passive: true });
    el.addEventListener("touchcancel", onEnd,  { passive: true });

    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove",  onMove);
      el.removeEventListener("touchend",   onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []); // stable refs / setState dispatchers — no deps needed

  // ── Compute ping + price-key position ────────────────────────────────────────
  let pingX = 0, pingY = 0, pingPrice: number | null = null, pingTimestamp: number | null = null, pingWrapW = 400;
  if (hoverPct !== null && isInteracting && closeData.length >= 2) {
    pingWrapW = chartWrapRef.current?.getBoundingClientRect().width ?? 400;

    // Use live SVG bounds when available (ground-truth from ApexCharts' rendered output),
    // fall back to hardcoded estimates only before the first render.
    const p = svgPlotRef.current;
    const plotLeft   = p?.left   ?? PLOT_PAD_L;
    const plotTop    = p?.top    ?? PLOT_PAD_T;
    const plotWidth  = p?.width  ?? (pingWrapW - PLOT_PAD_L - PLOT_PAD_R);
    const plotHeight = p?.height ?? (CHART_H   - PLOT_PAD_T - PLOT_PAD_B);

    const plotFrac = Math.max(0, Math.min(1, (hoverPct * pingWrapW - plotLeft) / plotWidth));
    const dataIdx  = Math.round(plotFrac * (closeData.length - 1));
    pingPrice     = closeData[dataIdx][1];
    pingTimestamp = closeData[dataIdx][0];
    // Snap pingX to the exact data-point column (not the raw cursor fraction)
    const snappedFrac = dataIdx / (closeData.length - 1);
    pingX = plotLeft + snappedFrac * plotWidth;
    // Map price to Y pixel using the same padded Y-axis bounds set on the chart
    const pFrac = yAxisMax > yAxisMin ? ((pingPrice as number) - yAxisMin) / (yAxisMax - yAxisMin) : 0.5;
    pingY = plotTop + (1 - pFrac) * plotHeight;
  }

  // ── Compute live end-point dot position (inspired by react-native-simple-line-chart
  //    endPointConfig.animated) — pulsing dot at the latest price when not interacting ──
  let liveDotX = 0, liveDotY = 0, showLiveDot = false;
  if (!isInteracting && !showGold && closeData.length >= 2 && plotBounds) {
    const p = plotBounds;
    const lastPrice = livePrice ?? closeData[closeData.length - 1][1];
    const pFrac = yAxisMax > yAxisMin ? (lastPrice - yAxisMin) / (yAxisMax - yAxisMin) : 0.5;
    liveDotX = p.left + p.width;
    liveDotY = p.top + (1 - pFrac) * p.height;
    showLiveDot = true;
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <section className="w-full px-1 py-1 sm:px-0">
      {/* Header row: live price */}
      <div className="mb-3 sm:mb-4">
        {/* Left: live price */}
        <div>
          <div className="mt-1 flex items-start gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center justify-center"
                  aria-hidden="true"
                >
                  <span
                    className="material-symbols-outlined text-[#FFD300] text-[24px] leading-none"
                    style={{ fontFamily: '"Material Symbols Outlined"', fontFeatureSettings: '"liga"' }}
                  >
                    currency_bitcoin
                  </span>
                </span>
                <span
                  className={`text-3xl font-semibold tabular-nums leading-none transition-colors duration-300 sm:text-4xl ${flashClass}`}
                  aria-live="polite"
                  aria-label={livePrice !== null ? `Bitcoin price $${fmtNum(livePrice)}` : "Loading"}
                >
                  {livePrice !== null ? `$${fmtNum(livePrice)}` : "—"}
                </span>
                {timeframe === "1D" && change24h !== null && (
                  <Badge color={change24h >= 0 ? "success" : "error"} size="sm">
                    {isUp ? <ArrowUpIcon /> : <ArrowDownIcon />}
                    {Math.abs(change24h).toFixed(2)}%
                  </Badge>
                )}
                {timeframe !== "1D" && tfChangePct !== null && (
                  <Badge color={tfChangePct >= 0 ? "success" : "error"} size="sm">
                    {tfChangePct >= 0 ? <ArrowUpIcon /> : <ArrowDownIcon />}
                    {Math.abs(tfChangePct).toFixed(2)}%
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div
        ref={chartWrapRef}
        className="relative -mx-3 overflow-hidden"
        aria-label="Bitcoin price chart"
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        style={{ cursor: isInteracting ? "crosshair" : "default", userSelect: "none" }}
      >
        <div className={`transition-opacity duration-300 ${loading ? "opacity-65" : "opacity-100"}`}>
          <Chart
            options={options}
            series={series}
            type="area"
            height={300}
          />
        </div>
        {/* Hairline at cursor position (only affects its own 1px column, never the background) */}
        {isInteracting && hoverPct !== null && closeData.length >= 2 && (
          <div
            aria-hidden="true"
            className="absolute pointer-events-none"
            style={{
              left: pingX,
              top: svgPlotRef.current?.top ?? PLOT_PAD_T,
              height: svgPlotRef.current?.height ?? (CHART_H - PLOT_PAD_T - PLOT_PAD_B),
              width: 1,
              backgroundColor: "rgba(156,163,175,0.5)",
              transform: "translateX(-0.5px)",
            }}
          />
        )}
        {/* Price key (only while holding) */}
        {pingPrice !== null && isInteracting && (
          <>
            <div
              aria-hidden="true"
              className={[
                "absolute z-20 pointer-events-none",
                "px-2 py-1 rounded shadow whitespace-nowrap",
                "flex flex-col items-start gap-0.5",
                "text-xs font-semibold",
                "bg-gray-900 text-white dark:bg-white dark:text-gray-900",
              ].join(" ")}
              style={
                pingX > pingWrapW * LABEL_FLIP_THRESHOLD
                  ? { left: pingX - 10, top: pingY - 22, transform: "translateX(-100%)" }
                  : { left: pingX + 10, top: pingY - 22 }
              }
            >
              {pingTimestamp !== null && (
                <span className="text-[10px] font-normal opacity-70">{fmtDate(pingTimestamp, timeframe)}</span>
              )}
              <span>${fmtNum(pingPrice)}</span>
            </div>
          </>
        )}
        {/* Animated live end-point dot — inspired by react-native-simple-line-chart's
            endPointConfig.animated; shows the latest price position at rest */}
        {showLiveDot && (
          <span
            aria-hidden="true"
            className="absolute pointer-events-none z-10 rounded-full border-2 border-white dark:border-gray-900 shadow-sm"
            style={{
              width: 10, height: 10,
              left: liveDotX - 5, top: liveDotY - 5,
              backgroundColor: BRAND_COLOR,
            }}
          />
        )}
      </div>

      {/* Timeframe tabs below chart */}
      <div className="mt-3 px-2 sm:px-4">
        <div
          className="grid grid-cols-6 items-center gap-1 sm:gap-2"
          role="tablist"
          aria-label="Chart timeframe"
        >
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              role="tab"
              aria-selected={timeframe === tf}
              onClick={() => setTimeframe(tf)}
              className={`w-full rounded-md px-1 py-1.5 text-center text-xs font-semibold transition-colors sm:px-2 sm:text-sm ${
                timeframe === tf
                  ? "text-[#FFD300]"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

    </section>
  );
}
