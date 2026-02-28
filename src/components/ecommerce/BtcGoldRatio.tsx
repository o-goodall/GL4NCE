import { useEffect, useState } from "react";
import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";

// ── Constants ─────────────────────────────────────────────────────────────────
const GOLD_POLL_MS = 10 * 60 * 1000; // 10 minutes

// ── Historical BTC/Gold ratio (oz) — monthly averages Mar 2025 – Feb 2026 ────
const HISTORY_MONTHS = ["Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb"];
const HISTORY_RATIOS = [28.1, 27.6, 31.4, 32.8, 36.2, 31.5, 22.9, 24.1, 33.5, 36.8, 36.1, 32.4];

// ── Chart config ──────────────────────────────────────────────────────────────
const chartOptions: ApexOptions = {
  colors: ["#FFD300"],
  chart: {
    fontFamily: "Inter, sans-serif",
    type: "bar",
    height: 160,
    toolbar: { show: false },
    background: "transparent",
  },
  plotOptions: {
    bar: {
      horizontal: false,
      columnWidth: "39%",
      borderRadius: 4,
      borderRadiusApplication: "end",
    },
  },
  dataLabels: { enabled: false },
  stroke: { show: true, width: 4, colors: ["transparent"] },
  xaxis: {
    categories: HISTORY_MONTHS,
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: { style: { fontSize: "11px", colors: "#9CA3AF" } },
  },
  yaxis: {
    labels: {
      style: { fontSize: "11px", colors: ["#9CA3AF"] },
      formatter: (v: number) => `${v}oz`,
    },
  },
  grid: { yaxis: { lines: { show: true } }, borderColor: "#F3F4F6" },
  fill: { opacity: 1 },
  tooltip: {
    x: { show: false },
    y: { formatter: (v: number) => `${v} oz` },
  },
  legend: { show: false },
};

const chartSeries = [{ name: "BTC/Gold (oz)", data: HISTORY_RATIOS }];

// ── Gold price fetch ──────────────────────────────────────────────────────────
async function fetchGoldPrice(signal: AbortSignal): Promise<number> {
  const res = await fetch("/api/gold-price", { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { price: number };
  if (!data.price || isNaN(data.price)) throw new Error("Invalid gold price");
  return data.price;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function BtcGoldRatio() {
  const [btcPrice,  setBtcPrice]  = useState<number | null>(null);
  const [goldPrice, setGoldPrice] = useState<number | null>(null);

  // Live BTC price via Binance WebSocket (same stream as BitcoinTicker)
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
          if (!isNaN(price)) setBtcPrice(price);
        }
      } catch { /* ignore malformed frames */ }
    };

    ws.onerror = () => {
      if (import.meta.env.DEV) console.error("[BtcGoldRatio] WebSocket error");
    };

    return () => {
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        ws.close();
      }
    };
  }, []);

  // Poll gold price every 10 min
  useEffect(() => {
    const ctrl = new AbortController();
    const poll = () =>
      fetchGoldPrice(ctrl.signal).then(setGoldPrice).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (import.meta.env.DEV) console.error("[BtcGoldRatio] Gold fetch error:", err);
      });
    poll();
    const id = setInterval(poll, GOLD_POLL_MS);
    return () => { ctrl.abort(); clearInterval(id); };
  }, []);

  const ratio =
    btcPrice !== null && goldPrice !== null ? btcPrice / goldPrice : null;

  const fmt = (n: number, decimals = 2) =>
    n.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
      {/* Header row */}
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
            3
          </span>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            BTC / Gold
          </h3>
        </div>

        {/* Live ratio */}
        <div className="flex items-baseline gap-1 text-right">
          <span className="text-2xl font-bold text-gray-800 dark:text-white/90">
            {ratio !== null ? fmt(ratio, 1) : "—"}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">oz</span>
        </div>
      </div>

      {/* Sub-labels */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-400 dark:text-gray-500 mb-2">
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
        <span className="text-gray-300 dark:text-gray-600">12-month history</span>
      </div>

      {/* Bar chart */}
      <div className="max-w-full overflow-x-auto custom-scrollbar">
        <div className="-ml-4 min-w-[500px] xl:min-w-full">
          <Chart options={chartOptions} series={chartSeries} type="bar" height={160} />
        </div>
      </div>
    </div>
  );
}

