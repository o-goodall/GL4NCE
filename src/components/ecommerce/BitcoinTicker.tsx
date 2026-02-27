import { useEffect, useRef, useState } from "react";
import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";

interface TickerData {
  priceUSD: number | null;
  priceAUD: number | null;
  changePercentUSD: number | null;
  changePercentAUD: number | null;
}

type FlashState = "up" | "down" | null;

const MAX_SPARKLINE_POINTS = 30;

export default function BitcoinTicker() {
  const [ticker, setTicker] = useState<TickerData>({
    priceUSD: null,
    priceAUD: null,
    changePercentUSD: null,
    changePercentAUD: null,
  });
  const [sparkline, setSparkline] = useState<number[]>([]);
  const [flash, setFlash] = useState<FlashState>(null);
  const prevUSD = useRef<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ws = new WebSocket(
      "wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/btcaud@ticker"
    );

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          stream: string;
          data: Record<string, string>;
        };
        const { stream, data } = msg;

        if (stream === "btcusdt@ticker") {
          const price = parseFloat(data["c"]);
          const pct = parseFloat(data["P"]);
          setTicker((prev: TickerData) => ({
            ...prev,
            priceUSD: price,
            changePercentUSD: pct,
          }));
          // Sparkline
          setSparkline((pts: number[]) => {
            const next = [...pts, price];
            return next.length > MAX_SPARKLINE_POINTS
              ? next.slice(next.length - MAX_SPARKLINE_POINTS)
              : next;
          });
          // Flash
          if (prevUSD.current !== null) {
            const direction: FlashState = price > prevUSD.current ? "up" : price < prevUSD.current ? "down" : null;
            if (direction) {
              setFlash(direction);
              if (flashTimer.current) clearTimeout(flashTimer.current);
              flashTimer.current = setTimeout(() => setFlash(null), 600);
            }
          }
          prevUSD.current = price;
        } else if (stream === "btcaud@ticker") {
          const price = parseFloat(data["c"]);
          const pct = parseFloat(data["P"]);
          setTicker((prev: TickerData) => ({ ...prev, priceAUD: price, changePercentAUD: pct }));
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error("[BitcoinTicker] Failed to parse WebSocket message:", err);
        }
      }
    };

    ws.onerror = () => {
      if (import.meta.env.DEV) {
        console.error("[BitcoinTicker] WebSocket error");
      }
    };

    return () => {
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        ws.close();
      }
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const fmt = (n: number, decimals = 2) =>
    n.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  const pctColor = (pct: number | null) =>
    pct === null ? "text-gray-400" : pct >= 0 ? "text-emerald-500" : "text-red-500";

  const flashClass =
    flash === "up"
      ? "text-emerald-500"
      : flash === "down"
        ? "text-red-500"
        : "text-gray-800 dark:text-white/90";

  const sparklineOptions: ApexOptions = {
    chart: {
      type: "line",
      sparkline: { enabled: true },
      animations: { enabled: false },
    },
    stroke: { curve: "smooth", width: 2 },
    colors: ["#465fff"],
    tooltip: { enabled: false },
  };

  const sparklineSeries = [{ data: sparkline.length > 1 ? sparkline : [0, 0] }];

  return (
    <div className="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <span className="absolute top-3 right-3 flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        1
      </span>

      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <svg
          className="w-5 h-5 text-orange-400"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M11.5 2C6.81 2 3 5.81 3 10.5S6.81 19 11.5 19 20 15.19 20 10.5 16.19 2 11.5 2zm.75 12.25v.75h-1.5v-.75c-1.24-.27-2.25-1.13-2.25-2.5h1.5c0 .69.67 1.25 2.25 1.25s2.25-.56 2.25-1.25c0-.63-.45-1.25-2.25-1.25-2.19 0-3.75-.94-3.75-2.75 0-1.37 1.01-2.23 2.25-2.5V5h1.5v.75c1.24.27 2.25 1.13 2.25 2.5h-1.5c0-.69-.67-1.25-2.25-1.25S8.5 7.56 8.5 8.25c0 .63.45 1.25 2.25 1.25 2.19 0 3.75.94 3.75 2.75 0 1.37-1.01 2.23-2.25 2.5z" />
        </svg>
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
          Bitcoin
        </span>
      </div>

      {/* Prices row */}
      <div className="flex items-baseline gap-3 flex-wrap">
        {/* USD — primary */}
        <div className="flex items-baseline gap-1.5">
          <span
            className={`text-2xl font-bold transition-colors duration-300 ${flashClass}`}
          >
            {ticker.priceUSD !== null ? `$${fmt(ticker.priceUSD)}` : "—"}
          </span>
          {ticker.changePercentUSD !== null && (
            <span className={`text-sm font-medium ${pctColor(ticker.changePercentUSD)}`}>
              ({ticker.changePercentUSD >= 0 ? "+" : ""}
              {fmt(ticker.changePercentUSD)}%)
            </span>
          )}
        </div>

        <span className="text-gray-300 dark:text-gray-700 text-lg font-light">|</span>

        {/* AUD — secondary */}
        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-semibold text-gray-500 dark:text-gray-400">
            {ticker.priceAUD !== null ? `A$${fmt(ticker.priceAUD)}` : "—"}
          </span>
          {ticker.changePercentAUD !== null && (
            <span className={`text-xs font-medium ${pctColor(ticker.changePercentAUD)}`}>
              ({ticker.changePercentAUD >= 0 ? "+" : ""}
              {fmt(ticker.changePercentAUD)}%)
            </span>
          )}
        </div>
      </div>

      {/* Sparkline */}
      <div className="mt-3 -mx-1">
        <Chart
          options={sparklineOptions}
          series={sparklineSeries}
          type="line"
          height={50}
        />
      </div>
    </div>
  );
}
