import { useEffect, useRef, useState } from "react";

// ── POC constants ──────────────────────────────────────────────────────────
const LOW_PRICE_USD = 55_000;
const HIGH_PRICE_USD = 125_000;
const MAX_DCA_AUD = 1_000;

// Next BTC halving: ~April 2028
const NEXT_HALVING_MS = new Date("2028-04-19T00:00:00Z").getTime();
const HALVING_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

function isInHalvingWindow(): boolean {
  const now = Date.now();
  return NEXT_HALVING_MS - now <= HALVING_WINDOW_MS && now < NEXT_HALVING_MS;
}

function roundToNearest50(n: number): number {
  return Math.round(n / 50) * 50;
}

interface BoostItem {
  label: string;
  pct: number;
}

// Gradient colours per tier (inline styles so they always apply)
const TIER_GRADIENT = {
  high: "linear-gradient(90deg, #fd853a, #465fff)", // > 75% max DCA
  mid:  "linear-gradient(90deg, #7592ff, #3641f5)", // 25–75%
  low:  "linear-gradient(90deg, #9cb9ff, #98a2b3)", // < 25%
  pass: "linear-gradient(90deg, #98a2b3, #667085)", // PASS
};

function buyGradient(buy: number | "PASS" | null): string {
  if (buy === null)   return TIER_GRADIENT.pass;
  if (buy === "PASS") return TIER_GRADIENT.pass;
  const ratio = buy / MAX_DCA_AUD;
  if (ratio > 0.75)  return TIER_GRADIENT.high;
  if (ratio >= 0.25) return TIER_GRADIENT.mid;
  return TIER_GRADIENT.low;
}

