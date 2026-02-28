import { useEffect, useState } from "react";
import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";

// ── Constants ─────────────────────────────────────────────────────────────────
const GOLD_POLL_MS = 10 * 60 * 1000; // 10 minutes

// Known all-time high — BTC $106,182 / Gold $2,632 on 17 Dec 2024
const INITIAL_ATH = { ratio: 38.51, date: "17 Dec 2024" };

// ── Historical BTC/Gold ratio (oz) — monthly averages Mar 2025 – Feb 2026 ────
// BTC avg (USD): 83471, 89488, 102055, 107547, 115709, 113267, 111800, 107532, 94841, 87761, 82886, 69485
// Gold avg (USD/oz): 2983, 3208, 3278, 3352, 3338, 3363, 3665, 4053, 4083, 4290, 4745, 5278
// Ratio = BTC / Gold, rounded to 1 dp  (sources: CoinGecko, Trading Economics)
const HISTORY_MONTHS = [
  "Mar '25","Apr '25","May '25","Jun '25","Jul '25","Aug '25",
  "Sep '25","Oct '25","Nov '25","Dec '25","Jan '26","Feb '26",
];
const HISTORY_RATIOS = [28.0, 27.9, 31.1, 32.1, 34.7, 33.7, 30.5, 26.5, 23.2, 20.5, 17.5, 13.2];

// ── Chart config ──────────────────────────────────────────────────────────────
const chartOptions: ApexOptions = {
  colors: ["#FFD300"],
  chart: {
    fontFamily: "Inter, sans-serif",
    type: "bar",
    height: 180,
    toolbar: { show: false },
    background: "transparent",
  },
  plotOptions: {
    bar: {
      horizontal: false,
      columnWidth: "39%",
      borderRadius: 5,
      borderRadiusApplication: "end",
    },
  },
  dataLabels: { enabled: false },
  stroke: { show: true, width: 4, colors: ["transparent"] },
  xaxis: {
    categories: HISTORY_MONTHS,
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: {
      style: { fontSize: "11px", colors: "#6B7280" },
      rotate: 0,
    },
    tooltip: { enabled: false },
  },
  yaxis: {
    labels: {
      style: { fontSize: "12px", colors: ["#6B7280"] },
      formatter: (v: number) => `${v}`,
    },
  },
  grid: { yaxis: { lines: { show: true } } },
  fill: { opacity: 1 },
  tooltip: {
    x: { show: true },
    y: { formatter: (v: number) => `${v} oz / BTC` },
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
  const [ath, setAth] = useState(INITIAL_ATH);

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
    n.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      {/* Badge */}
      <span className="absolute top-3 right-3 flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-400">
        3
      </span>

      {/* Header row */}
      <div className="flex items-start justify-between mb-1">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          BTC / Gold
        </h3>

        {/* Live ratio + ATH — leave room for the badge */}
        <div className="text-right mr-8">
          <div className="flex items-baseline gap-1 justify-end">
            <span className="text-2xl font-bold text-gray-800 dark:text-white/90">
              {ratio !== null ? fmt(ratio, 1) : "—"}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">oz</span>
          </div>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            ATH{" "}
            <span className="text-amber-500 dark:text-amber-400 font-medium">
              {ath.ratio} oz
            </span>
          </div>
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
      <div className="overflow-x-auto">
        <div className="min-w-[480px]">
          <Chart options={chartOptions} series={chartSeries} type="bar" height={160} />
        </div>
      </div>
    </div>
  );
}

