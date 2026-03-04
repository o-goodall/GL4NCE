import type { IncomingMessage, ServerResponse } from "node:http";
import { parse } from "node:url";

// ── FRED API proxy ─────────────────────────────────────────────────────────────
// Proxies requests to the FRED (Federal Reserve Economic Data) API so that:
//   1. The API key is never shipped in the browser bundle.
//   2. Responses are cached at the CDN edge for 1 hour.
//
// Usage: GET /api/fred?series=WALCL
//
// The FRED_API_KEY environment variable must be set in Vercel.
// A free key is available at https://research.stlouisfed.org/docs/api/api_key.html

const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

// Only the series IDs used by MoneyPrinter are allowed through this proxy.
// Balance-sheet series (legacy)
// M2 money-supply series + FX conversion rates (used by /api/m2)
// Printer-score indicators (used by /api/printer)
const ALLOWED_SERIES = new Set([
  // Balance sheet
  "WALCL", "ECBASSETSW", "JPNASSETS",
  // M2 money supply
  "M2SL", "MABMM301EZM189S", "MABMM301GBM189S",
  "MABMM301JPM189S", "MABMM301CAM189S", "MYAGM2CNM189N",
  // FX rates (daily, for USD conversion)
  "DEXUSEU", "DEXUSUK", "DEXJPUS", "DEXCAUS", "DEXCHUS",
  // Printer-score indicators
  "BAMLH0A0HYM2",  // ICE BofA US HY OAS (credit stress)
  "T10Y2Y",        // 10Y-2Y yield spread (yield curve)
]);

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Read per-request so that changes to the Vercel environment variable and
  // local .env.local values are picked up without requiring a cold-start.
  const apiKey = process.env.FRED_API_KEY ?? "";

  const { query } = parse(req.url ?? "", true);
  const series = typeof query.series === "string" ? query.series : "";

  if (!ALLOWED_SERIES.has(series)) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Invalid or missing series parameter" }));
    return;
  }

  if (!apiKey) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "FRED_API_KEY environment variable is not configured" }));
    return;
  }

  try {
    const url =
      `${FRED_BASE_URL}` +
      `?series_id=${encodeURIComponent(series)}` +
      `&api_key=${apiKey}` +
      `&limit=260&sort_order=desc&file_type=json`;

    const upstream = await fetch(url);
    if (!upstream.ok) throw new Error(`FRED HTTP ${upstream.status}`);

    const data = await upstream.text();

    res.setHeader("Content-Type", "application/json");
    // Cache for 24 hours; FRED weekly series update at most once per week.
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    res.end(data);
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
