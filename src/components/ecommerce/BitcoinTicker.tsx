import { useEffect, useRef, useState } from "react";
import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";
import { ArrowUpIcon, ArrowDownIcon } from "../../icons";
import Badge from "../ui/badge/Badge";

interface TickerData {
  priceUSD: number | null;
  changePercentUSD: number | null;
}

type FlashState = "up" | "down" | null;

const MAX_SPARKLINE_POINTS = 30;

export default function BitcoinTicker() {
  const [ticker, setTicker] = useState<TickerData>({
    priceUSD: null,
    changePercentUSD: null,
  });
  const [sparkline, setSparkline] = useState<number[]>([]);
  const [flash, setFlash] = useState<FlashState>(null);
  const prevUSD = useRef<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    colors: ["#4F46E5"],
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
        <span
          className="w-5 h-5 flex items-center justify-center text-lg font-bold text-brand-500 leading-none"
          aria-label="Bitcoin"
        >
          ₿
        </span>
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
          Bitcoin
        </span>
      </div>

      {/* Prices row */}
      <div className="flex items-end justify-between mt-5">
        <div className="flex items-baseline gap-1.5">
          <span
            className={`text-2xl font-bold transition-colors duration-300 ${flashClass}`}
          >
            {ticker.priceUSD !== null ? `$${fmt(ticker.priceUSD)}` : "—"}
          </span>
        </div>

        {ticker.changePercentUSD !== null && (
          <Badge color={ticker.changePercentUSD >= 0 ? "success" : "error"}>
            {ticker.changePercentUSD >= 0 ? <ArrowUpIcon /> : <ArrowDownIcon />}
            {Math.abs(ticker.changePercentUSD).toFixed(2)}%
          </Badge>
        )}
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
