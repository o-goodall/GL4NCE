import type { IncomingMessage, ServerResponse } from "node:http";

// CoinGecko public API — full Bitcoin price history from ~2013 to present
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=max&precision=0";

// Minimum gap between retained data points (one week, with a one-day tolerance)
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface CoinGeckoResponse {
  prices?: [number, number][];
}

export default async function handler(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const upstream = await fetch(COINGECKO_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GL4NCE/1.0)",
        Accept: "application/json",
      },
    });

    if (!upstream.ok) throw new Error(`CoinGecko HTTP ${upstream.status}`);

    const body = (await upstream.json()) as CoinGeckoResponse;
    if (!body.prices?.length) throw new Error("No price data from CoinGecko");

    // Filter out any zero/invalid entries and reduce to weekly points for performance
    const prices = body.prices.filter(([, p]) => p > 0);

    // Downsample to weekly: keep one point every 7 days (CoinGecko returns daily)
    const weekly: [number, number][] = [];
    let lastTs = -Infinity;
    for (const [ts, price] of prices) {
      if (ts - lastTs >= WEEK_MS - 24 * 60 * 60 * 1000) {
        weekly.push([ts, price]);
        lastTs = ts;
      }
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=86400");
    res.end(JSON.stringify({ data: weekly }));
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
