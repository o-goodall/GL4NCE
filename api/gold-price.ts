import type { IncomingMessage, ServerResponse } from "node:http";

// Yahoo Finance GC=F (Gold Futures, nearest contract — quoted in USD/troy oz)
const YAHOO_URL =
  "https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=1d";

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number };
    }>;
  };
}

export default async function handler(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const upstream = await fetch(YAHOO_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GL4NCE/1.0)",
        Accept: "application/json",
      },
    });

    if (!upstream.ok) throw new Error(`Yahoo Finance HTTP ${upstream.status}`);

    const data = (await upstream.json()) as YahooChartResponse;
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;

    if (!price || isNaN(price)) throw new Error("Invalid response from Yahoo Finance");

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=300");
    res.end(JSON.stringify({ price }));
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
