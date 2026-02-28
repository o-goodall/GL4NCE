import { useEffect, useState } from "react";
import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";
import { ArrowUpIcon, ArrowDownIcon } from "../../icons";

// ── Constants ─────────────────────────────────────────────────────────────────
const GOLD_POLL_MS = 10 * 60 * 1000;  // 10 minutes
const MAX_HISTORY  = 4320;             // ~30 days at one point per 10 min
const LS_KEY       = "btcgold_ratio_history";
const TREND_WINDOW = 6;                // Compare current vs. ~1 h ago

// ── Types ─────────────────────────────────────────────────────────────────────
interface RatioPoint {
  t: number;   // Unix ms timestamp
  r: number;   // BTC/Gold ratio
  b: number;   // BTC price USD
  g: number;   // Gold price USD/oz
}

// ── localStorage helpers ──────────────────────────────────────────────────────
function loadHistory(): RatioPoint[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as RatioPoint[];
  } catch { /* ignore */ }
  return [];
}

function saveHistory(pts: RatioPoint[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(pts));
  } catch { /* ignore storage errors */ }
}

// ── Gold price fetch ──────────────────────────────────────────────────────────
async function fetchGoldPriceUSD(signal: AbortSignal): Promise<number> {
  // Proxied through /api/gold-price (Vercel serverless) to avoid CORS.
  // Sourced from Yahoo Finance GC=F (gold futures, USD/troy oz).
  const res = await fetch("/api/gold-price", { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { price: number };
  if (!data.price || isNaN(data.price)) throw new Error("Invalid gold price response");
  return data.price;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function BtcGoldRatio() {
  const [btcPrice,    setBtcPrice]    = useState<number | null>(null);
  const [goldPrice,   setGoldPrice]   = useState<number | null>(null);
  const [history,     setHistory]     = useState<RatioPoint[]>(() => loadHistory());
  const [showTooltip, setShowTooltip] = useState(false);

  // ── Binance WebSocket — live BTC/USDT ──────────────────────────────────────
  useEffect(() => {
    const ws = new WebSocket(
      "wss://stream.binance.com:9443/stream?streams=btcusdt@ticker"
    );

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          stream: string;
          data: Record<string, string>;
        };
        if (msg.stream === "btcusdt@ticker") {
          const price = parseFloat(msg.data["c"]);
          if (!isNaN(price)) {
            setBtcPrice(price);
          }
        }
      } catch { /* ignore malformed frames */ }
    };

    if (import.meta.env.DEV) {
      ws.onerror = () => console.error("[BtcGoldRatio] WebSocket error");
    }

    return () => {
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        ws.close();
      }
    };
  }, []);

  // ── Gold price poll ────────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();

    const poll = () => {
      fetchGoldPriceUSD(controller.signal)
        .then((price) => {
          setGoldPrice(price);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (import.meta.env.DEV) {
            console.error("[BtcGoldRatio] Gold price fetch error:", err);
          }
        });
    };

    poll();
    const interval = setInterval(poll, GOLD_POLL_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  // ── Record a history point each time gold price refreshes ─────────────────
  useEffect(() => {
    if (goldPrice === null || btcPrice === null) return;

    const point: RatioPoint = {
      t: Date.now(),
      r: btcPrice / goldPrice,
      b: btcPrice,
      g: goldPrice,
    };

    setHistory((prev) => {
      const updated = [...prev, point].slice(-MAX_HISTORY);
      saveHistory(updated);
      return updated;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goldPrice]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const ratio = btcPrice !== null && goldPrice !== null
    ? btcPrice / goldPrice
    : null;

  // Trend: compare live ratio against TREND_WINDOW points ago
  const trend: "up" | "down" | null = (() => {
    if (ratio === null || history.length < TREND_WINDOW) return null;
    const ref = history[history.length - TREND_WINDOW].r;
    if (ratio > ref) return "up";
    if (ratio < ref) return "down";
    return null;
  })();

  // Sparkline: historical ratios + live current point
  const sparkData: number[] = [
    ...history.map((p) => p.r),
    ...(ratio !== null ? [ratio] : []),
  ];

  // ── Chart config ───────────────────────────────────────────────────────────
  const sparklineColor = trend === "down" ? "#ef4444" : "#22c55e";

  const sparklineOptions: ApexOptions = {
    chart: {
      type: "line",
      sparkline: { enabled: true },
      animations: { enabled: false },
      fontFamily: "Inter, sans-serif",
    },
    stroke: { curve: "smooth", width: 2 },
    colors: [sparklineColor],
    tooltip: { enabled: false },
  };

  // ── Formatters ─────────────────────────────────────────────────────────────
  const fmt = (n: number, decimals = 2) =>
    n.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 flex flex-col h-full">
      {/* Tile badge */}
      <span className="absolute top-3 right-3 flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
        3
      </span>

      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          BTC / Gold
        </h3>
      </div>

      {/* Ratio + trend row */}
      <div className="flex items-end justify-between mt-5">
        {/* Ratio value with hover tooltip */}
        <div
          className="relative"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <div className="flex items-baseline gap-1.5 cursor-default">
            <span className="text-2xl font-bold text-gray-800 dark:text-white/90">
              {ratio !== null ? fmt(ratio, 2) : "—"}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">oz</span>
          </div>

          {/* Hover tooltip */}
          {showTooltip && ratio !== null && (
            <div className="absolute bottom-full left-0 mb-2 z-10 min-w-[160px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800">
              <div className="flex justify-between gap-3">
                <span className="text-gray-500 dark:text-gray-400">BTC</span>
                <span className="font-semibold text-gray-800 dark:text-white">
                  {btcPrice !== null ? `$${fmt(btcPrice)}` : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-3 mt-0.5">
                <span className="text-gray-500 dark:text-gray-400">Gold</span>
                <span className="font-semibold text-gray-800 dark:text-white">
                  {goldPrice !== null ? `$${fmt(goldPrice)}/oz` : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-3 mt-0.5 border-t border-gray-100 dark:border-gray-700 pt-0.5">
                <span className="text-gray-500 dark:text-gray-400">Ratio</span>
                <span className="font-semibold text-gray-800 dark:text-white">
                  {fmt(ratio, 2)} oz
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Trend arrow */}
        {trend === "up" && (
          <span className="flex items-center gap-1 text-emerald-500 text-sm font-semibold">
            <ArrowUpIcon className="w-4 h-4" />
            Rising
          </span>
        )}
        {trend === "down" && (
          <span className="flex items-center gap-1 text-red-500 text-sm font-semibold">
            <ArrowDownIcon className="w-4 h-4" />
            Falling
          </span>
        )}
      </div>

      {/* Sub-labels */}
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-400 dark:text-gray-500">
        <span>
          BTC{" "}
          <span className="text-gray-600 dark:text-gray-300">
            {btcPrice !== null ? `$${fmt(btcPrice)}` : "—"}
          </span>
        </span>
        <span>
          Gold{" "}
          <span className="text-gray-600 dark:text-gray-300">
            {goldPrice !== null ? `$${fmt(goldPrice)}/oz` : "—"}
          </span>
        </span>
      </div>

      {/* Sparkline */}
      <div className="mt-3 -mx-1 flex-1 min-h-[80px]">
        {sparkData.length > 1 ? (
          <Chart
            options={sparklineOptions}
            series={[{ data: sparkData }]}
            type="line"
            height="100%"
          />
        ) : (
          <div className="flex h-full min-h-[80px] items-center justify-center text-xs text-gray-400 dark:text-gray-600">
            Collecting data…
          </div>
        )}
      </div>
    </div>
  );
}
