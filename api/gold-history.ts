import type { IncomingMessage, ServerResponse } from "node:http";
import { parse } from "node:url";

// Yahoo Finance GC=F (Gold Futures — USD/troy oz) historical data
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF";

const ALLOWED_RANGES    = new Set(["1mo", "3mo", "6mo", "1y", "5y", "max"]);
const ALLOWED_INTERVALS = new Set(["1d", "1wk"]);

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: (number | null)[] }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { query } = parse(req.url ?? "", true);
  const range    = typeof query.range    === "string" ? query.range    : "1y";
  const interval = typeof query.interval === "string" ? query.interval : "1wk";

  if (!ALLOWED_RANGES.has(range) || !ALLOWED_INTERVALS.has(interval)) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Invalid range or interval parameter" }));
    return;
  }

  try {
    const url = `${YAHOO_BASE}?interval=${interval}&range=${range}`;
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GL4NCE/1.0)",
        Accept: "application/json",
      },
    });

    if (!upstream.ok) throw new Error(`Yahoo Finance HTTP ${upstream.status}`);

    const body = (await upstream.json()) as YahooChartResponse;
    if (body.chart?.error) throw new Error(body.chart.error.description);

    const result     = body?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closes     = result?.indicators?.quote?.[0]?.close;

    if (!timestamps?.length || !closes?.length) {
      throw new Error("No price data returned from Yahoo Finance");
    }

    // Build [timestamp_ms, price] pairs, dropping null entries
    const data: [number, number][] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c !== null && c !== undefined && !isNaN(c)) {
        data.push([timestamps[i] * 1000, c]); // seconds → milliseconds
      }
    }

    const ttl = range === "max" || range === "5y" ? 86_400 : 3_600;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", `s-maxage=${ttl}, stale-while-revalidate=${ttl}`);
    res.end(JSON.stringify({ data }));
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
