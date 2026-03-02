import { useEffect, useRef, useState } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  PriceScaleMode,
  LineStyle,
  CrosshairMode,
  ColorType,
  UTCTimestamp,
  CandlestickData,
  LineData,
  IPriceLine,
} from "lightweight-charts";
import { ArrowUpIcon, ArrowDownIcon } from "../../icons";
import Badge from "../ui/badge/Badge";

// ── Types ──────────────────────────────────────────────────────────────────────
type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y" | "ALL";
type OHLCPoint = CandlestickData<UTCTimestamp>;
type MAPoint = LineData<UTCTimestamp>;

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
const MA_PERIOD = 20;
const ATH_CACHE_KEY = "btc-ath";
const ATH_CACHE_TTL = 86_400_000; // 24 hours

// ── Helpers (module-level to use in closures) ─────────────────────────────────
function fmtNum(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Cache helpers ──────────────────────────────────────────────────────────────
function getCachedOHLC(tf: Timeframe): OHLCPoint[] | null {
  try {
    const raw = localStorage.getItem(`btc-ohlc-${tf}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { data: OHLCPoint[]; fetchedAt: number };
    if (Date.now() - entry.fetchedAt > TF_CONFIG[tf].cacheTTL) return null;
    return entry.data;
  } catch { return null; }
}

function setCachedOHLC(tf: Timeframe, data: OHLCPoint[]): void {
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
async function fetchOHLC(tf: Timeframe, signal: AbortSignal): Promise<OHLCPoint[]> {
  const { interval, limit } = TF_CONFIG[tf];
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // kline tuple: [openTime, open, high, low, close, volume, closeTime, ...]
  const raw = (await res.json()) as [number, string, string, string, string, ...unknown[]][];
  return raw.map((k) => ({
    time:  Math.floor((k[0] as number) / 1000) as UTCTimestamp,
    open:  parseFloat(k[1]),
    high:  parseFloat(k[2]),
    low:   parseFloat(k[3]),
    close: parseFloat(k[4]),
  }));
}

// ── Simple moving average (sliding window, O(n)) ──────────────────────────────
function calcSMA(data: OHLCPoint[], period: number): MAPoint[] {
  const result: MAPoint[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= period) sum -= data[i - period].close;
    if (i >= period - 1) result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function BtcLiveChart() {
  // DOM refs
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const tooltipRef        = useRef<HTMLDivElement>(null);

  // Chart instance refs (never trigger re-renders)
  const chartRef       = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const maSeriesRef    = useRef<ISeriesApi<"Line"> | null>(null);
  const athLineRef     = useRef<IPriceLine | null>(null);
  const lastCandleRef  = useRef<OHLCPoint | null>(null);

  // Value refs used in callbacks to avoid stale closures
  const athRef      = useRef<number | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // React state (triggers re-renders)
  const [timeframe,  setTimeframe]  = useState<Timeframe>("1D");
  const [logScale,   setLogScale]   = useState(false);
  const [showMA,     setShowMA]     = useState(false);
  const [ohlcData,   setOhlcData]   = useState<OHLCPoint[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [livePrice,  setLivePrice]  = useState<number | null>(null);
  const [change24h,  setChange24h]  = useState<number | null>(null);
  const [flash,      setFlash]      = useState<"up" | "down" | null>(null);
  const [ath,        setATH]        = useState<number | null>(null);

  // Keep athRef in sync for use in crosshair callback
  useEffect(() => { athRef.current = ath; }, [ath]);

  // ── ATH fetch on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    const cached = getCachedATH();
    if (cached !== null) { setATH(cached); return; }
    const ctrl = new AbortController();
    fetchOHLC("ALL", ctrl.signal)
      .then((data) => {
        const maxHigh = data.reduce((m, d) => (d.high > m ? d.high : m), -Infinity);
        setCachedATH(maxHigh);
        setATH(maxHigh);
      })
      .catch(() => { /* non-critical — ATH line simply won't render */ });
    return () => ctrl.abort();
  }, []);

  // ── Historical OHLC fetch (with cache) ──────────────────────────────────────
  useEffect(() => {
    const cached = getCachedOHLC(timeframe);
    if (cached) { setOhlcData(cached); setLoading(false); return; }

    setLoading(true);
    const ctrl = new AbortController();
    fetchOHLC(timeframe, ctrl.signal)
      .then((data) => { setCachedOHLC(timeframe, data); setOhlcData(data); setLoading(false); })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (import.meta.env.DEV) console.error("[BtcLiveChart] fetch error:", err);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [timeframe]);

  // ── Chart initialization (once on mount) ─────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#6B7280",
        fontFamily: "Inter, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#374151", style: LineStyle.Dotted },
        horzLines: { color: "#374151", style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
      },
      rightPriceScale: {
        borderColor: "transparent",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: "transparent",
        timeVisible: true,
        secondsVisible: false,
      },
      // Mobile-friendly scroll & pinch gestures
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        axisPressedMouseMove: true,
        pinch: true,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:        "#10b981",
      downColor:      "#ef4444",
      borderUpColor:  "#10b981",
      borderDownColor:"#ef4444",
      wickUpColor:    "#10b981",
      wickDownColor:  "#ef4444",
    });

    chartRef.current        = chart;
    candleSeriesRef.current = candleSeries;

    // ── Custom crosshair tooltip ─────────────────────────────────────────────
    const tooltipEl = tooltipRef.current;
    chart.subscribeCrosshairMove((param) => {
      if (!tooltipEl || !chartContainerRef.current) return;

      if (
        !param.point ||
        !param.time  ||
        param.point.x < 0 ||
        param.point.y < 0 ||
        param.point.x > chartContainerRef.current.clientWidth ||
        param.point.y > chartContainerRef.current.clientHeight
      ) {
        tooltipEl.style.display = "none";
        return;
      }

      const bar = param.seriesData.get(candleSeries) as OHLCPoint | undefined;
      if (!bar) { tooltipEl.style.display = "none"; return; }

      const ts = (bar.time as number) * 1000;
      const dateStr = new Date(ts).toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
      const athNow = athRef.current;

      // Build tooltip via DOM to avoid XSS risk from locale-formatted strings
      tooltipEl.replaceChildren();

      const dateLine = document.createElement("div");
      dateLine.style.cssText = "font-size:10px;color:#9CA3AF;margin-bottom:4px;";
      dateLine.textContent = dateStr;
      tooltipEl.appendChild(dateLine);

      const grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:12px 1fr;gap:2px 8px;font-size:11px;font-family:monospace;";
      const rows: [string, string, string][] = [
        ["O", "#F3F4F6", `$${fmtNum(bar.open)}`],
        ["H", "#10b981", `$${fmtNum(bar.high)}`],
        ["L", "#ef4444", `$${fmtNum(bar.low)}`],
        ["C", "#F3F4F6", `$${fmtNum(bar.close)}`],
      ];
      for (const [label, color, val] of rows) {
        const lbl = document.createElement("span");
        lbl.style.color = "#6B7280";
        lbl.textContent = label;
        const v = document.createElement("span");
        v.style.color = color;
        v.textContent = val;
        grid.appendChild(lbl);
        grid.appendChild(v);
      }
      tooltipEl.appendChild(grid);

      if (athNow !== null) {
        const athDiv = document.createElement("div");
        athDiv.style.cssText = "margin-top:4px;padding-top:4px;border-top:1px solid #374151;font-size:10px;color:#f59e0b;";
        athDiv.textContent = `ATH $${fmtNum(athNow)}`;
        tooltipEl.appendChild(athDiv);
      }

      tooltipEl.style.display = "block";

      const cw = chartContainerRef.current.clientWidth;
      const ch = chartContainerRef.current.clientHeight;
      const tw = tooltipEl.offsetWidth  || 160;
      const th = tooltipEl.offsetHeight || 110;
      let left = param.point.x + 14;
      let top  = param.point.y - th / 2;
      if (left + tw > cw) left = param.point.x - tw - 14;
      if (top < 4) top = 4;
      if (top + th > ch - 4) top = ch - th - 4;
      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top  = `${top}px`;
    });

    return () => {
      chart.remove();
      chartRef.current        = null;
      candleSeriesRef.current = null;
      maSeriesRef.current     = null;
      athLineRef.current      = null;
    };
  }, []); // run once on mount

  // ── Update candlestick data when ohlcData changes ───────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !ohlcData.length) return;
    lastCandleRef.current = ohlcData[ohlcData.length - 1];
    series.setData(ohlcData);
    chartRef.current?.timeScale().fitContent();
  }, [ohlcData]);

  // ── Log / linear scale toggle ────────────────────────────────────────────────
  useEffect(() => {
    chartRef.current?.priceScale("right").applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [logScale]);

  // ── MA series toggle + data update ──────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (showMA) {
      if (!maSeriesRef.current) {
        maSeriesRef.current = chart.addSeries(LineSeries, {
          color:             "#f59e0b",
          lineWidth:         1,
          lineStyle:         LineStyle.Dashed,
          priceLineVisible:  false,
          lastValueVisible:  false,
        });
      }
      if (ohlcData.length > MA_PERIOD) {
        maSeriesRef.current.setData(calcSMA(ohlcData, MA_PERIOD));
      }
    } else if (maSeriesRef.current) {
      chart.removeSeries(maSeriesRef.current);
      maSeriesRef.current = null;
    }
  }, [showMA, ohlcData]);

  // ── ATH reference price line ─────────────────────────────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || ath === null) return;
    if (athLineRef.current) {
      try { series.removePriceLine(athLineRef.current); } catch (e) {
        if (import.meta.env.DEV) console.warn("[BtcLiveChart] removePriceLine:", e);
      }
    }
    athLineRef.current = series.createPriceLine({
      price:            ath,
      color:            "#f59e0b",
      lineWidth:        1,
      lineStyle:        LineStyle.Dashed,
      axisLabelVisible: true,
      title:            "ATH",
    });
  }, [ath]);

  // ── Binance WebSocket — live price + real-time candle update ─────────────────
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

        // Update last candle in chart without re-fetching
        const last = lastCandleRef.current;
        if (candleSeriesRef.current && last) {
          const updated: OHLCPoint = {
            time:  last.time,
            open:  last.open,
            high:  Math.max(last.high, price),
            low:   Math.min(last.low,  price),
            close: price,
          };
          candleSeriesRef.current.update(updated);
          lastCandleRef.current = updated;
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

  // ── Derived display values ────────────────────────────────────────────────────
  const isUp      = change24h !== null ? change24h >= 0 : true;
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
          <div className="flex flex-wrap items-baseline gap-2 mt-1 ml-8">
            <span
              className={`text-2xl font-bold tabular-nums transition-colors duration-300 ${flashClass}`}
              aria-live="polite"
              aria-label={livePrice !== null ? `Bitcoin price $${fmtNum(livePrice)}` : "Loading"}
            >
              {livePrice !== null ? `$${fmtNum(livePrice)}` : "—"}
            </span>
            {change24h !== null && (
              <Badge color={change24h >= 0 ? "success" : "error"}>
                {isUp ? <ArrowUpIcon /> : <ArrowDownIcon />}
                {Math.abs(change24h).toFixed(2)}%
              </Badge>
            )}
            {ath !== null && (
              <span className="text-xs font-medium text-amber-500 tabular-nums">
                ATH ${fmtNum(ath)}
              </span>
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
        {loading && (
          <div className="absolute inset-0 z-10 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
        )}
        <div ref={chartContainerRef} className="h-full w-full" />
        {/* Floating OHLC tooltip */}
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute z-20 hidden rounded-lg shadow-xl"
          style={{
            background: "rgba(17,24,39,0.92)",
            backdropFilter: "blur(6px)",
            border: "1px solid #374151",
            padding: "8px 10px",
            minWidth: "152px",
          }}
        />
      </div>

      <p className="mt-2 text-center text-[10px] text-gray-400 dark:text-gray-600 select-none">
        Drag to pan · Scroll / pinch to zoom
      </p>
    </div>
  );
}
