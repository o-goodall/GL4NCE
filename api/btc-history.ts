import type { IncomingMessage, ServerResponse } from "node:http";

// CoinGecko public API — full Bitcoin price history from ~2013 to present
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=max&precision=0";

// CryptoCompare fallback — weekly aggregated data, limit=2000 covers ~38 years
// (no API key required for public access)
const CRYPTOCOMPARE_URL =
  "https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=2000&aggregate=7";

// Minimum gap between retained data points (one week, with a one-day tolerance)
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// CoinGecko returns daily data; fewer than this points means the response is
// truncated or rate-limited (full history is ~4000+ daily points since 2013).
const MIN_COINGECKO_POINTS = 500;

interface CoinGeckoResponse {
  prices?: [number, number][];
}

interface CryptoCompareResponse {
  Response: string;
  Data?: {
    Data?: Array<{ time: number; close: number }>;
  };
}

/** Downsample CoinGecko daily prices to weekly points. */
function toWeeklyPoints(dailyMs: [number, number][]): [number, number][] {
  const weekly: [number, number][] = [];
  let lastTs = -Infinity;
  for (const [ts, price] of dailyMs) {
    if (ts - lastTs >= WEEK_MS - 24 * 60 * 60 * 1000) {
      weekly.push([ts, price]);
      lastTs = ts;
    }
  }
  return weekly;
}

export default async function handler(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    let data: [number, number][] | null = null;

    // ── 1. Try CoinGecko ──────────────────────────────────────────────────────
    try {
      const upstream = await fetch(COINGECKO_URL, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GL4NCE/1.0)",
          Accept: "application/json",
        },
      });
      if (upstream.ok) {
        const body = (await upstream.json()) as CoinGeckoResponse;
        const prices = body.prices?.filter(([, p]) => p > 0) ?? [];
        if (prices.length >= MIN_COINGECKO_POINTS) {
          data = toWeeklyPoints(prices);
        }
      }
    } catch (cgErr) {
      // Log for diagnostics but fall through to CryptoCompare
      console.error("[btc-history] CoinGecko error:", (cgErr as Error).message);
    }

    // ── 2. Fallback: CryptoCompare weekly history (back to 2010) ──────────────
    if (!data) {
      const ccRes = await fetch(CRYPTOCOMPARE_URL);
      if (!ccRes.ok) throw new Error(`CryptoCompare HTTP ${ccRes.status}`);
      const body = (await ccRes.json()) as CryptoCompareResponse;
      if (body.Response !== "Success" || !body.Data?.Data?.length) {
        throw new Error("No price data from CryptoCompare");
      }
      data = body.Data.Data
        .filter((d) => d.close > 0 && d.time > 0)
        .map((d): [number, number] => [d.time * 1000, d.close]);
    }

    if (!data || data.length === 0) throw new Error("No BTC price data available");

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=86400");
    res.end(JSON.stringify({ data }));
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
