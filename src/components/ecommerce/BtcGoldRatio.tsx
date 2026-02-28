import { useEffect, useState } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────
const BTC_POLL_MS  = 30 * 1000;      // 30 seconds
const GOLD_POLL_MS = 10 * 60 * 1000; // 10 minutes

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchBtcPrice(signal: AbortSignal): Promise<number> {
  const res = await fetch("/api/btc-price", { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { price: number };
  if (!data.price || isNaN(data.price)) throw new Error("Invalid BTC price");
  return data.price;
}

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

  // Poll BTC price every 30 s
  useEffect(() => {
    const ctrl = new AbortController();
    const poll = () =>
      fetchBtcPrice(ctrl.signal).then(setBtcPrice).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (import.meta.env.DEV) console.error("[BtcGoldRatio] BTC fetch error:", err);
      });
    poll();
    const id = setInterval(poll, BTC_POLL_MS);
    return () => { ctrl.abort(); clearInterval(id); };
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

      {/* Ratio — how many oz of gold one BTC buys */}
      <div className="flex items-baseline gap-1.5 mt-5">
        <span className="text-2xl font-bold text-gray-800 dark:text-white/90 font-inter">
          {ratio !== null ? fmt(ratio, 2) : "—"}
        </span>
        <span className="text-sm text-gray-500 dark:text-gray-400 font-inter">oz</span>
      </div>

      {/* Sub-labels */}
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-400 dark:text-gray-500 font-inter">
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
    </div>
  );
}