export default function MonthlyTarget() {
  const [priceUSD, setPriceUSD] = useState<number | null>(null);
  const [fearGreed, setFearGreed] = useState<number | null>(null);
  const prevBuy = useRef<number | "PASS" | null>(null);
  const [animate, setAnimate] = useState(false);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fear & Greed index (alternative.me public API)
  useEffect(() => {
    fetch("https://api.alternative.me/fng/?limit=1&format=json")
      .then((r) => r.json())
      .then((d) => {
        const val = parseInt((d?.data?.[0]?.value as string) ?? "", 10);
        if (!isNaN(val)) setFearGreed(val);
      })
      .catch(() => { /* silent fail — boosts simply won't show */ });
  }, []);

  // Binance WebSocket — BTC/USDT ticker
  useEffect(() => {
    const ws = new WebSocket(
      "wss://stream.binance.com:9443/stream?streams=btcusdt@ticker"
    );
    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          data?: Record<string, string>;
        };
        const raw = msg?.data?.["c"];
        if (raw !== undefined) {
          const price = parseFloat(raw);
          if (!isNaN(price)) setPriceUSD(price);
        }
      } catch { /* ignore malformed frames */ }
    };
    if (import.meta.env.DEV) {
      ws.onerror = () => console.error("[DCAWidget] WebSocket error");
    }
    return () => {
      if (
        ws.readyState !== WebSocket.CLOSED &&
        ws.readyState !== WebSocket.CLOSING
      ) {
        ws.close();
      }
    };
  }, []);

  // ── DCA logic ──────────────────────────────────────────────────────────
  const boosts: BoostItem[] = [];
  if (fearGreed !== null) {
    if (fearGreed <= 20)
      boosts.push({ label: `Fear & Greed ${fearGreed} ≤ 20`, pct: 20 });
    else if (fearGreed <= 40)
      boosts.push({ label: `Fear & Greed ${fearGreed} ≤ 40`, pct: 10 });
  }
  if (isInHalvingWindow()) {
    boosts.push({ label: "Halving window (< 365 days)", pct: 10 });
  }

  const totalBoostMultiplier =
    1 + boosts.reduce((s, b) => s + b.pct, 0) / 100;

  let recommendedBuy: number | "PASS" | null = null;
  let allocationPct = 0;

  if (priceUSD !== null) {
    if (priceUSD > HIGH_PRICE_USD) {
      recommendedBuy = "PASS";
    } else {
      allocationPct = Math.max(
        0,
        Math.min(
          1,
          1 - (priceUSD - LOW_PRICE_USD) / (HIGH_PRICE_USD - LOW_PRICE_USD)
        )
      );
      recommendedBuy = roundToNearest50(
        MAX_DCA_AUD * allocationPct * totalBoostMultiplier
      );
    }
  }

  // Animate the buy amount whenever it changes
  useEffect(() => {
    if (recommendedBuy !== null && recommendedBuy !== prevBuy.current) {
      if (prevBuy.current !== null) {
        setAnimate(true);
        if (animTimer.current) clearTimeout(animTimer.current);
        animTimer.current = setTimeout(() => setAnimate(false), 500);
      }
      prevBuy.current = recommendedBuy;
    }
    return () => {
      if (animTimer.current) clearTimeout(animTimer.current);
    };
  }, [recommendedBuy]);

  const fmt = (n: number) =>
    n.toLocaleString("en-AU", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  const fmtK = (usd: number) => `$${usd / 1_000}K USD`;

  const gradient = buyGradient(recommendedBuy);

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="px-5 pt-5 bg-white shadow-default rounded-2xl pb-6 dark:bg-gray-900 sm:px-6 sm:pt-6">

        {/* Header */}
        <div className="flex items-center gap-2 mb-6">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            4
          </span>
          <span
            className="text-lg font-bold text-orange-400 leading-none"
            aria-label="Bitcoin"
          >
            ₿
          </span>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            BTC DCA Advisor
          </h3>
          <span className="ml-auto flex items-center gap-1 text-xs text-gray-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        </div>

        {/* Recommended buy amount */}
        <div className="flex flex-col items-center justify-center py-8">
          {recommendedBuy === null ? (
            <span className="text-4xl font-bold text-gray-400">—</span>
          ) : recommendedBuy === "PASS" ? (
            <span
              className="text-5xl font-extrabold bg-clip-text text-transparent"
              style={{ backgroundImage: gradient }}
            >
              PASS
            </span>
          ) : (
            <>
              <span
                className="text-5xl font-extrabold bg-clip-text text-transparent"
                style={{
                  backgroundImage: gradient,
                  display: "inline-block",
                  transform: animate ? "scale(1.08)" : "scale(1)",
                  transition: "transform 0.3s ease",
                }}
              >
                ${fmt(recommendedBuy)}
              </span>
              <span className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                AUD · Fortnightly DCA
              </span>
            </>
          )}
        </div>

        {/* Allocation bar */}
        {recommendedBuy !== "PASS" && recommendedBuy !== null && (
          <div className="mb-5">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Allocation</span>
              <span>{Math.round(allocationPct * 100)}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round(allocationPct * 100)}%`,
                  backgroundImage: gradient,
                  transition: "width 0.5s ease",
                }}
              />
            </div>
          </div>
        )}

        {/* Active boosts */}
        {boosts.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
              Active Boosts
            </p>
            {boosts.map((b) => (
              <div
                key={b.label}
                className="flex items-center justify-between rounded-lg px-3 py-2 bg-brand-50 dark:bg-white/[0.04]"
              >
                <span className="text-xs text-brand-600 dark:text-brand-400">
                  {b.label}
                </span>
                <span className="text-xs font-semibold text-brand-600 dark:text-brand-400">
                  +{b.pct}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer — POC parameters */}
      <div className="flex items-center justify-center gap-5 px-6 py-3.5 sm:gap-8 sm:py-5">
        <div className="text-center">
          <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
            Max DCA
          </p>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            ${fmt(MAX_DCA_AUD)} AUD
          </p>
        </div>
        <div className="w-px h-7 bg-gray-200 dark:bg-gray-800" />
        <div className="text-center">
          <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Low</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            {fmtK(LOW_PRICE_USD)}
          </p>
        </div>
        <div className="w-px h-7 bg-gray-200 dark:bg-gray-800" />
        <div className="text-center">
          <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">High</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            {fmtK(HIGH_PRICE_USD)}
          </p>
        </div>
      </div>
    </div>
  );
}
